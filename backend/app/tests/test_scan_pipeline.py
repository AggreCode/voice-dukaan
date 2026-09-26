"""process_image_session end to end with no database: status transitions, what is persisted, and the
guards still firing on written lines. The API-level test needs Postgres; this one does not, so the
scan logic is covered wherever the suite runs."""
from __future__ import annotations

import uuid
from decimal import Decimal

import pytest

from app.extraction.base import ExtractionOutcome
from app.models import Shop, VoiceSession
from app.schemas.extraction import BillExtraction, ExtractedItem, Intent
from app.services import catalog as catalog_svc
from app.services.catalog import CatalogProduct, CatalogSnapshot
from app.services.pipeline import process_image_session
from app.vision.base import ImageBlob, ReadResult

pytestmark = pytest.mark.asyncio


class StubSession:
    """Only what process_image_session touches."""

    def __init__(self, shop: Shop):
        self.shop = shop

    async def get(self, model, pk):
        return self.shop


class StubReader:
    name = "stub:reader"
    model = "stub"

    def __init__(self, result: ReadResult):
        self.result = result
        self.calls: list[list[ImageBlob]] = []
        self.hints: list[str] = []

    async def read(self, images, *, hints):
        self.calls.append(images)
        self.hints = hints
        return self.result


class StubExtractor:
    def __init__(self, bill: BillExtraction | None, error: str | None = None):
        self.bill = bill
        self.error = error
        self.seen: dict | None = None

    async def extract(self, *, transcript, secondary_views, catalog, shop_ctx):
        self.seen = {"transcript": transcript, "views": secondary_views, "ctx": shop_ctx}
        return ExtractionOutcome(self.bill.model_copy(deep=True) if self.bill else None, request_id="req_scan",
                                 model="stub", stop_reason="end_turn", latency_ms=1,
                                 usage={"input_tokens": 1, "output_tokens": 1}, error=self.error)


def _snapshot(shop: Shop) -> CatalogSnapshot:
    products = {
        "p001": CatalogProduct(id=uuid.uuid4(), code="p001", name="Paracetamol 500mg", brand="X", category="general",
                               unit="strip", sell_price=Decimal("20"), stock_qty=Decimal("10"), aliases=["para"]),
        "p002": CatalogProduct(id=uuid.uuid4(), code="p002", name="Sugar", brand="", category="general",
                               unit="kg", sell_price=Decimal("45"), stock_qty=Decimal("50"), aliases=["chini"]),
    }
    return CatalogSnapshot(shop_id=shop.id, version=1, products=products, rendered="# CATALOG\n",
                           hints=["para", "chini"])


@pytest.fixture
def shop() -> Shop:
    s = Shop(name="t-scan", type="kirana", default_language="od-IN")
    s.id = uuid.uuid4()
    s.catalog_version = 1
    return s


@pytest.fixture(autouse=True)
def _no_db_catalog(monkeypatch, shop):
    async def fake(session, shop_id, *, use_cache=True):
        return _snapshot(shop)

    monkeypatch.setattr(catalog_svc, "load_snapshot", fake)


def _session_row(shop: Shop, mode: str = "sale") -> VoiceSession:
    vs = VoiceSession(shop_id=shop.id, client_session_id="c1", status="processing", input_kind="image",
                      input_mode=mode, image_count=1)
    vs.id = uuid.uuid4()
    return vs


def _bill(items: list[ExtractedItem], intent: Intent = Intent.sale) -> BillExtraction:
    return BillExtraction(intent=intent, items=items, customer_name=None, payment_mode=None, notes="",
                          transcript_language="mixed")


async def test_a_read_list_is_extracted_and_the_reader_output_is_kept(shop):
    read = ReadResult("stub:reader", "stub", ["chini 2 kg", "para 10"], script="mixed", notes="total 130",
                      raw={"unclear_lines": ["para 10"], "request_id": "r1"})
    extractor = StubExtractor(_bill([
        ExtractedItem(spoken_span="chini 2 kg", product_id="p002", product_name_guess="Sugar", quantity=2,
                      unit="kg", unit_price=None, alternatives=[], confidence=0.95, needs_review=False, reason=""),
        ExtractedItem(spoken_span="para 10", product_id="p001", product_name_guess="Paracetamol 500mg", quantity=10,
                      unit="strip", unit_price=None, alternatives=[], confidence=0.8, needs_review=False, reason=""),
    ]))
    vs = _session_row(shop)
    reader = StubReader(read)

    await process_image_session(StubSession(shop), vs, images=[ImageBlob(b"x", "image/jpeg")],
                               reader=reader, extractor=extractor)

    assert vs.status == "extracted"
    assert vs.ocr_text == "chini 2 kg | para 10"
    assert vs.ocr_meta["lines"] == ["chini 2 kg", "para 10"]
    assert vs.ocr_meta["unclear_lines"] == ["para 10"]
    assert vs.ocr_meta["notes"] == "total 130"
    # the extractor is told this is written input, by which reader, and which lines were doubtful
    ctx = extractor.seen["ctx"]
    assert ctx.input_source == "written" and ctx.reader == "stub:reader"
    assert ctx.unclear_lines == ["para 10"]
    assert extractor.seen["transcript"] == "chini 2 kg | para 10"
    assert extractor.seen["views"] == {}
    assert reader.hints == ["para", "chini"]
    assert vs.latencies["ocr_ms"] >= 0 and vs.latencies["total_ms"] >= 0
    assert vs.llm_output_json["items"][0]["product_id"] == "p002"


