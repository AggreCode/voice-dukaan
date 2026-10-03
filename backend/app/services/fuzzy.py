"""Deterministic backstop for a word that is cut short or spelled oddly: map it onto a catalog product.

The model does most of this already, because the whole catalog sits in its prompt. This exists for the
cases where it gives up or hedges -- a customer writing "ପାରା" for ପାରାସିଟାମଲ, "bisc" for a biscuit --
and, just as importantly, to make the flag honest: a product filled in here is ALWAYS left
needs_review with reason "fuzzy_matched", capped below the review floor, so it is a one-tap suggestion
and never a silent decision. If two products fit the fragment equally, nothing is filled in: the
candidates go into `alternatives` and the shopkeeper picks.

No new dependency: difflib is in the standard library, and a shop's catalog is hundreds of rows, not
millions. Odia and Devanagari are transliterated to Latin first, so "ପାରା" and "para" score the same.
"""
from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher

from app.schemas.extraction import Alternative, BillExtraction
from app.services.catalog import CatalogSnapshot
from app.services.spoken import strip_quantity_words

# --- transliteration -------------------------------------------------------------------------
# Approximate on purpose. This feeds a similarity score, not a rendering: "close enough that the same
# word written in two scripts lands in the same place" is the whole requirement. Consonants map to
# their bare consonant (no inherent "a"), vowel signs to their vowel, and the virama is dropped.
_ODIA = {
    "ଅ": "a", "ଆ": "a", "ଇ": "i", "ଈ": "i", "ଉ": "u", "ଊ": "u", "ଋ": "ri", "ଏ": "e", "ଐ": "ai",
    "ଓ": "o", "ଔ": "au",
    "କ": "k", "ଖ": "kh", "ଗ": "g", "ଘ": "gh", "ଙ": "ng", "ଚ": "ch", "ଛ": "chh", "ଜ": "j", "ଝ": "jh",
    "ଞ": "ny", "ଟ": "t", "ଠ": "th", "ଡ": "d", "ଢ": "dh", "ଣ": "n", "ତ": "t", "ଥ": "th", "ଦ": "d",
    "ଧ": "dh", "ନ": "n", "ପ": "p", "ଫ": "ph", "ବ": "b", "ଭ": "bh", "ମ": "m", "ଯ": "y", "ର": "r",
    "ଲ": "l", "ଳ": "l", "ଵ": "v", "ଶ": "sh", "ଷ": "sh", "ସ": "s", "ହ": "h", "ଡ଼": "r", "ଢ଼": "rh",
    "ୟ": "y", "କ୍ଷ": "ksh",
    "ା": "a", "ି": "i", "ୀ": "i", "ୁ": "u", "ୂ": "u", "ୃ": "ri", "େ": "e", "ୈ": "ai", "ୋ": "o",
    "ୌ": "au", "ଂ": "n", "ଃ": "h", "ଁ": "n", "୍": "",
    "୦": "0", "୧": "1", "୨": "2", "୩": "3", "୪": "4", "୫": "5", "୬": "6", "୭": "7", "୮": "8", "୯": "9",
}
_DEVA = {
    "अ": "a", "आ": "a", "इ": "i", "ई": "i", "उ": "u", "ऊ": "u", "ऋ": "ri", "ए": "e", "ऐ": "ai",
    "ओ": "o", "औ": "au",
    "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "ng", "च": "ch", "छ": "chh", "ज": "j", "झ": "jh",
    "ञ": "ny", "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n", "त": "t", "थ": "th", "द": "d",
    "ध": "dh", "न": "n", "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m", "य": "y", "र": "r",
    "ल": "l", "ळ": "l", "व": "v", "श": "sh", "ष": "sh", "स": "s", "ह": "h", "ड़": "r", "ढ़": "rh",
    "ा": "a", "ि": "i", "ी": "i", "ु": "u", "ू": "u", "ृ": "ri", "े": "e", "ै": "ai", "ो": "o",
    "ौ": "au", "ं": "n", "ः": "h", "ँ": "n", "्": "", "़": "",
    "०": "0", "१": "1", "२": "2", "३": "3", "४": "4", "५": "5", "६": "6", "७": "7", "८": "8", "९": "9",
}
_TRANSLIT = {**_ODIA, **_DEVA}

# Sound-alike folding, applied after transliteration so both scripts reach the same spelling.
# Longest first: "chh" must fold before "ch", or "chh" becomes "ch"+"h".
_FOLD = [("chh", "c"), ("ch", "c"), ("sh", "s"), ("ph", "f"), ("kh", "k"), ("gh", "g"), ("th", "t"),
         ("dh", "d"), ("bh", "b"), ("jh", "j"), ("ck", "k"), ("q", "k"), ("x", "ks"), ("z", "j"),
         ("w", "v")]
