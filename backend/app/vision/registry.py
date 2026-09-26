from __future__ import annotations

from functools import lru_cache

from app.config import get_settings


@lru_cache
def image_reader():
    """The configured photo reader. OCR_MODE=gemini (default) | mock.

    A Sarvam Vision reader belongs here too: it reads Indic handwriting, Odia included, and reports
    better Indic word accuracy than Gemini on its own benchmark. It needs its own eval numbers on real
    shop photos before it can be the default, which is why the protocol exists (see vision/base.py).
    """
    s = get_settings()
    if s.OCR_MODE == "mock":
        from app.vision.mock import MockImageReader

        return MockImageReader()
    from app.vision.gemini import GeminiVisionReader

    return GeminiVisionReader()