async def test_guards_still_fire_on_written_lines(shop):
    """A line with no number must not silently become quantity 1, and a product not in the catalog
    must not keep a high confidence just because the paper was legible."""
    read = ReadResult("stub:reader", "stub", ["chini", "shampoo 2"], raw={})
    extractor = StubExtractor(_bill([
        ExtractedItem(spoken_span="chini", product_id="p002", product_name_guess="Sugar", quantity=1, unit="kg",
                      unit_price=None, alternatives=[], confidence=0.99, needs_review=False, reason=""),
        ExtractedItem(spoken_span="shampoo 2", product_id="p999", product_name_guess="Shampoo", quantity=2,
                      unit="bottle", unit_price=None, alternatives=[], confidence=0.9, needs_review=False, reason=""),
    ]))
    vs = _session_row(shop)
    await process_image_session(StubSession(shop), vs, images=[ImageBlob(b"x", "image/jpeg")],
                               reader=StubReader(read), extractor=extractor)

    items = vs.llm_output_json["items"]
    assert items[0]["needs_review"] is True and "no_quantity" in items[0]["reason"]
    assert items[1]["product_id"] is None and "unknown_id" in items[1]["reason"]
    assert items[1]["confidence"] <= 0.59


async def test_a_photo_with_no_list_is_no_text_not_failed(shop):
    read = ReadResult("stub:reader", "stub", [], notes="This is a photo of a shelf.", raw={})
    extractor = StubExtractor(_bill([]))
    vs = _session_row(shop)
    await process_image_session(StubSession(shop), vs, images=[ImageBlob(b"x", "image/jpeg")],
                               reader=StubReader(read), extractor=extractor)
    assert vs.status == "no_text"
    assert "shelf" in vs.error
    assert extractor.seen is None  # no LLM call, so a misfired photo costs nothing


async def test_a_reader_failure_never_reaches_the_extractor(shop):
    read = ReadResult("stub:reader", "stub", [], error="api_error 429: quota")
    extractor = StubExtractor(_bill([]))
    vs = _session_row(shop)
    await process_image_session(StubSession(shop), vs, images=[ImageBlob(b"x", "image/jpeg")],
                               reader=StubReader(read), extractor=extractor)
    assert vs.status == "failed" and "quota" in vs.error
    assert vs.ocr_meta["error"] == "api_error 429: quota"
    assert extractor.seen is None


async def test_stock_in_mode_reaches_the_prompt(shop):
    read = ReadResult("stub:reader", "stub", ["chini 2 kg"], raw={})
    extractor = StubExtractor(_bill([], intent=Intent.purchase))
    vs = _session_row(shop, mode="stock_in")
    await process_image_session(StubSession(shop), vs, images=[ImageBlob(b"x", "image/jpeg")],
                               reader=StubReader(read), extractor=extractor)
    assert vs.status == "extracted"
    assert extractor.seen["ctx"].input_mode == "stock_in"


async def test_an_extractor_failure_leaves_the_read_text_for_the_shopkeeper(shop):
    read = ReadResult("stub:reader", "stub", ["chini 2 kg"], raw={})
    vs = _session_row(shop)
    await process_image_session(StubSession(shop), vs, images=[ImageBlob(b"x", "image/jpeg")],
                               reader=StubReader(read), extractor=StubExtractor(None, error="schema_invalid"))
    assert vs.status == "needs_manual" and vs.error == "schema_invalid"
    assert vs.ocr_text == "chini 2 kg"  # the lines are still shown, so the bill can be typed from them


async def test_a_priced_supplier_table_keeps_the_rate_and_the_columns(shop):
    """The reported fault: a 4-column list parsed everything except price per unit."""
    read = ReadResult("stub:reader", "stub", ["Sugar | 2 | kg | 45", "Paracetamol | 10 | strip | 18.5"],
                      columns=["Product", "Qty", "Unit", "Rate"], raw={})
    extractor = StubExtractor(_bill([
        ExtractedItem(spoken_span="Sugar | 2 | kg | 45", product_id="p002", product_name_guess="Sugar",
                      quantity=2, unit="kg", unit_price=45, alternatives=[], confidence=0.95,
                      needs_review=False, reason=""),
        ExtractedItem(spoken_span="Paracetamol | 10 | strip | 18.5", product_id="p001",
                      product_name_guess="Paracetamol 500mg", quantity=10, unit="strip", unit_price=18.5,
                      alternatives=[], confidence=0.93, needs_review=False, reason=""),
    ], intent=Intent.purchase))
    vs = _session_row(shop, mode="stock_in")
    await process_image_session(StubSession(shop), vs, images=[ImageBlob(b"x", "image/jpeg")],
                               reader=StubReader(read), extractor=extractor)

    assert vs.status == "extracted"
    assert vs.ocr_meta["columns"] == ["Product", "Qty", "Unit", "Rate"]
    assert extractor.seen["ctx"].columns == ["Product", "Qty", "Unit", "Rate"]
    items = vs.llm_output_json["items"]
    # the guards must not strip a written price: the row itself is the evidence for it
    assert [i["unit_price"] for i in items] == [45.0, 18.5]
    assert all("price_without_evidence" not in (i["reason"] or "") for i in items)
    # and the bill total the review screen shows is the sum of quantity x rate
    assert sum(i["quantity"] * i["unit_price"] for i in items) == 2 * 45 + 10 * 18.5
