"""The spelling backstop: a word cut short, a word in Odia script, and the cases where it must refuse.

The refusals matter more than the matches. Filling in a wrong product silently is worse than leaving a
line for the shopkeeper, so every fill here is asserted to stay flagged and capped below the review floor.
"""
from __future__ import annotations

import uuid
from decimal import Decimal

from app.config import get_settings
from app.schemas.extraction import BillExtraction, ExtractedItem, Intent
from app.services.catalog import CatalogProduct, CatalogSnapshot
from app.services.fuzzy import (
    best_score,
    fill_unresolved,
    fold,
    rank,
    score_term,
    skeleton,
    verify_matches,
)


def _snap(*products: tuple[str, str, list[str]]) -> CatalogSnapshot:
    rows = {}
    for code, name, aliases in products:
        rows[code] = CatalogProduct(id=uuid.uuid4(), code=code, name=name, brand="", category="general",
                                    unit="piece", sell_price=Decimal("10"), stock_qty=Decimal("5"),
                                    aliases=aliases)
    return CatalogSnapshot(shop_id=uuid.uuid4(), version=1, products=rows, rendered="", hints=[])


MEDICAL = _snap(
    ("p001", "Paracetamol 500mg", ["para", "pcm"]),
    ("p002", "Amoxicillin 250mg", ["amox"]),
    ("p003", "ORS Powder", ["ors"]),
)
KIRANA = _snap(
    ("p001", "Sugar", ["chini"]),
    ("p002", "Biscuit Parle G", ["parle g"]),
    ("p003", "Biscuit Good Day", ["good day"]),
)


def _item(guess: str, span: str = "") -> ExtractedItem:
    return ExtractedItem(spoken_span=span or guess, product_id=None, product_name_guess=guess, quantity=1,
                         unit="piece", unit_price=None, alternatives=[], confidence=0.0,
                         needs_review=True, reason="not_in_catalog")


def _bill(*items: ExtractedItem) -> BillExtraction:
    return BillExtraction(intent=Intent.sale, items=list(items), customer_name=None, payment_mode=None,
                          notes="", transcript_language="mixed")


# --- the normalisers -------------------------------------------------------------------------
def test_odia_and_latin_fold_to_the_same_spelling():
    assert fold("ପାରା") == fold("para") == "para"
    assert fold("Paraa  ") == "para"
    assert fold("चीनी") == fold("chini") == "cini"


def test_skeleton_drops_the_vowels_transliteration_gets_wrong():
    # Transliteration gets vowel length wrong constantly ("ପାରାସିଟାମଲ" -> "parasitamal"), so a second
    # score compares consonants only. They do not have to be equal, just far closer than the spellings.
    assert skeleton("paracetamol") == "prctml"
    assert skeleton("parasitamal") == "prstml"
    # digits go, the strength unit stays: it is part of how the product is written
    assert skeleton("PARACETAMOL 500mg") == "prctmlmg"


def test_a_two_letter_fragment_is_never_confident():
    assert score_term("pa", "Paracetamol 500mg") < 0.72
    assert score_term("para", "Paracetamol 500mg") >= 0.9


# --- ranking ---------------------------------------------------------------------------------
def test_a_shortened_word_ranks_the_right_product_first():
    assert rank("para", MEDICAL)[0][0] == "p001"
    assert rank("amox", MEDICAL)[0][0] == "p002"
    # Odia script reaches the same product as its Latin transliteration
    assert rank("ପାରା", MEDICAL)[0][0] == "p001"
    assert rank("ପାରାସିଟାମଲ", MEDICAL)[0][0] == "p001"


def test_quantity_and_unit_words_are_stripped_before_matching():
    assert rank("para 10 patta", MEDICAL)[0][0] == "p001"
    assert rank("2 kg chini", KIRANA)[0][0] == "p001"


# --- filling in ------------------------------------------------------------------------------
def test_a_filled_product_stays_flagged_and_below_the_review_floor():
    floor = get_settings().REVIEW_CONFIDENCE_FLOOR
    bill = fill_unresolved(_bill(_item("para", "para 10")), MEDICAL)
    item = bill.items[0]
    assert item.product_id == "p001"
    assert item.needs_review is True
    assert "fuzzy_matched" in item.reason
    assert item.confidence <= 0.7 < floor, "a spelling match must never look decided"


