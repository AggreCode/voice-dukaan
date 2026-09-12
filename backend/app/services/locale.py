"""Local-language product names. The shop's language decides which Unicode script counts as "local"."""
from __future__ import annotations

SCRIPT_RANGES: dict[str, tuple[int, int]] = {
    "od": (0x0B00, 0x0B7F),  # Odia
    "hi": (0x0900, 0x097F),  # Devanagari
    "mr": (0x0900, 0x097F),
    "ne": (0x0900, 0x097F),
    "bn": (0x0980, 0x09FF),  # Bengali / Assamese
    "as": (0x0980, 0x09FF),
    "pa": (0x0A00, 0x0A7F),  # Gurmukhi
    "gu": (0x0A80, 0x0AFF),
    "ta": (0x0B80, 0x0BFF),
    "te": (0x0C00, 0x0C7F),
    "kn": (0x0C80, 0x0CFF),
    "ml": (0x0D00, 0x0D7F),
}


def language_prefix(language: str | None) -> str:
    return (language or "od-IN").split("-")[0].lower()


def in_script(text: str, language: str | None) -> bool:
    rng = SCRIPT_RANGES.get(language_prefix(language))
    if rng is None:
        return False
    lo, hi = rng
    letters = [ch for ch in text if not ch.isspace()]
    return bool(letters) and sum(lo <= ord(ch) <= hi for ch in letters) / len(letters) >= 0.6


def pick_local_name(aliases: list[str], language: str | None) -> str | None:
    """First alias written mostly in the shop language's script, e.g. 'ପାରାସିଟାମଲ' for an od-IN shop."""
    for alias in aliases:
        a = (alias or "").strip()
        if a and in_script(a, language):
            return a[:200]
    return None
