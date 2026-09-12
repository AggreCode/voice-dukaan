"""Shared text normalisation for WER/CER: NFC, casefold, strip punctuation, number words -> digits."""
from __future__ import annotations

import re
import unicodedata

NUMBER_MAP = {
    "eka": "1", "ek": "1", "gote": "1", "gotie": "1", "one": "1",
    "dui": "2", "do": "2", "two": "2", "tini": "3", "teen": "3", "tin": "3", "three": "3",
    "chari": "4", "char": "4", "four": "4", "pancha": "5", "panch": "5", "paanch": "5", "five": "5",
    "chha": "6", "chhe": "6", "six": "6", "sata": "7", "saat": "7", "seven": "7", "atha": "8", "aath": "8",
    "eight": "8", "na": "9", "nau": "9", "nine": "9", "dasa": "10", "das": "10", "dus": "10", "ten": "10",
    "bara": "12", "barah": "12", "pandara": "15", "pandrah": "15", "kodie": "20", "bees": "20", "bis": "20",
    "pachisa": "25", "pachees": "25", "pachis": "25", "tirisa": "30", "tees": "30", "tis": "30",
    "chalisa": "40", "chalis": "40", "pachasa": "50", "pachas": "50", "sahe": "100", "sau": "100",
    "adha": "0.5", "aadha": "0.5", "half": "0.5", "derh": "1.5", "dedh": "1.5", "adhai": "2.5", "dhai": "2.5",
    "ଏକ": "1", "ଗୋଟେ": "1", "ଗୋଟିଏ": "1", "ଦୁଇ": "2", "ତିନି": "3", "ଚାରି": "4", "ପାଞ୍ଚ": "5", "ଛଅ": "6",
    "ସାତ": "7", "ଆଠ": "8", "ନଅ": "9", "ଦଶ": "10", "ବାର": "12", "ପନ୍ଦର": "15", "କୋଡ଼ିଏ": "20", "କୋଡିଏ": "20",
    "ପଚିଶ": "25", "ତିରିଶ": "30", "ପଚାଶ": "50", "ଶହେ": "100", "ଅଧା": "0.5", "ଦେଢ଼": "1.5", "ଅଢ଼େଇ": "2.5",
    "एक": "1", "दो": "2", "तीन": "3", "चार": "4", "पाँच": "5", "पांच": "5", "छह": "6", "सात": "7", "आठ": "8",
    "नौ": "9", "दस": "10", "बारह": "12", "पंद्रह": "15", "बीस": "20", "पच्चीस": "25", "तीस": "30",
    "पचास": "50", "सौ": "100", "आधा": "0.5", "डेढ़": "1.5", "ढाई": "2.5",
}
_ODIA_DIGITS = str.maketrans("୦୧୨୩୪୫୬୭୮୯", "0123456789")
_DEVA_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")
_PUNCT = re.compile(r"[^\w\s]", re.UNICODE)


def normalize(text: str, *, numbers_to_digits: bool = True) -> str:
    t = unicodedata.normalize("NFC", text or "")
    t = t.translate(_ODIA_DIGITS).translate(_DEVA_DIGITS)
    t = t.replace("|", " ")
    t = _PUNCT.sub(" ", t).casefold()
    toks = t.split()
    if numbers_to_digits:
        toks = [NUMBER_MAP.get(tok, tok) for tok in toks]
    return " ".join(toks)
