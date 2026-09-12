"""Deterministic guards applied to the LLM output. Nothing is silently dropped: anything that fails a
check is flagged `needs_review` with a machine-readable reason so the shopkeeper sees it in red."""
from __future__ import annotations

import re
import unicodedata

from app.schemas.extraction import Alternative, BillExtraction, ExtractedItem
from app.services.catalog import CatalogSnapshot

NUMBER_WORDS = {
    # latin transliterations (odia / hindi / english)
    "eka", "ek", "gote", "gotie", "one", "dui", "do", "two", "tini", "teen", "tin", "three", "chari", "char", "four",
    "pancha", "panch", "paanch", "five", "chha", "chhe", "chhaa", "six", "sata", "saat", "seven", "atha", "aath",
    "eight", "na", "nau", "nao", "nine", "dasa", "das", "dus", "ten", "egara", "gyarah", "bara", "barah", "tera",
    "terah", "chauda", "chaudah", "pandara", "pandrah", "shola", "solah", "satara", "satrah", "athara", "atharah",
    "unish", "unnis", "kodie", "koie", "bees", "bis", "pachisa", "pachees", "pachis", "tirisa", "tees", "tis",
    "chalisa", "chalis", "pachasa", "pachas", "sathie", "sattar", "satari", "ashi", "assi", "nabe", "nabbe", "sahe",
    "sau", "so", "hundred", "adha", "aadha", "adhaa", "half", "derh", "dedh", "adhai", "dhai", "paun", "pao", "pav",
    "pawa", "sadhe", "darjan", "dozen", "hazar", "hajar", "thousand",
    # odia script
    "ଏକ", "ଗୋଟେ", "ଗୋଟିଏ", "ଦୁଇ", "ତିନି", "ଚାରି", "ପାଞ୍ଚ", "ଛଅ", "ସାତ", "ଆଠ", "ନଅ", "ଦଶ", "ଏଗାର", "ବାର", "ତେର",
    "ଚଉଦ", "ପନ୍ଦର", "ଷୋହଳ", "ସତର", "ଅଠର", "ଉଣେଇଶ", "କୋଡ଼ିଏ", "କୋଡିଏ", "ପଚିଶ", "ତିରିଶ", "ଚାଳିଶ", "ପଚାଶ", "ଷାଠିଏ",
    "ସତୁରି", "ଅଶୀ", "ନବେ", "ଶହେ", "ଅଧା", "ଦେଢ଼", "ଦେଢ", "ଅଢ଼େଇ", "ଅଢେଇ", "ପାଉଣ", "ସାଢ଼େ", "ଡଜନ", "ହଜାର",
    # devanagari
    "एक", "दो", "तीन", "चार", "पाँच", "पांच", "छह", "छः", "सात", "आठ", "नौ", "दस", "ग्यारह", "बारह", "तेरह",
    "चौदह", "पंद्रह", "सोलह", "सत्रह", "अठारह", "उन्नीस", "बीस", "पच्चीस", "तीस", "चालीस", "पचास", "साठ", "सत्तर",
    "अस्सी", "नब्बे", "सौ", "आधा", "डेढ़", "ढाई", "पाव", "साढ़े", "दर्जन", "हज़ार", "हजार",
}
DIGIT_RE = re.compile(r"[0-9०-९୦-୯]")
# Split on whitespace/punctuation only. A \w-based tokenizer breaks Odia and Devanagari words apart at vowel
# signs (combining marks are not \w in Python's re), so "ତିନି" or "दो" would never match a number word.
SPLIT_RE = re.compile(r"[\s,.;:!?।|/()\-]+")
# Counter suffixes glued to numbers in speech: Odia ଦୁଇଟା / ଛଅଟା / ଗୋଟିଏ-style, Hindi colloquial "दोठो".
CLASSIFIER_SUFFIXES = ("ଟିଏ", "ଟା", "ଟି", "ଟେ", "टा", "ठो")


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFC", s)
    return re.sub(r"\s+", " ", s).strip().casefold()


def _tokens(text: str) -> list[str]:
    return [t for t in SPLIT_RE.split(unicodedata.normalize("NFC", text).casefold()) if t]


def has_number_evidence(text: str) -> bool:
    if DIGIT_RE.search(text):
        return True
    for tok in _tokens(text):
        if tok in NUMBER_WORDS:
            return True
        for suffix in CLASSIFIER_SUFFIXES:
            if tok.endswith(suffix) and tok[: -len(suffix)] in NUMBER_WORDS:
                return True
    return False


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
