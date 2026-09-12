"""Gemini-based bill extraction (default for the cost-first phase).

REST generateContent with structured JSON output. Verified 2026-09-11 against gemini-3.1-flash-lite:
  POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
  header x-goog-api-key; generationConfig.responseMimeType=application/json + responseJsonSchema;
  thinkingConfig.thinkingLevel minimal|low|medium|high (cannot be fully disabled).
Gemini supports only self-referencing $ref, so the Pydantic schema's $defs are inlined once.
Implicit prompt caching applies to a stable prefix, so the system instruction is rules + catalog, byte-stable.
"""
from __future__ import annotations

import asyncio
import copy
import time

import httpx
import structlog
from pydantic import ValidationError

from app.config import get_settings
from app.extraction.base import ExtractionOutcome, ShopContext
from app.extraction.prompt import STATIC_RULES, build_user_message
from app.schemas.extraction import BillExtraction
from app.services.catalog import CatalogSnapshot

log = structlog.get_logger(__name__)

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
RETRY_STATUSES = {429, 500, 502, 503, 504}


def inline_refs(schema: dict) -> dict:
    defs = schema.get("$defs", {})

    def walk(node):
        if isinstance(node, dict):
            if "$ref" in node:
                return walk(copy.deepcopy(defs[node["$ref"].split("/")[-1]]))
            return {k: walk(v) for k, v in node.items() if k not in ("$defs", "title")}
        if isinstance(node, list):
            return [walk(x) for x in node]
        return node

    return walk(schema)


BILL_SCHEMA = inline_refs(BillExtraction.model_json_schema())


class GeminiExtractor:
    def __init__(self, *, api_key: str | None = None, model: str | None = None, thinking_level: str | None = None,
                 max_retries: int = 3, client: httpx.AsyncClient | None = None):
        s = get_settings()
        self.api_key = api_key or s.GEMINI_API_KEY
        self.model = model or s.GEMINI_MODEL
        self.effort = thinking_level or s.GEMINI_THINKING_LEVEL
        self.max_retries = max_retries
        self._client = client or httpx.AsyncClient(timeout=60)

    def build_request(self, *, transcript: str, secondary_views: dict[str, str], catalog: CatalogSnapshot,
                      shop_ctx: ShopContext) -> dict:
        return {
            "systemInstruction": {"parts": [{"text": STATIC_RULES + "\n\n" + catalog.rendered}]},
            "contents": [{"role": "user",
                          "parts": [{"text": build_user_message(transcript, secondary_views, shop_ctx)}]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseJsonSchema": BILL_SCHEMA,
                "temperature": 0.1,
                "maxOutputTokens": 4096,
                "thinkingConfig": {"thinkingLevel": self.effort},
            },
        }

    async def extract(self, *, transcript: str, secondary_views: dict[str, str], catalog: CatalogSnapshot,
                      shop_ctx: ShopContext) -> ExtractionOutcome:
        body = self.build_request(transcript=transcript, secondary_views=secondary_views, catalog=catalog,
                                  shop_ctx=shop_ctx)
        url = GEMINI_URL.format(model=self.model)
        t0 = time.perf_counter()

        def elapsed() -> int:
            return int((time.perf_counter() - t0) * 1000)

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
                await asyncio.sleep(min(2.0 * (2**attempt), 10.0))  # free tier is rate limited per minute
                continue
            break
        if resp is None:
            return ExtractionOutcome(None, model=self.model, latency_ms=elapsed(), error=last_err)
        if resp.status_code != 200:
            return ExtractionOutcome(None, model=self.model, latency_ms=elapsed(),
                                     error=f"api_error {resp.status_code}: {resp.text[:300]}")

        data = resp.json()
        meta = data.get("usageMetadata") or {}
        usage = {
            "input_tokens": meta.get("promptTokenCount"),
            "output_tokens": (meta.get("candidatesTokenCount") or 0) + (meta.get("thoughtsTokenCount") or 0),
            "cache_read_input_tokens": meta.get("cachedContentTokenCount") or 0,
            "cache_creation_input_tokens": None,
        }
        request_id = data.get("responseId")
        model = data.get("modelVersion") or self.model
        candidates = data.get("candidates") or []
        if not candidates:
            reason = (data.get("promptFeedback") or {}).get("blockReason", "no_candidates")
            return ExtractionOutcome(None, request_id=request_id, model=model, latency_ms=elapsed(), usage=usage,
                                     stop_reason=reason, error=f"stop_reason={reason}")
        cand = candidates[0]
        finish = cand.get("finishReason")
        text = "".join(p.get("text", "") for p in (cand.get("content") or {}).get("parts", []) if not p.get("thought"))
        log.info("gemini_extraction", request_id=request_id, finish=finish, latency_ms=elapsed(),
                 **{k: v for k, v in usage.items() if v is not None})
        if finish != "STOP":
            return ExtractionOutcome(None, request_id=request_id, model=model, stop_reason=finish,
                                     latency_ms=elapsed(), usage=usage, error=f"stop_reason={finish}")
        try:
            bill = BillExtraction.model_validate_json(text)
        except ValidationError as e:
            return ExtractionOutcome(None, request_id=request_id, model=model, stop_reason=finish,
                                     latency_ms=elapsed(), usage=usage, error=f"schema_invalid: {str(e)[:200]}")
        return ExtractionOutcome(bill, request_id=request_id, model=model, stop_reason=finish,
                                 latency_ms=elapsed(), usage=usage)
