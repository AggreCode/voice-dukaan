from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from app.schemas.extraction import BillExtraction
from app.services.catalog import CatalogSnapshot


@dataclass
class ShopContext:
    shop_type: str = "general"
    date_iso: str = ""
    detected_language: str | None = None
    language_probability: float | None = None
    stt_provider: str = ""
    input_mode: str = "sale"  # sale | stock_in, chosen by the shopkeeper before capturing
    input_source: str = "voice"  # voice (dictated) | written (read off a photographed list)
    reader: str = ""  # which image reader produced the text, when input_source is "written"
    unclear_lines: list[str] = field(default_factory=list)  # written lines the reader was unsure of


@dataclass
class ExtractionOutcome:
    output: BillExtraction | None
    request_id: str | None = None
    model: str = ""
    stop_reason: str | None = None
    latency_ms: int = 0
    usage: dict = field(default_factory=dict)
    error: str | None = None


class Extractor(Protocol):
    async def extract(
        self,
        *,
        transcript: str,
        secondary_views: dict[str, str],
        catalog: CatalogSnapshot,
        shop_ctx: ShopContext,
    ) -> ExtractionOutcome: ...