_VOWELS = set("aeiou")
_NON_WORD = re.compile(r"[^a-z0-9]+")
_REPEAT = re.compile(r"(.)\1+")


def transliterate(text: str) -> str:
    out: list[str] = []
    for ch in unicodedata.normalize("NFC", text or ""):
        out.append(_TRANSLIT.get(ch, ch))
    return "".join(out)


def fold(text: str) -> str:
    """One spelling per sound, roughly: 'ପାରା', 'Para' and 'paaraa' all become 'para'."""
    s = _NON_WORD.sub("", transliterate(text).lower())
    for a, b in _FOLD:
        s = s.replace(a, b)
    return _REPEAT.sub(r"\1", s)  # 'paaraa' -> 'para', and any doubled consonant


def fold_words(text: str) -> list[str]:
    """The folded words of a phrase, so a term can be looked for as a WHOLE word inside a line.
    Plain substring matching is far too loose here: "oil" sits inside "boiled", and folded spellings
    have no spaces left to stop it."""
    return [w for w in (fold(part) for part in re.split(r"[^\w\u0900-\u0DFF]+", text or "")) if w]


def skeleton(text: str) -> str:
    """Consonants only. Vowels are what transliteration gets wrong most, so a second score ignores
    them: 'parasitamal' and 'paracetamol' share 'prstml' / 'prctml'."""
    s = "".join(c for c in fold(text) if c not in _VOWELS and not c.isdigit())
    return s


