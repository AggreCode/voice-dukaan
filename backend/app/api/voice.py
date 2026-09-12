from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_shop
from app.config import get_settings
from app.db import get_session
from app.extraction.base import Extractor
from app.extraction.claude import ClaudeExtractor
from app.extraction.gemini import GeminiExtractor
from app.extraction.mock import MockExtractor
from app.models import Product, Shop, VoiceSession
from app.schemas.api import ReviewProduct, VoiceSessionOut
from app.schemas.extraction import BillExtraction
from app.services.pipeline import process_session
from app.stt.registry import primary_provider

router = APIRouter(prefix="/api/voice", tags=["voice"])

_EXT = {"audio/webm": "webm", "audio/mp4": "m4a", "audio/ogg": "ogg", "audio/wav": "wav", "audio/x-wav": "wav",
        "audio/mpeg": "mp3", "audio/aac": "aac", "audio/flac": "flac"}

_extractor: Extractor | None = None


def get_extractor() -> Extractor:
    global _extractor
    if _extractor is None:
        s = get_settings()
        if s.EXTRACTOR_MODE == "mock":
            _extractor = MockExtractor()
        elif s.EXTRACTOR_MODE == "claude":
            _extractor = ClaudeExtractor()
        else:
            _extractor = GeminiExtractor()
    return _extractor


async def _to_out(session: AsyncSession, vs: VoiceSession) -> VoiceSessionOut:
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
    return VoiceSessionOut(
        session_id=vs.id, client_session_id=vs.client_session_id, status=vs.status, mode=vs.input_mode or "sale",
        transcript=vs.sarvam_transcript, secondary_views=views,
        transcript_language=meta.get("language_code"), language_probability=prob,
        low_language_confidence=bool(prob is not None and prob < s.LOW_LANGUAGE_PROBABILITY),
        extraction=extraction, review_products=review, latencies=vs.latencies or {}, error=vs.error,
        created_at=vs.created_at,
    )


@router.post("/sessions", response_model=VoiceSessionOut)
async def create_session(
    audio: UploadFile = File(...),
    client_session_id: str = Form(...),
    duration_ms: int | None = Form(default=None),
    mime_type: str | None = Form(default=None),
    mode: str = Form(default="sale"),
    shop: Shop = Depends(current_shop),
    session: AsyncSession = Depends(get_session),
):
    s = get_settings()
    if mode not in ("sale", "stock_in"):
        raise HTTPException(400, "mode must be sale or stock_in")
    if duration_ms is not None and duration_ms > (s.MAX_RECORDING_SECONDS + 5) * 1000:
        raise HTTPException(413, f"recording longer than {s.MAX_RECORDING_SECONDS}s")

    existing = (await session.execute(select(VoiceSession).where(
        VoiceSession.shop_id == shop.id, VoiceSession.client_session_id == client_session_id))).scalar_one_or_none()
    if existing is not None:
        return await _to_out(session, existing)  # idempotent retry

    data = await audio.read()
    if len(data) > s.MAX_UPLOAD_BYTES:
        raise HTTPException(413, "upload too large")
    if not data:
        raise HTTPException(400, "empty upload")

    mt = (mime_type or audio.content_type or "audio/webm").split(";")[0].strip()
    ext = _EXT.get(mt, "bin")
    vs = VoiceSession(shop_id=shop.id, client_session_id=client_session_id, status="processing",
                      mime_type=mt, duration_ms=duration_ms, input_mode=mode)
    session.add(vs)
    await session.flush()
    base = Path(s.DATA_DIR) / "audio" / str(vs.id)
    base.mkdir(parents=True, exist_ok=True)
    raw = base / f"raw.{ext}"
    raw.write_bytes(data)
    vs.audio_path = str(raw)
    await session.commit()

    missing = None
    if not s.SARVAM_API_KEY:
        missing = "SARVAM_API_KEY"
    elif s.EXTRACTOR_MODE == "gemini" and not s.GEMINI_API_KEY:
        missing = "GEMINI_API_KEY"
    elif s.EXTRACTOR_MODE == "claude" and not s.ANTHROPIC_API_KEY:
        missing = "ANTHROPIC_API_KEY"
    if missing:
        vs.status, vs.error = "failed", f"{missing} not configured"
        await session.commit()
        return await _to_out(session, vs)

    await process_session(session, vs, primary=primary_provider(), extractor=get_extractor())
    await session.commit()
    return await _to_out(session, vs)


@router.get("/sessions/{session_id}", response_model=VoiceSessionOut)
async def get_voice_session(session_id: uuid.UUID, shop: Shop = Depends(current_shop),
                            session: AsyncSession = Depends(get_session)):
    vs = await session.get(VoiceSession, session_id)
    if vs is None or vs.shop_id != shop.id:
        raise HTTPException(404, "session not found")
    return await _to_out(session, vs)


@router.get("/sessions", response_model=list[VoiceSessionOut])
async def list_voice_sessions(limit: int = 30, shop: Shop = Depends(current_shop),
                              session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(select(VoiceSession).where(VoiceSession.shop_id == shop.id)
                                  .order_by(VoiceSession.created_at.desc()).limit(limit))).scalars().all()
    return [await _to_out(session, r) for r in rows]
