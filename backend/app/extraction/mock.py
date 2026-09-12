"""Zero-cost stand-in for ClaudeExtractor, for testing the rest of the pipeline (recording, ffmpeg,
VAD, Sarvam transcription, review UI, save/stock/corrections) without an Anthropic key or spend.

It does no product matching at all: it just splits the transcript on the chunk-boundary marker
(" | ") and, as a bonus, on commas, and returns one unresolved item per fragment. Every item has
product_id=None and needs_review=True, so the shopkeeper has to pick the product manually in the
review screen -- this is NOT meant to demonstrate matching accuracy, only to prove the plumbing works.
Enable with EXTRACTOR_MODE=mock in .env.
"""
from __future__ import annotations

import re
import time

from app.extraction.base import ExtractionOutcome, ShopContext
from app.schemas.extraction import BillExtraction, ExtractedItem, Intent
from app.services.catalog import CatalogSnapshot

_SPLIT_RE = re.compile(r"\s*\|\s*|\s*,\s*")


class MockExtractor:
    """Same shape as ClaudeExtractor.extract() but calls no external API."""

    model = "mock:no-llm"
    effort = "n/a"

    async def extract(
        self,
        *,
        transcript: str,
        secondary_views: dict[str, str],
        catalog: CatalogSnapshot,
        shop_ctx: ShopContext,
    ) -> ExtractionOutcome:
        t0 = time.perf_counter()
        fragments = [f.strip() for f in _SPLIT_RE.split(transcript) if f.strip()]
        items = [
            ExtractedItem(
                spoken_span=frag,
                product_id=None,
                product_name_guess=frag,
                quantity=1,
                unit="",
                unit_price=None,
                alternatives=[],
                confidence=0.0,
                needs_review=True,
                reason="mock_extractor_no_llm",
            )
            for frag in fragments
        ]
        bill = BillExtraction(
            intent=Intent.purchase if shop_ctx.input_mode == "stock_in" else Intent.sale,
            items=items,
            customer_name=None,
            payment_mode=None,
            notes="Produced by MockExtractor (EXTRACTOR_MODE=mock) -- no LLM was called.",
            transcript_language=shop_ctx.detected_language or "unknown",
        )
        return ExtractionOutcome(
            bill, request_id=None, model=self.model, stop_reason="end_turn",
            latency_ms=int((time.perf_counter() - t0) * 1000),
            usage={"input_tokens": 0, "output_tokens": 0, "cache_read_input_tokens": 0},
        )
