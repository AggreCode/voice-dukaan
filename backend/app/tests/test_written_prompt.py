"""The written-list framing in the extraction prompt, and proof the spoken framing is untouched."""
from __future__ import annotations

from app.extraction.base import ShopContext
from app.extraction.prompt import STATIC_RULES, build_user_message


def test_written_input_gets_the_written_framing_and_unclear_lines():
    ctx = ShopContext(shop_type="kirana", date_iso="2026-09-25", input_source="written",
                      reader="gemini:vision", unclear_lines=["para 10"])
    msg = build_user_message("chini 2 kg | para 10", {}, ctx)
    assert "INPUT IS WRITTEN" in msg and "WRITTEN LINES:" in msg
    assert "UNSURE" in msg and "- para 10" in msg
    assert "PRIMARY TRANSCRIPT" not in msg


def test_spoken_input_is_unchanged_by_the_scan_work():
    ctx = ShopContext(shop_type="kirana", date_iso="2026-09-25", stt_provider="sarvam",
                      detected_language="od-IN", language_probability=0.9)
    msg = build_user_message("paracetamol dasa gota", {"english": "paracetamol ten pieces"}, ctx)
    assert "INPUT IS SPOKEN" in msg and "PRIMARY TRANSCRIPT (sarvam, detected od-IN p=0.90)" in msg
    assert "ENGLISH VIEW" in msg and "WRITTEN LINES" not in msg


def test_static_rules_cover_both_input_kinds_in_one_cached_block():
    # One prefix for voice and scan: a second prefix would halve the cache hit rate and cost more.
    assert "SPOKEN" in STATIC_RULES and "WRITTEN" in STATIC_RULES
    assert "When the input is WRITTEN" in STATIC_RULES
    # the rules a written list needs and speech does not
    for fragment in ("x2", "1/2", "ambiguous_product", "Three letters or fewer"):
        assert fragment in STATIC_RULES, fragment


def test_column_headings_reach_the_prompt_so_a_rate_is_not_read_as_a_quantity():
    ctx = ShopContext(shop_type="kirana", date_iso="2026-09-26", input_source="written",
                      reader="gemini:vision", input_mode="stock_in",
                      columns=["Product", "Qty", "Unit", "Rate"])
    msg = build_user_message("Sugar | 2 | kg | 45", {}, ctx)
    assert "COLUMNS (in this order" in msg
    assert "Product | Qty | Unit | Rate" in msg
    assert "STOCK IN" in msg


def test_a_list_without_columns_says_nothing_about_them():
    ctx = ShopContext(shop_type="kirana", date_iso="2026-09-26", input_source="written")
    assert "COLUMNS" not in build_user_message("chini 2 kg", {}, ctx)


def test_the_rules_read_a_rate_column_and_refuse_a_total_column():
    # The bug this pins: an earlier rule refused any number without a currency mark, which is exactly
    # how a rate column on a supplier bill is written, so every price was dropped.
    assert "Read a price-per-unit column into `unit_price`" in STATIC_RULES
    assert "NOT a unit price" in STATIC_RULES and "price_from_total" in STATIC_RULES
    assert "SPOKEN or WRITTEN" in STATIC_RULES
    # and the opposite case still holds: a bare number on a customer's list is a quantity
    assert "bare trailing number there is a QUANTITY" in STATIC_RULES