def test_an_ambiguous_fragment_is_offered_not_chosen():
    """"bisc" fits two biscuits. Picking one would hide the other behind a correction."""
    bill = fill_unresolved(_bill(_item("bisc")), KIRANA)
    item = bill.items[0]
    assert item.product_id is None
    assert "ambiguous_product" in item.reason
    assert {a.product_id for a in item.alternatives} >= {"p002", "p003"}


def test_a_product_the_shop_does_not_stock_is_left_alone():
    bill = fill_unresolved(_bill(_item("shampoo")), MEDICAL)
    assert bill.items[0].product_id is None
    assert "fuzzy_matched" not in bill.items[0].reason


def test_a_resolved_line_is_never_overridden():
    item = _item("para")
    item.product_id = "p003"  # the model chose ORS; a speller must not argue with it
    item.confidence = 0.95
    item.needs_review = False
    item.reason = ""
    bill = fill_unresolved(_bill(item), MEDICAL)
    assert bill.items[0].product_id == "p003"
    assert bill.items[0].confidence == 0.95 and bill.items[0].needs_review is False


def test_a_one_letter_scribble_is_not_matched_to_anything():
    bill = fill_unresolved(_bill(_item("p")), MEDICAL)
    assert bill.items[0].product_id is None


def test_alternatives_are_capped_at_three():
    big = _snap(*[(f"p{i:03d}", f"Biscuit Brand {i}", ["bisc"]) for i in range(1, 7)])
    bill = fill_unresolved(_bill(_item("bisc")), big)
    assert len(bill.items[0].alternatives) <= 3


# --- auditing a match the model made -----------------------------------------------------------
def _matched(span: str, code: str, guess: str = "") -> ExtractedItem:
    return ExtractedItem(spoken_span=span, product_id=code, product_name_guess=guess, quantity=1,
                         unit="piece", unit_price=None, alternatives=[], confidence=0.9,
                         needs_review=False, reason="")


def test_a_real_match_survives_the_audit():
    for span in ("1 | Paracetamol 500mg | 10 | strip | 18", "para", "ପାରା 10"):
        bill = verify_matches(_bill(_matched(span, "p001")), MEDICAL)
        assert bill.items[0].product_id == "p001", span


def test_a_product_the_line_does_not_support_is_dropped_with_the_raw_line_kept():
    """A model asked to pick from a list will pick from the list. The paper said one thing and the
    answer named a shelf-mate, so the shopkeeper must see the line, not a confident wrong product."""
    bill = verify_matches(_bill(_matched("Toor Dal | 5 | kg | 120", "p003")), MEDICAL)
    item = bill.items[0]
    assert item.product_id is None
    assert "weak_match" in item.reason and item.needs_review is True
    assert item.confidence <= 0.3
    assert item.product_name_guess == "Toor Dal | 5 | kg | 120"  # the raw line is what is shown


def test_the_audit_leaves_unmatched_lines_alone():
    bill = verify_matches(_bill(_item("shampoo")), MEDICAL)
    assert bill.items[0].product_id is None and "weak_match" not in bill.items[0].reason


def test_a_shop_spelling_that_differs_from_the_bill_still_counts_as_the_same_product():
    """The wholesaler's wording is never the shop's. Every word of the shop's name inside the line is
    what makes it the same product, and it must not be read as a reason to create a second copy."""
    shop = _snap(("p001", "Rice", ["chaula"]), ("p002", "Tomato Sauce", []))
    assert best_score("1 | Rice (Premium) | 50 | kg | 52.00", shop, "p001") >= 0.6
    assert best_score("Premium Rice 25kg bag", shop, "p001") >= 0.6
    # and a coincidence of letters does not clear the same bar
    assert best_score("Toor Dal | 5 | kg", shop, "p002") < 0.6


def test_audit_then_fill_does_not_put_the_wrong_product_back():
    bill = _bill(_matched("Toor Dal | 5 | kg | 120", "p003"))
    bill = fill_unresolved(verify_matches(bill, MEDICAL), MEDICAL)
    assert bill.items[0].product_id is None


