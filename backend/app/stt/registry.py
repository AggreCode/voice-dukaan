from __future__ import annotations

from functools import lru_cache

from app.config import Settings, get_settings
from app.stt.base import STTProvider
from app.stt.sarvam import SarvamSaarasProvider


@lru_cache
def primary_provider() -> SarvamSaarasProvider:
    s = get_settings()
    return SarvamSaarasProvider(s.SARVAM_API_KEY, model=s.SARVAM_MODEL, mode=s.SARVAM_MODE)


@lru_cache
def shadow_providers() -> tuple[STTProvider, ...]:
    s: Settings = get_settings()
    if not s.GOOGLE_SHADOW_ENABLED or not s.GOOGLE_PROJECT_ID:
        return ()
    try:
        from app.stt.google import GoogleChirpProvider
    except ImportError:
        return ()
    return tuple(GoogleChirpProvider(s.GOOGLE_PROJECT_ID, region=region, model=model)
                 for model, region in s.google_shadow_models)
