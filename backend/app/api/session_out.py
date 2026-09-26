"""One serializer for both capture kinds, so the voice and scan endpoints can never drift apart."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import Product, VoiceSession
from app.schemas.api import ReviewProduct, VoiceSessionOut
from app.schemas.extraction import BillExtraction


async def session_out(session: AsyncSession, vs: VoiceSession) -> VoiceSessionOut:
    s = get_settings()
    extraction = BillExtraction.model_validate(vs.llm_output_json) if vs.llm_output_json else None
    review: list[ReviewProduct] = []
    if extraction:
        codes = {i.product_id for i in extraction.items if i.product_id}
        codes |= {a.product_id for i in extraction.items for a in i.alternatives}
        if codes:
            rows = (await session.execute(select(Product).where(
                Product.shop_id == vs.shop_id, Product.code.in_(codes)))).scalars().all()
            review = [ReviewProduct(code=p.code, id=p.id, name=p.name, brand=p.brand, unit=p.unit,
                                    sell_price=p.sell_price, stock_qty=p.stock_qty,
                                    local_name=p.local_name, cost_price=p.cost_price)
                      for p in rows]
    meta = vs.sarvam_meta or {}
    prob = meta.get("language_probability")
    views: dict[str, str] = {}
    if vs.saaras_translation:
        views["english"] = vs.saaras_translation
    if vs.google_transcript:
        views["shadow"] = vs.google_transcript
    ocr = vs.ocr_meta or {}
    written = (vs.input_kind or "voice") == "image"
    return VoiceSessionOut(
        session_id=vs.id, client_session_id=vs.client_session_id, status=vs.status,
        mode=vs.input_mode or "sale", input_kind=vs.input_kind or "voice",
        # The review screen shows one body of text whichever way it was captured.
        transcript=vs.ocr_text if written else vs.sarvam_transcript,
        secondary_views=views,
        transcript_language=(ocr.get("script") if written else meta.get("language_code")),
        language_probability=None if written else prob,
        low_language_confidence=bool(not written and prob is not None and prob < s.LOW_LANGUAGE_PROBABILITY),
        image_count=vs.image_count,
        ocr_lines=list(ocr.get("lines") or []),
        ocr_columns=list(ocr.get("columns") or []),
        ocr_unclear_lines=list(ocr.get("unclear_lines") or []),
        ocr_notes=ocr.get("notes") or "",
        reader=ocr.get("reader"),
        extraction=extraction, review_products=review, latencies=vs.latencies or {}, error=vs.error,
        created_at=vs.created_at,
    )
