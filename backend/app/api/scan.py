"""Scan a photographed list: POST the photos, get the same session shape a recording returns.

The photos are read in memory and dropped when the request ends (KEEP_IMAGES=false, the default), so
nothing about a customer's handwritten list is stored. What is kept is the text that was read, which
is what the eval and the corrections need.
"""
from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_shop
from app.api.session_out import session_out
from app.api.voice import get_extractor
from app.config import get_settings
from app.db import get_session
from app.models import Shop, VoiceSession
from app.schemas.api import VoiceSessionOut
from app.services.pipeline import process_image_session
from app.vision.base import ImageBlob
from app.vision.registry import image_reader

router = APIRouter(prefix="/api/scan", tags=["scan"])

# What the reader accepts. HEIC is here because that is what an iPhone hands over by default; the web
# app converts to JPEG while downscaling, so it should rarely arrive.
_ALLOWED = {"image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"}
_EXT = {"image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp",
        "image/heic": "heic", "image/heif": "heif"}


def get_reader():
    """Indirection so tests can swap the reader, exactly as they swap the extractor."""
    return image_reader()


@router.post("/sessions", response_model=VoiceSessionOut)
async def create_scan_session(
    images: list[UploadFile] = File(...),
    client_session_id: str = Form(...),
    mode: str = Form(default="sale"),
    shop: Shop = Depends(current_shop),
    session: AsyncSession = Depends(get_session),
):
    s = get_settings()
    if mode not in ("sale", "stock_in"):
        raise HTTPException(400, "mode must be sale or stock_in")
    if not images:
        raise HTTPException(400, "no images")
    if len(images) > s.MAX_IMAGES_PER_SCAN:
        raise HTTPException(413, f"at most {s.MAX_IMAGES_PER_SCAN} photos per list")

    existing = (await session.execute(select(VoiceSession).where(
        VoiceSession.shop_id == shop.id, VoiceSession.client_session_id == client_session_id))).scalar_one_or_none()
    if existing is not None:
        return await session_out(session, existing)  # idempotent retry

    blobs: list[ImageBlob] = []
    for up in images:
        mt = (up.content_type or "image/jpeg").split(";")[0].strip().lower()
        if mt not in _ALLOWED:
            raise HTTPException(415, f"unsupported image type {mt}")
        data = await up.read()
        if not data:
            raise HTTPException(400, "empty image")
        if len(data) > s.MAX_IMAGE_BYTES:
            raise HTTPException(413, f"photo larger than {s.MAX_IMAGE_BYTES // (1024 * 1024)} MB")
        blobs.append(ImageBlob(data=data, mime_type=mt, filename=up.filename or f"photo.{_EXT.get(mt, 'jpg')}"))

    vs = VoiceSession(shop_id=shop.id, client_session_id=client_session_id, status="processing",
                      input_kind="image", input_mode=mode, image_count=len(blobs),
                      mime_type=blobs[0].mime_type)
    session.add(vs)
    await session.flush()

    if s.KEEP_IMAGES:  # debugging only; off in every deployment
        base = Path(s.DATA_DIR) / "scan" / str(vs.id)
        base.mkdir(parents=True, exist_ok=True)
        for i, b in enumerate(blobs):
            (base / f"page{i + 1}.{_EXT.get(b.mime_type, 'jpg')}").write_bytes(b.data)
    await session.commit()

    missing = None
    if s.OCR_MODE == "gemini" and not s.GEMINI_API_KEY:
        missing = "GEMINI_API_KEY"
    elif s.EXTRACTOR_MODE == "gemini" and not s.GEMINI_API_KEY:
        missing = "GEMINI_API_KEY"
    elif s.EXTRACTOR_MODE == "claude" and not s.ANTHROPIC_API_KEY:
        missing = "ANTHROPIC_API_KEY"
    if missing:
        vs.status, vs.error = "failed", f"{missing} not configured"
        await session.commit()
        return await session_out(session, vs)

    await process_image_session(session, vs, images=blobs, reader=get_reader(), extractor=get_extractor())
    await session.commit()
    return await session_out(session, vs)


@router.get("/sessions/{session_id}", response_model=VoiceSessionOut)
async def get_scan_session(session_id: uuid.UUID, shop: Shop = Depends(current_shop),
                           session: AsyncSession = Depends(get_session)):
    vs = await session.get(VoiceSession, session_id)
    if vs is None or vs.shop_id != shop.id:
        raise HTTPException(404, "session not found")
    return await session_out(session, vs)