def _ratio(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio() if a and b else 0.0


def score_term(query: str, term: str) -> float:
    """0..1 for how well a written fragment fits one catalog term.

    Three kinds of evidence, each trusted only where it means something:

    * an abbreviation -- the start of the word, kept ("para", "bisc"). The shorter the fragment the
      lower the ceiling, since "pa" fits far too many products to trust;
    * whole words in common -- "Rice" inside "Rice (Premium) 25 kg bag";
    * letters in common -- a spelling slip ("musturd", "biscut", "maggie"). Only for strings long enough
      for the overlap to mean something: between short words it is noise, "atta" and "tea" share most
      of their letters and nothing else.

    Measured on 15 products a shop might newly stock against a kirana catalog, and 12 real ways of
    writing products it already has; see test_fuzzy.py.
    """
    q, t = fold(query), fold(term)
    if not q or not t:
        return 0.0
    if q == t:
        return 1.0
    best = 0.0
    if t.startswith(q):
        best = 0.94 if len(q) >= 4 else 0.86 if len(q) == 3 else 0.55
    elif q.startswith(t) and len(t) >= 3:
        best = 0.9 if len(t) >= 4 else 0.8
    if len(q) >= 4 and q in t:
        best = max(best, 0.82)

    # Every word of the product's name appears in the line: "Rice" inside "Rice (Premium) 25 kg bag".
    term_words, query_words = set(fold_words(term)), set(fold_words(query))
    if term_words and term_words <= query_words:
        best = max(best, 0.9)
    elif query_words and query_words <= term_words and len("".join(query_words)) >= 4:
        best = max(best, 0.86)

    # Letters in common. Short strings get their similarity discounted, because two four-letter words
    # agree on half their letters by chance.
    similar = _ratio(q, t)
    shortest = min(len(q), len(t))
    if shortest < 5:
        similar *= 0.6  # "atta" and "tata" share three letters of four, and nothing else
    elif shortest < 6:
        similar *= 0.75
    best = max(best, similar)
    # Consonants only, for ONE transliterated word against ONE word: Odia written in Latin letters gets
    # its vowels wrong ("parasitamal") far more than its consonants. Across several words, or with
    # three consonants or fewer, it matches almost anything ("atta" and "tea" are both just "t").
    if len(query_words) == 1 and len(term_words) == 1:
        sq, st = skeleton(query), skeleton(term)
        if min(len(sq), len(st)) >= 4:
            best = max(best, _ratio(sq, st) * 0.9)

    # Two names that share a word but each carry a word of their own are two products: Moong Dal is not
    # Toor Dal, Good Day Biscuit is not Tiger Biscuit. The shared word is what makes the letters look
    # alike, so judge them on the words that differ, in written order so "marigold" meets "marie gold".
    own_q = [w for w in fold_words(query) if w not in term_words]
    own_t = [w for w in fold_words(term) if w not in query_words]
    cap = 1.0
    if query_words & term_words and own_q and own_t:
        cap = 0.1 + 0.7 * _ratio("".join(own_q), "".join(own_t))
    return min(1.0, best, cap)


def rank(query: str, catalog: CatalogSnapshot, *, limit: int = 4) -> list[tuple[str, float]]:
    """Catalog codes best first. Quantity and unit words are stripped: "para 10 patta" asks about
    "para", and leaving the numbers in would make every line look alike."""
    cleaned = strip_quantity_words(query) or query
    # "parle" may mean "Biscuit Parle G", but "Moong Dal" must not mean "Toor Dal" just because the
    # second word of each is "dal". A single word of a name only stands for it when the line is one word.
    one_word = len(fold_words(cleaned)) <= 1
    scored: list[tuple[str, float]] = []
    for code, p in catalog.products.items():
        terms = [p.name, *(p.name.split() if " " in p.name and one_word else []), *p.aliases, *p.learned]
        if p.local_name:
            terms.append(p.local_name)
        if p.brand and p.brand not in ("-", ""):
            terms.append(p.brand)
        best = max((score_term(cleaned, t) for t in terms if t), default=0.0)
        if best > 0:
            scored.append((code, round(best, 4)))
    scored.sort(key=lambda x: (-x[1], x[0]))
    return scored[:limit]


def best_score(text: str, catalog: CatalogSnapshot, code: str) -> float:
    """How well a written line fits ONE named product. Used to audit a match, not to make one."""
    product = catalog.products.get(code)
    if product is None:
        return 0.0
    cleaned = strip_quantity_words(text) or text
    one_word = len(fold_words(cleaned)) <= 1
    terms = [product.name, *(product.name.split() if " " in product.name and one_word else []), *product.aliases,
             *product.learned]
    if product.local_name:
        terms.append(product.local_name)
    return max((score_term(cleaned, t) for t in terms if t), default=0.0)


def verify_matches(
    bill: BillExtraction,
    catalog: CatalogSnapshot,
    *,
    min_score: float = 0.6,
) -> BillExtraction:
    """Drop a match that the written line does not actually support.

    A language model asked to pick from a list will pick from the list. Offered "Tomato Sauce" when
    the paper says "Toor Dal", it may still answer with the nearest shelf-mate, and the shopkeeper
    then sees a confident wrong product instead of a line to deal with. So every match is audited
    against the words that were actually written: if they do not resemble the product at all, the
    match is removed and the raw line is handed back for the shopkeeper to resolve.

    Only the written path uses this. Speech is phonetic and deliberately scores differently.
    """
    for item in bill.items:
        if item.product_id is None:
            continue
        evidence = item.spoken_span or item.product_name_guess
        if not evidence:
            continue
        score = max(best_score(evidence, catalog, item.product_id),
                    best_score(item.product_name_guess, catalog, item.product_id)
                    if item.product_name_guess else 0.0)
        if score >= min_score:
            continue
        item.alternatives = [Alternative(product_id=c, confidence=s)
                             for c, s in rank(evidence, catalog, limit=3) if s >= min_score]
        item.product_id = None
        item.confidence = min(item.confidence, 0.3)
        item.needs_review = True
        item.reason = f"{item.reason},weak_match" if item.reason else "weak_match"
        if not item.product_name_guess:
            item.product_name_guess = evidence
    return bill


def fill_unresolved(
    bill: BillExtraction,
    catalog: CatalogSnapshot,
    *,
    min_score: float = 0.72,
    min_gap: float = 0.08,
) -> BillExtraction:
    """Suggest a product for lines the model left unresolved. Never overrides a resolved line, never
    clears needs_review, and never raises confidence to where the review screen would stop asking."""
    for item in bill.items:
        if item.product_id is not None:
            continue
        query = item.product_name_guess or item.spoken_span
        if not query or len(fold(query)) < 2:
            continue
        ranked = rank(query, catalog)
        if not ranked or ranked[0][1] < min_score:
            continue
        top_code, top_score = ranked[0]
        runner_up = ranked[1][1] if len(ranked) > 1 else 0.0
        others = [Alternative(product_id=c, confidence=s) for c, s in ranked[1:4] if s >= min_score * 0.8]
        if top_score - runner_up >= min_gap:
            item.product_id = top_code
            # Capped below REVIEW_CONFIDENCE_FLOOR on purpose: a spelling match is a suggestion.
            item.confidence = min(item.confidence if item.confidence > 0 else top_score, 0.7)
            item.needs_review = True
            item.reason = f"{item.reason},fuzzy_matched" if item.reason else "fuzzy_matched"
            item.alternatives = others[:3]
            if not item.product_name_guess:
                item.product_name_guess = catalog.products[top_code].name
        else:
            # Two products fit the fragment equally. Offering both beats guessing one.
            item.needs_review = True
            if "ambiguous_product" not in item.reason:
                item.reason = f"{item.reason},ambiguous_product" if item.reason else "ambiguous_product"
            item.alternatives = [Alternative(product_id=c, confidence=s) for c, s in ranked[:3]]
    return bill
