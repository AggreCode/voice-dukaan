"""Deterministic guards applied to the LLM output. Nothing is silently dropped: anything that fails a
check is flagged `needs_review` with a machine-readable reason so the shopkeeper sees it in red."""
from __future__ import annotations

import re
import unicodedata

from app.schemas.extraction import Alternative, BillExtraction, ExtractedItem
from app.services.catalog import CatalogSnapshot
from app.services.spoken import DIGIT_RE, is_number_word, tokens  # noqa: E402


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFC", s)
    return re.sub(r"\s+", " ", s).strip().casefold()


def has_number_evidence(text: str) -> bool:
    return bool(DIGIT_RE.search(text)) or any(is_number_word(t) for t in tokens(text))


def find_span(transcript_norm: str, span: str) -> bool:
    s = _norm(span)
    return bool(s) and s in transcript_norm


def _flag(item: ExtractedItem, reason: str) -> None:
    item.needs_review = True
    item.reason = reason if not item.reason else f"{item.reason},{reason}" if reason not in item.reason else item.reason


def apply_guards(
    output: BillExtraction,
    *,
    transcript: str,
    catalog: CatalogSnapshot,
    confidence_floor: float = 0.75,
) -> BillExtraction:
    tnorm = _norm(transcript)
    for item in output.items:
        # ids must exist in the snapshot
        if item.product_id is not None and item.product_id not in catalog.products:
            item.product_id = None
            _flag(item, "unknown_id")
        seen: set[str] = set()
        clean_alts: list[Alternative] = []
        for alt in item.alternatives:
            if alt.product_id in catalog.products and alt.product_id != item.product_id and alt.product_id not in seen:
                alt.confidence = max(0.0, min(1.0, alt.confidence))
                clean_alts.append(alt)
                seen.add(alt.product_id)
        item.alternatives = clean_alts[:3]

        # span must be verbatim in the transcript
        if not find_span(tnorm, item.spoken_span):
            _flag(item, "span_not_in_transcript")

        # quantity sanity + evidence. A quantity of 1 with no number spoken is a silent default (often an ASR drop,
        # e.g. "ପାରାସିଟାମଲ ଦଶ ଗୋଟା" transcribed as "ପାରାସିଟାମଲ୍ସ ଗୋଟା"), so it is flagged too.
        if item.quantity is None or item.quantity <= 0:
            item.quantity = 1.0
            _flag(item, "no_quantity")
        elif not has_number_evidence(item.spoken_span):
            _flag(item, "no_quantity" if item.quantity == 1.0 else "no_quantity_evidence")

        # price only with spoken evidence
        if item.unit_price is not None:
            if item.unit_price <= 0 or not has_number_evidence(item.spoken_span):
                item.unit_price = None
                _flag(item, "price_without_evidence")

        # confidence clamp + hard floor
        item.confidence = max(0.0, min(1.0, item.confidence))
        if item.product_id is None:
            item.confidence = min(item.confidence, 0.59)
            _flag(item, "not_in_catalog")
        if item.confidence < confidence_floor:
            item.needs_review = True
            if not item.reason:
                item.reason = "low_confidence"
        if item.product_id is not None and not item.product_name_guess:
            item.product_name_guess = catalog.products[item.product_id].name
    return output
