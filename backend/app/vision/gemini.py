"""Gemini reader: photo -> the lines as written.

Same REST surface the extractor already uses (generateContent with responseJsonSchema), so there is
no new key and no new SDK: the photo rides along as an inlineData part. Verified shape:
  POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
  contents[0].parts = [{"inlineData": {"mimeType": ..., "data": <base64>}}, ..., {"text": ...}]
The whole request, images included, must stay under 20 MB, which is why the phone downscales before
uploading (see frontend/src/lib/imageCapture.ts) and MAX_IMAGE_BYTES is enforced here as well.
"""
from __future__ import annotations

import asyncio
import base64
import time

import httpx
import structlog
from pydantic import ValidationError

from app.config import get_settings
from app.extraction.gemini import inline_refs
from app.schemas.scan import ScanRead
from app.vision.base import ImageBlob, ReadResult
from app.vision.prompt import READER_RULES, build_reader_message

log = structlog.get_logger(__name__)

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
RETRY_STATUSES = {429, 500, 502, 503, 504}
SCAN_SCHEMA = inline_refs(ScanRead.model_json_schema())


class GeminiVisionReader:  # structurally an ImageReader, like the STT providers
    name = "gemini:vision"

    def __init__(self, *, api_key: str | None = None, model: str | None = None, thinking_level: str | None = None,
                 max_retries: int = 3, client: httpx.AsyncClient | None = None):
        s = get_settings()
        self.api_key = api_key or s.GEMINI_API_KEY
        self.model = model or s.GEMINI_VISION_MODEL
        self.effort = thinking_level or s.GEMINI_VISION_THINKING_LEVEL
        self.max_retries = max_retries
        # Reading a photo is slower than reading a transcript, and a shop's uplink is the slow part.
        self._client = client or httpx.AsyncClient(timeout=120)

    def build_request(self, images: list[ImageBlob], *, hints: list[str]) -> dict:
        parts: list[dict] = [
            {"inlineData": {"mimeType": img.mime_type, "data": base64.b64encode(img.data).decode()}}
            for img in images
        ]
        parts.append({"text": build_reader_message(hints=hints, image_count=len(images))})
        return {
            "systemInstruction": {"parts": [{"text": READER_RULES}]},
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseJsonSchema": SCAN_SCHEMA,
                "temperature": 0.0,  # transcription, not invention
                "maxOutputTokens": 4096,
                "thinkingConfig": {"thinkingLevel": self.effort},
            },
        }

    async def read(self, images: list[ImageBlob], *, hints: list[str]) -> ReadResult:
        if not images:
            return ReadResult(self.name, self.model, [], error="no images")
        body = self.build_request(images, hints=hints)
        url = GEMINI_URL.format(model=self.model)
        t0 = time.perf_counter()

        def elapsed() -> int:
            return int((time.perf_counter() - t0) * 1000)

        def fail(error: str, **extra) -> ReadResult:
            return ReadResult(self.name, self.model, [], latency_ms=elapsed(), error=error, raw=extra)

        last_err = "unknown"
        resp: httpx.Response | None = None
        for attempt in range(self.max_retries):
            try:
                resp = await self._client.post(url, headers={"x-goog-api-key": self.api_key}, json=body)
            except httpx.HTTPError as e:
                last_err = f"connection_error: {e}"
                resp = None
                await asyncio.sleep(0.5 * (2**attempt))
                continue
            if resp.status_code in RETRY_STATUSES and attempt < self.max_retries - 1:
                last_err = f"http {resp.status_code}"
                await asyncio.sleep(min(2.0 * (2**attempt), 10.0))  # free tier is per-minute rate limited
                continue
            break
        if resp is None:
            return fail(last_err)
        if resp.status_code != 200:
            return fail(f"api_error {resp.status_code}: {resp.text[:300]}")

        data = resp.json()
        meta = data.get("usageMetadata") or {}
        usage = {
            "input_tokens": meta.get("promptTokenCount"),
            "output_tokens": (meta.get("candidatesTokenCount") or 0) + (meta.get("thoughtsTokenCount") or 0),
        }
        request_id = data.get("responseId")
        raw = {"request_id": request_id, "usage": usage, "images": len(images)}
        candidates = data.get("candidates") or []
        if not candidates:
            reason = (data.get("promptFeedback") or {}).get("blockReason", "no_candidates")
            return fail(f"stop_reason={reason}", **raw)
        cand = candidates[0]
        finish = cand.get("finishReason")
        text = "".join(p.get("text", "") for p in (cand.get("content") or {}).get("parts", []) if not p.get("thought"))
        if finish != "STOP":
            return fail(f"stop_reason={finish}", **raw)
        try:
            read = ScanRead.model_validate_json(text)
        except ValidationError as e:
            return fail(f"schema_invalid: {str(e)[:200]}", **raw)
        lines = [ln.strip() for ln in read.lines if ln.strip()]
        log.info("gemini_scan", request_id=request_id, images=len(images), lines=len(lines),
                 columns=len(read.columns),
                 latency_ms=elapsed(), **{k: v for k, v in usage.items() if v is not None})
        return ReadResult(
            self.name, data.get("modelVersion") or self.model, lines,
            columns=[c.strip() for c in read.columns if c.strip()],
            script=read.script or None, notes=read.notes, latency_ms=elapsed(),
            raw=raw | {"unclear_lines": read.unclear_lines},
        )
