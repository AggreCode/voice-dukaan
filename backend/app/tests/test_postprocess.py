import uuid
from decimal import Decimal

from app.extraction.postprocess import apply_guards, has_number_evidence
from app.schemas.extraction import Alternative, BillExtraction, ExtractedItem, Intent, Unit
from app.services.catalog import CatalogProduct, CatalogSnapshot


def _snap(codes=("p001", "p002")) -> CatalogSnapshot:
    products = {c: CatalogProduct(id=uuid.uuid4(), code=c, name=f"Prod {c}", brand="", category="medicine",
                                  pack_unit="strip", sub_unit="piece", pack_size=Decimal(10),
                                  sell_price=Decimal(20), stock_qty=Decimal(0)) for c in codes}
    return CatalogSnapshot(shop_id=uuid.uuid4(), version=1, products=products, rendered="", hints=[])


def _item(**kw) -> ExtractedItem:
    base = dict(spoken_span="paracetamol dasa gota", product_id="p001", product_name_guess="Prod p001", quantity=10,
                unit=Unit.piece, unit_raw="gota", unit_price=None, alternatives=[], confidence=0.95,
                needs_review=False, reason="")
    base.update(kw)
    return ExtractedItem(**base)


def _bill(*items) -> BillExtraction:
    return BillExtraction(intent=Intent.sale, items=list(items), customer_name=None, payment_mode=None, notes="",
                          transcript_language="mixed")


def test_number_evidence_latin_odia_digits():
    assert has_number_evidence("paracetamol dasa gota")
    assert has_number_evidence("ପାରାସିଟାମଲ ଦଶ ଗୋଟା")
    assert has_number_evidence("crocin 2 patta")
    assert has_number_evidence("chaula ୫ କିଲୋ")
    assert not has_number_evidence("crocin patta")


def test_number_evidence_indic_words_with_vowel_signs_and_counters():
    # exact spans produced by Sarvam saaras:v4 in the 2026-09-11 end-to-end run
    assert has_number_evidence("दो पत्ता पैरासिटामोल")
    assert has_number_evidence("ଡୋଲୋ ଦୁଇଟା ପତା")
    assert has_number_evidence("କମ୍ବିଫ୍ଲାମ୍ ତିନି ପତା")
    assert has_number_evidence("ଭିକ୍ସ ଦୁଇଟା")
    assert has_number_evidence("ସେଟିରିଜିନ୍ ଗୋଟିଏ ପତା")
    assert not has_number_evidence("ପାରାସିଟାମଲ୍ସ ଗୋଟା")


def test_colloquial_odia_numbers_from_real_recordings():
    # exact spans from the first real phone recording, 11 Sep 2026
    assert has_number_evidence("ଦି ପ୍ୟାକେଟ୍ ଆଭିଲ୍")
    assert has_number_evidence("ଚାରି ଷ୍ଟ୍ରିପ୍ ପାରାସିଟାମଲ୍")
    assert has_number_evidence("ପାଞ୍ଚ ଷ୍ଟ୍ରିପ୍ କ୍ରସିନ୍")


def test_silent_default_quantity_one_is_flagged():
    out = apply_guards(_bill(_item(spoken_span="ପାରାସିଟାମଲ୍ସ ଗୋଟା", quantity=1, confidence=0.95)),
                       transcript="ପାରାସିଟାମଲ୍ସ ଗୋଟା ଆଉ ଡୋଲୋ ଦୁଇଟା ପତା", catalog=_snap())
    assert out.items[0].needs_review and "no_quantity" in out.items[0].reason


def test_spoken_counter_quantity_not_flagged():
    out = apply_guards(_bill(_item(spoken_span="ଡୋଲୋ ଦୁଇଟା ପତା", quantity=2, unit="strip", confidence=1.0)),
                       transcript="ଡୋଲୋ ଦୁଇଟା ପତା", catalog=_snap())
    assert not out.items[0].needs_review and out.items[0].reason == ""


def test_unknown_id_is_nulled_and_flagged():
    out = apply_guards(_bill(_item(product_id="p999")), transcript="paracetamol dasa gota", catalog=_snap())
    it = out.items[0]
    assert it.product_id is None and it.needs_review and "unknown_id" in it.reason and it.confidence < 0.75


def test_span_not_in_transcript_flagged():
    out = apply_guards(_bill(_item(spoken_span="crocin dui patta")), transcript="paracetamol dasa gota",
                       catalog=_snap())
    assert out.items[0].needs_review and "span_not_in_transcript" in out.items[0].reason


def test_span_match_is_whitespace_and_case_insensitive():
    out = apply_guards(_bill(_item(spoken_span="Paracetamol  dasa gota")), transcript="paracetamol dasa gota",
                       catalog=_snap())
    assert not out.items[0].needs_review


def test_price_without_evidence_removed():
    out = apply_guards(_bill(_item(spoken_span="crocin patta", product_id="p002", quantity=1, unit_price=30.0)),
                       transcript="crocin patta", catalog=_snap())
    assert out.items[0].unit_price is None and "price_without_evidence" in out.items[0].reason


def test_quantity_without_evidence_flagged():
    out = apply_guards(_bill(_item(spoken_span="crocin patta", product_id="p002", quantity=3)),
                       transcript="crocin patta", catalog=_snap())
    assert "no_quantity_evidence" in out.items[0].reason


def test_alternatives_cleaned():
    alts = [Alternative(product_id="p001", confidence=0.4), Alternative(product_id="p002", confidence=1.4),
            Alternative(product_id="zzz", confidence=0.3), Alternative(product_id="p002", confidence=0.2)]
    out = apply_guards(_bill(_item(alternatives=alts)), transcript="paracetamol dasa gota", catalog=_snap())
    assert [a.product_id for a in out.items[0].alternatives] == ["p002"]
    assert out.items[0].alternatives[0].confidence == 1.0


def test_low_confidence_floor():
    out = apply_guards(_bill(_item(confidence=0.7)), transcript="paracetamol dasa gota", catalog=_snap())
    assert out.items[0].needs_review and out.items[0].reason == "low_confidence"
