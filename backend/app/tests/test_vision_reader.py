"""Reader stage: request shape, line joining, and every failure path returning a usable ReadResult."""
from __future__ import annotations

import base64
import json

import httpx
import pytest

from app.schemas.scan import ScanRead
from app.vision.base import ImageBlob, ReadResult
from app.vision.gemini import GeminiVisionReader
from app.vision.mock import MockImageReader

pytestmark = pytest.mark.asyncio

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32


def _blobs(n: int = 1) -> list[ImageBlob]:
    return [ImageBlob(data=PNG + bytes([i]), mime_type="image/jpeg", filename=f"page{i + 1}.jpg") for i in range(n)]


def _reply(payload: dict, *, finish: str = "STOP") -> dict:
    return {
        "candidates": [{"finishReason": finish, "content": {"parts": [{"text": json.dumps(payload)}]}}],
        "usageMetadata": {"promptTokenCount": 900, "candidatesTokenCount": 40},
        "responseId": "resp_1",
        "modelVersion": "gemini-test",
    }


def _ok_payload(lines: list[str], unclear: list[str] | None = None,
                columns: list[str] | None = None) -> dict:
    return ScanRead(lines=lines, columns=columns or [], columns_inferred=False,
                    unclear_lines=unclear or [], script="odia", notes="").model_dump()


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_images_are_sent_inline_with_the_prompt_last():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        seen["key"] = request.headers.get("x-goog-api-key")
        return httpx.Response(200, json=_reply(_ok_payload(["chini 2 kg", "sabun 1"])))

    reader = GeminiVisionReader(api_key="k", model="m", client=_client(handler))
    result = await reader.read(_blobs(2), hints=["chini", "sabun"])

    assert result.ok and result.lines == ["chini 2 kg", "sabun 1"]
    # lines reach the extractor as one transcript, using the same marker spoken chunks use
    assert result.text == "chini 2 kg | sabun 1"
    assert seen["key"] == "k"
    parts = seen["body"]["contents"][0]["parts"]
    assert len(parts) == 3, parts
    assert [p.get("inlineData", {}).get("mimeType") for p in parts[:2]] == ["image/jpeg", "image/jpeg"]
    assert base64.b64decode(parts[0]["inlineData"]["data"]) == PNG + b"\x00"
    assert "Read the list." in parts[2]["text"]
    # catalog words are offered as a spelling reference, never as something to snap words onto
    assert "chini, sabun" in parts[2]["text"]
    assert "Never replace a written word" in parts[2]["text"]
    assert seen["body"]["generationConfig"]["temperature"] == 0.0
    schema = seen["body"]["generationConfig"]["responseJsonSchema"]["properties"]
    assert schema["lines"] and schema["columns"]
    # a table must come back with its headings, or the next stage cannot tell a rate from a quantity
    assert "columns" in parts[2]["text"] and "including every number" in parts[2]["text"]
    assert "columns_inferred" in parts[2]["text"], "a table with no header row must still be reported"


async def test_blank_lines_are_dropped_and_unclear_lines_kept():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_reply(_ok_payload(["  chini 2 kg ", "   ", "para 10"], ["para 10"])))

    reader = GeminiVisionReader(api_key="k", client=_client(handler))
    result = await reader.read(_blobs(), hints=[])
    assert result.lines == ["chini 2 kg", "para 10"]
    assert result.raw["unclear_lines"] == ["para 10"]


async def test_a_photo_with_no_list_reads_as_zero_lines_not_an_error():
    def handler(request: httpx.Request) -> httpx.Response:
        payload = ScanRead(lines=[], columns=[], columns_inferred=False, unclear_lines=[],
                           script="latin", notes="A photo of a shelf.").model_dump()
        return httpx.Response(200, json=_reply(payload))

    reader = GeminiVisionReader(api_key="k", client=_client(handler))
    result = await reader.read(_blobs(), hints=[])
    assert result.ok and result.lines == [] and "shelf" in result.notes


@pytest.mark.parametrize("finish", ["MAX_TOKENS", "SAFETY"])
async def test_a_truncated_or_blocked_answer_is_an_error_not_half_a_list(finish):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_reply(_ok_payload(["chini"]), finish=finish))

    reader = GeminiVisionReader(api_key="k", client=_client(handler))
    result = await reader.read(_blobs(), hints=[])
    assert not result.ok and finish in result.error and result.lines == []


async def test_http_error_is_reported_after_retries():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(503, text="overloaded")

    reader = GeminiVisionReader(api_key="k", max_retries=2, client=_client(handler))
    result = await reader.read(_blobs(), hints=[])
    assert not result.ok and "503" in result.error
    assert calls["n"] == 2


async def test_malformed_json_is_an_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"candidates": [{"finishReason": "STOP",
                                                         "content": {"parts": [{"text": "{not json"}]}}]})

    reader = GeminiVisionReader(api_key="k", client=_client(handler))
    result = await reader.read(_blobs(), hints=[])
    assert not result.ok and "schema_invalid" in result.error


async def test_no_images_is_rejected_without_a_call():
    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover
        raise AssertionError("should not call the API with no images")

    reader = GeminiVisionReader(api_key="k", client=_client(handler))
    assert not (await reader.read([], hints=[])).ok


async def test_mock_reader_costs_nothing_and_says_so():
    result: ReadResult = await MockImageReader().read(_blobs(2), hints=[])
    assert result.ok and len(result.lines) == 2 and "MockImageReader" in result.notes


async def test_a_priced_table_keeps_its_headings_and_every_number():
    """A supplier bill is a table: the rate column is the whole point of photographing it."""
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_reply(_ok_payload(
            ["Sugar | 2 | kg | 45", "Paracetamol | 10 | strip | 18.50"],
            columns=["Product", "Qty", "Unit", "Rate"])))

    reader = GeminiVisionReader(api_key="k", client=_client(handler))
    result = await reader.read(_blobs(), hints=[])
    assert result.columns == ["Product", "Qty", "Unit", "Rate"]
    assert result.lines[0] == "Sugar | 2 | kg | 45"
