"""Fire-and-forget shadow STT (Google Chirp). Never raises; never blocks the user path."""
from __future__ import annotations

import asyncio

import structlog

from app.audio.vad import Chunk
from app.config import get_settings
from app.stt.base import STTResult
from app.stt.registry import shadow_providers

log = structlog.get_logger(__name__)


async def run_shadow(chunks: list[Chunk], hints: list[str]) -> dict[str, list[STTResult]]:
    providers = shadow_providers()
    if not providers:
        return {}
    out: dict[str, list[STTResult]] = {}
    for p in providers:
        try:
            out[p.name] = list(await asyncio.gather(*[p.transcribe(c.path, hints=hints) for c in chunks]))
        except Exception as e:  # noqa: BLE001
            log.warning("shadow_provider_failed", provider=p.name, error=str(e))
    return out


def shadow_enabled() -> bool:
    return get_settings().GOOGLE_SHADOW_ENABLED
