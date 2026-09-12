"""Spoken-form vocabulary shared by the guards and by alias learning.

Numbers and units are the words a shopkeeper says *around* a product name. Stripping them turns a
correction on "2 packet biscuit" into the alias "biscuit" instead of a phrase that never repeats.
"""
from __future__ import annotations

import re
import unicodedata

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
    "ଦି", "ଦୁଇଟି", "ତିନ", "ଚାର", "ପାଞ୍ଚୋଟି", "ଆଧା", "ପୁରା",
    "ଚଉଦ", "ପନ୍ଦର", "ଷୋହଳ", "ସତର", "ଅଠର", "ଉଣେଇଶ", "କୋଡ଼ିଏ", "କୋଡିଏ", "ପଚିଶ", "ତିରିଶ", "ଚାଳିଶ", "ପଚାଶ", "ଷାଠିଏ",
    "ସତୁରି", "ଅଶୀ", "ନବେ", "ଶହେ", "ଅଧା", "ଦେଢ଼", "ଦେଢ", "ଅଢ଼େଇ", "ଅଢେଇ", "ପାଉଣ", "ସାଢ଼େ", "ଡଜନ", "ହଜାର",
    # devanagari
    "एक", "दो", "तीन", "चार", "पाँच", "पांच", "छह", "छः", "सात", "आठ", "नौ", "दस", "ग्यारह", "बारह", "तेरह",
    "चौदह", "पंद्रह", "सोलह", "सत्रह", "अठारह", "उन्नीस", "बीस", "पच्चीस", "तीस", "चालीस", "पचास", "साठ", "सत्तर",
    "अस्सी", "नब्बे", "सौ", "आधा", "डेढ़", "ढाई", "पाव", "साढ़े", "दर्जन", "हज़ार", "हजार",
}

UNIT_WORDS = {
    "gota", "gote", "nag", "piece", "pieces", "pcs", "pc", "tablet", "tablets", "goli", "khanda",
    "patta", "patti", "pata", "strip", "strips", "packet", "packets", "pakat", "pouch", "sachet", "puda", "pudia",
    "botal", "bottle", "bottles", "sisi", "shishi", "dabba", "dibba", "box", "boxes", "baksa",
    "peti", "carton", "cartons", "case", "kilo", "kilos", "kg", "kgs", "kilogram", "kejee", "gram", "grams", "gm", "g",
    "litre", "liter", "litres", "ltr", "lita", "ml", "darjan", "dozen", "bundle", "bundles", "gathi", "bandal",
    "ଗୋଟା", "ଗୋଟେ", "ଟା", "ପତା", "ପଟା", "ଷ୍ଟ୍ରିପ୍", "ଷ୍ଟ୍ରିପ", "ପ୍ୟାକେଟ୍", "ପ୍ୟାକେଟ", "ବୋତଲ", "ବୋତଲ୍", "ଡବା",
    "ପେଟି", "କିଲୋ", "ଗ୍ରାମ", "ଲିଟର", "ଡଜନ", "ଖଣ୍ଡ",
    "गोटा", "पत्ता", "पत्ती", "स्ट्रिप", "पैकेट", "बोतल", "डिब्बा", "पेटी", "किलो", "ग्राम", "लीटर", "दर्जन", "गोली",
}

# Words that carry no product identity on their own.
FILLER_WORDS = {"aau", "ଆଉ", "और", "and", "aur", "ra", "ର", "the", "a", "de", "dia", "ଦିଅ", "do", "दे", "please"}

SPLIT_RE = re.compile(r"[\s,.;:!?।|/()\-]+")
DIGIT_RE = re.compile(r"[0-9०-९୦-୯]")
CLASSIFIER_SUFFIXES = ("ଟିଏ", "ଟା", "ଟି", "ଟେ", "टा", "ठो")


def tokens(text: str) -> list[str]:
    return [t for t in SPLIT_RE.split(unicodedata.normalize("NFC", text or "").casefold()) if t]


def is_number_word(token: str) -> bool:
    if token in NUMBER_WORDS:
        return True
    return any(token.endswith(s) and token[: -len(s)] in NUMBER_WORDS for s in CLASSIFIER_SUFFIXES)


def is_quantity_token(token: str) -> bool:
    return bool(DIGIT_RE.search(token)) or is_number_word(token) or token in UNIT_WORDS or token in FILLER_WORDS


def strip_quantity_words(text: str) -> str:
    """'2 packet biscuit' -> 'biscuit';  'ବ୍ରାଣ୍ଡେଡ୍ ଏକ ପ୍ୟାକେଟ୍' -> 'ବ୍ରାଣ୍ଡେଡ୍'."""
    kept = [t for t in tokens(text) if not is_quantity_token(t)]
    return " ".join(kept).strip()


def clean_learned_alias(span: str, taken_terms: set[str]) -> str | None:
    """The product words from a corrected line, or None when it would teach the wrong thing.

    `taken_terms` holds the names and aliases of the shop's *other* products, casefolded. If the
    leftover words already belong to another product (the shopkeeper said "biscuit" but meant a
    battery, because speech-to-text misheard), storing it would make that product unreachable.
    """
    cleaned = strip_quantity_words(span)
    if len(cleaned) < 2 or cleaned in taken_terms:
        return None
    # "biscuit" must not be learned as a battery just because speech-to-text misheard it: the shop
    # sells "Biscuit Parle G" and "Biscuit Good Day", so those products would become unreachable.
    if any(term.startswith(cleaned + " ") for term in taken_terms):
        return None
    return cleaned[:200]
