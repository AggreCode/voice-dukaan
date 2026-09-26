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
from app.services.fuzzy import fill_unresolved, fold, rank, score_term, skeleton


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
