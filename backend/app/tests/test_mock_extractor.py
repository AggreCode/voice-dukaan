import uuid

from app.extraction.base import ShopContext
from app.extraction.mock import MockExtractor
from app.services.catalog import CatalogSnapshot


async def test_mock_extractor_splits_on_markers_and_commas_zero_cost():
    snap = CatalogSnapshot(shop_id=uuid.uuid4(), version=1, products={}, rendered="", hints=[])
    ctx = ShopContext(shop_type="medical", date_iso="2026-09-11", detected_language="od-IN")
    out = await MockExtractor().extract(
        transcript="paracetamol dasa gota | crocin dui patta, ors tini packet",
        secondary_views={}, catalog=snap, shop_ctx=ctx,
    )
    assert out.output is not None
    assert out.usage == {"input_tokens": 0, "output_tokens": 0, "cache_read_input_tokens": 0}
    spans = [i.spoken_span for i in out.output.items]
    assert spans == ["paracetamol dasa gota", "crocin dui patta", "ors tini packet"]
    assert all(i.product_id is None and i.needs_review and i.reason == "mock_extractor_no_llm"
               for i in out.output.items)
