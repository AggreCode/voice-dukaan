import uuid
from decimal import Decimal

from app.extraction.base import ShopContext
from app.extraction.mock import MockExtractor
from app.extraction.prompt import build_user_message
from app.models import Shop
from app.services.catalog import CatalogProduct, CatalogSnapshot, render_catalog
from app.services.locale import in_script, pick_local_name


def test_pick_local_name_by_shop_language():
    aliases = ["paracetamol", "पैरासिटामोल", "ପାରାସିଟାମଲ"]
    assert pick_local_name(aliases, "od-IN") == "ପାରାସିଟାମଲ"
    assert pick_local_name(aliases, "or-IN") == "ପାରାସିଟାମଲ"  # the code the shop form actually sends
    assert pick_local_name(aliases, "hi-IN") == "पैरासिटामोल"
    assert pick_local_name(aliases, "en-IN") is None
    assert pick_local_name(["crocin 500"], "od-IN") is None
    assert in_script("ଓଆରଏସ 3", "od") and not in_script("ORS ଓ", "od")


def test_stock_in_mode_reaches_prompt_and_mock():
    ctx = ShopContext(date_iso="2026-09-12", input_mode="stock_in")
    assert "STOCK IN" in build_user_message("paracetamol dasa patta", {}, ctx)
    assert "STOCK IN" not in build_user_message("x", {}, ShopContext(date_iso="2026-09-12"))


async def test_mock_extractor_defaults_to_purchase_in_stock_in_mode():
    snap = CatalogSnapshot(shop_id=uuid.uuid4(), version=1, products={}, rendered="", hints=[])
    out = await MockExtractor().extract(transcript="ors tini packet", secondary_views={}, catalog=snap,
                                        shop_ctx=ShopContext(input_mode="stock_in"))
    assert out.output.intent.value == "purchase"


def test_catalog_block_lists_local_name_first():
    shop = Shop(id=uuid.uuid4(), name="s", type="medical", catalog_version=1)
    prod = CatalogProduct(id=uuid.uuid4(), code="p001", name="ORS Electral", brand="FDC", category="medicine",
                          pack_unit="packet", sub_unit="packet", pack_size=Decimal(1), sell_price=Decimal(22),
                          stock_qty=Decimal(0), aliases=["ors"], local_name="ଓଆରଏସ")
    assert "p001|ORS Electral|FDC|ଓଆରଏସ,ors|packet" in render_catalog(shop, [prod])
