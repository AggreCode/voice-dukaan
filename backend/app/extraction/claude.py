"""Claude-based bill extraction with structured outputs and a cached catalog system block."""
from __future__ import annotations

import time

import anthropic
import structlog

from app.config import get_settings
from app.extraction.base import ExtractionOutcome, ShopContext
from app.extraction.prompt import STATIC_RULES, build_user_message
from app.schemas.extraction import BillExtraction
from app.services.catalog import CatalogSnapshot

log = structlog.get_logger(__name__)


class ClaudeExtractor:
    def __init__(self, *, model: str | None = None, effort: str | None = None, max_tokens: int | None = None,
                 client: anthropic.AsyncAnthropic | None = None):
        s = get_settings()
        self.model = model or s.CLAUDE_MODEL
        self.effort = effort or s.CLAUDE_EFFORT
        self.max_tokens = max_tokens or s.CLAUDE_MAX_TOKENS
        self._client = client or anthropic.AsyncAnthropic(api_key=s.ANTHROPIC_API_KEY or None)

    def build_request(self, *, transcript: str, secondary_views: dict[str, str], catalog: CatalogSnapshot,
                      shop_ctx: ShopContext) -> dict:
        return {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "thinking": {"type": "adaptive"},
            "output_config": {"effort": self.effort},
            "system": [
                {"type": "text", "text": STATIC_RULES},
                {
                    "type": "text",
                    "text": catalog.rendered,
                    "cache_control": {"type": "ephemeral", "ttl": "1h"},  # cache breakpoint: catalog
                },
            ],
            "messages": [{"role": "user", "content": build_user_message(transcript, secondary_views, shop_ctx)}],
        }

    async def extract(self, *, transcript: str, secondary_views: dict[str, str], catalog: CatalogSnapshot,
                      shop_ctx: ShopContext) -> ExtractionOutcome:
        req = self.build_request(transcript=transcript, secondary_views=secondary_views, catalog=catalog,
                                 shop_ctx=shop_ctx)
        t0 = time.perf_counter()
        try:
            resp = await self._client.messages.parse(output_format=BillExtraction, **req)
        except anthropic.RateLimitError as e:
            return ExtractionOutcome(None, model=self.model, error=f"rate_limited: {e.message}",
                                     latency_ms=int((time.perf_counter() - t0) * 1000))
        except anthropic.APIStatusError as e:
            return ExtractionOutcome(None, model=self.model, error=f"api_error {e.status_code}: {e.message}",
                                     latency_ms=int((time.perf_counter() - t0) * 1000))
        except anthropic.APIConnectionError as e:
            return ExtractionOutcome(None, model=self.model, error=f"connection_error: {e}",
                                     latency_ms=int((time.perf_counter() - t0) * 1000))
        latency_ms = int((time.perf_counter() - t0) * 1000)
        usage = {
            "input_tokens": resp.usage.input_tokens,
            "output_tokens": resp.usage.output_tokens,
            "cache_creation_input_tokens": getattr(resp.usage, "cache_creation_input_tokens", None),
            "cache_read_input_tokens": getattr(resp.usage, "cache_read_input_tokens", None),
        }
        request_id = getattr(resp, "_request_id", None)
        log.info("claude_extraction", request_id=request_id, stop_reason=resp.stop_reason, latency_ms=latency_ms,
                 **{k: v for k, v in usage.items() if v is not None})
        if resp.stop_reason in ("refusal", "max_tokens") or resp.parsed_output is None:
            return ExtractionOutcome(None, request_id=request_id, model=resp.model, stop_reason=resp.stop_reason,
                                     latency_ms=latency_ms, usage=usage,
                                     error=f"stop_reason={resp.stop_reason}")
        return ExtractionOutcome(resp.parsed_output, request_id=request_id, model=resp.model,
                                 stop_reason=resp.stop_reason, latency_ms=latency_ms, usage=usage)
