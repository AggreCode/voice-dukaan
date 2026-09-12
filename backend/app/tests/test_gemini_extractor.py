import json
import uuid
from decimal import Decimal

import httpx

from app.extraction.base import ShopContext
from app.extraction.gemini import BILL_SCHEMA, GeminiExtractor
from app.services.catalog import CatalogProduct, CatalogSnapshot

BILL = {"intent": "sale", "customer_name": None, "payment_mode": None, "notes": "", "transcript_language": "od",
        "items": [{"spoken_span": "paracetamol dasa gota", "product_id": "p001", "product_name_guess": "Paracetamol",
                   "quantity": 10, "unit": "piece", "unit_price": None, "alternatives": [],
                   "confidence": 0.97, "needs_review": False, "reason": ""}]}


def _snap():
    p = CatalogProduct(id=uuid.uuid4(), code="p001", name="Paracetamol 500mg", brand="Cipla", category="medicine",
                       unit="strip", sell_price=Decimal(20), stock_qty=Decimal(0))
    return CatalogSnapshot(shop_id=uuid.uuid4(), version=1, products={"p001": p}, rendered="# CATALOG\np001|...",
                           hints=[])


def _ok(text=json.dumps(BILL), finish="STOP"):
    return httpx.Response(200, json={
        "responseId": "resp_1", "modelVersion": "gemini-3.1-flash-lite",
        "candidates": [{"finishReason": finish, "content": {"parts": [{"text": "thinking...", "thought": True},
                                                                      {"text": text}]}}],
        "usageMetadata": {"promptTokenCount": 6000, "candidatesTokenCount": 400, "cachedContentTokenCount": 3500}})


def test_schema_has_no_refs():
    assert "$ref" not in json.dumps(BILL_SCHEMA) and "$defs" not in BILL_SCHEMA


async def test_extract_parses_and_maps_usage():
    seen = {}

    def handler(request: httpx.Request):
        seen["body"] = json.loads(request.content)
        seen["key"] = request.headers.get("x-goog-api-key")
        return _ok()

    ex = GeminiExtractor(api_key="k", model="gemini-3.1-flash-lite", thinking_level="minimal",
                         client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    out = await ex.extract(transcript="paracetamol dasa gota", secondary_views={}, catalog=_snap(),
                           shop_ctx=ShopContext(date_iso="2026-09-11"))
    assert out.error is None and out.output.items[0].product_id == "p001"
    assert out.usage["cache_read_input_tokens"] == 3500 and out.request_id == "resp_1"
    assert seen["key"] == "k"
    gc = seen["body"]["generationConfig"]
    assert gc["responseMimeType"] == "application/json" and gc["thinkingConfig"] == {"thinkingLevel": "minimal"}
    assert "# CATALOG" in seen["body"]["systemInstruction"]["parts"][0]["text"]


async def test_retries_rate_limit_then_succeeds(monkeypatch):
    import app.extraction.gemini as g

    async def no_sleep(_):
        return None

    monkeypatch.setattr(g.asyncio, "sleep", no_sleep)
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(429, json={"error": "rate"}) if calls["n"] == 1 else _ok()

    ex = GeminiExtractor(api_key="k", client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    out = await ex.extract(transcript="x", secondary_views={}, catalog=_snap(), shop_ctx=ShopContext())
    assert calls["n"] == 2 and out.output is not None


async def test_truncation_and_bad_json_become_errors():
    ex = GeminiExtractor(api_key="k", client=httpx.AsyncClient(
        transport=httpx.MockTransport(lambda r: _ok(finish="MAX_TOKENS"))))
    out = await ex.extract(transcript="x", secondary_views={}, catalog=_snap(), shop_ctx=ShopContext())
    assert out.output is None and "MAX_TOKENS" in out.error
    ex = GeminiExtractor(api_key="k", client=httpx.AsyncClient(
        transport=httpx.MockTransport(lambda r: _ok(text='{"intent": "sale"'))))
    out = await ex.extract(transcript="x", secondary_views={}, catalog=_snap(), shop_ctx=ShopContext())
    assert out.output is None and out.error.startswith("schema_invalid")