# --- two products that share a word are still two products ------------------------------------
SHARED = _snap(
    ("p001", "Toor Dal", []),
    ("p002", "Tiger Biscuit", []),
    ("p003", "Marie Gold Biscuit", []),
    ("p004", "Biscuit Parle G", []),
)


def test_a_new_product_is_not_offered_as_a_shelf_mate_that_shares_one_word():
    """Found by filming the app: buying Moong Dal offered "Already in your stock? Toor Dal — add to it",
    and Good Day Biscuit was scored 0.9 against Tiger Biscuit. One tap would have put the wrong goods
    on the wrong shelf. A shared "dal" or "biscuit" is what makes the letters look alike, so it must
    not be what decides it."""
    for line in ("Moong Dal", "Moong Dal | 10 | kg | 105", "Good Day Biscuit"):
        top = rank(line, SHARED)
        assert not top or top[0][1] < 0.5, (line, top[:1])


def test_the_real_matches_survive_that_rule():
    assert rank("marigold biscuit", SHARED)[0] [0] == "p003"
    assert rank("marigold biscuit", SHARED)[0][1] >= 0.72, "a spelling difference is still the same product"
    assert rank("toor dal 2 kg", SHARED)[0] == ("p001", 1.0)
    assert rank("tiger biscuit 5 packet", SHARED)[0] == ("p002", 1.0)
    # one word on its own may still name the product it belongs to
    assert rank("parle", SHARED)[0][0] == "p004"
    assert rank("tiger", SHARED)[0][0] == "p002"


def test_the_audit_rejects_a_match_to_a_shelf_mate():
    bill = verify_matches(_bill(_matched("Moong Dal | 10 | kg | 105", "p001")), SHARED)
    assert bill.items[0].product_id is None and "weak_match" in bill.items[0].reason


# --- the suggestion threshold, measured -----------------------------------------------------------
KIRANA_SHELF = _snap(*[(f"p{i:03d}", n, []) for i, n in enumerate([
    "Basmati Rice", "Marie Gold Biscuit", "Tiger Biscuit", "Good Day Biscuit", "Sugar", "Toor Dal",
    "Mustard Oil", "Maggi Noodles", "Tata Salt", "Surf Excel", "Red Label Tea", "Parle G", "Paracetamol 500mg",
], start=1)])
NEWLY_STOCKED = ["Moong Dal", "Moong Dal | 10 | kg | 105", "Hide and Seek", "Ghee", "Atta", "Poha", "Lux Soap",
                 "Colgate", "Haldi", "Chana Dal", "Sunflower Oil", "Rock Salt", "Green Tea", "Bourbon Biscuit", "Moong"]
SAME_PRODUCT = {"marigold biscuit": "Marie Gold Biscuit", "tiger biscut": "Tiger Biscuit", "maggi": "Maggi Noodles",
                "maggie noodles": "Maggi Noodles", "surf": "Surf Excel", "red label": "Red Label Tea",
                "parleg": "Parle G", "basmati": "Basmati Rice", "toor dal 2 kg": "Toor Dal",
                "ପାରାସିଟାମଲ 10": "Paracetamol 500mg",
                "para": "Paracetamol 500mg", "musturd oil": "Mustard Oil"}


def test_nothing_a_shop_newly_stocks_is_offered_as_something_it_already_has():
    """Every one of these was once offered as a shelf-mate ("Atta" as Red Label Tea at 0.95, "Ghee" as
    Parle G). An offer reads as advice, and a shopkeeper may well tap Yes."""
    floor = get_settings().FUZZY_SUGGEST_SCORE
    offered = {q: rank(q, KIRANA_SHELF)[0] for q in NEWLY_STOCKED if rank(q, KIRANA_SHELF)[0][1] >= floor}
    assert not offered, offered


def test_another_way_of_writing_a_product_on_the_shelf_is_still_offered():
    floor = get_settings().FUZZY_SUGGEST_SCORE
    names = {p.code: p.name for p in KIRANA_SHELF.products.values()}
    for line, want in SAME_PRODUCT.items():
        code, score = rank(line, KIRANA_SHELF)[0]
        assert names[code] == want and score >= floor, (line, names[code], score)
