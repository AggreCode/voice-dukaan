import uuid
from decimal import Decimal

from app.models import Shop
from app.services.catalog import CatalogProduct, build_hints, render_catalog


def _prod(code, name, aliases=(), learned=(), sold=0):
    return CatalogProduct(id=uuid.uuid4(), code=code, name=name, brand="B", category="medicine", pack_unit="strip",
                          sub_unit="piece", pack_size=Decimal(10), sell_price=Decimal("20.50"), stock_qty=Decimal(5),
                          aliases=list(aliases), learned=list(learned), sold_count=sold)


def test_render_is_sorted_stable_and_has_learned_section():
    shop = Shop(id=uuid.uuid4(), name="s", type="medical", catalog_version=3)
    a = render_catalog(shop, [_prod("p002", "Crocin", ["krocin"], ["kroshin dui patta"]),
                              _prod("p001", "Paracetamol", ["pcm", "para"])])
    b = render_catalog(shop, [_prod("p001", "Paracetamol", ["para", "pcm"]),
                              _prod("p002", "Crocin", ["krocin"], ["kroshin dui patta"])])
    assert a == b
    lines = a.splitlines()
    assert lines[0].startswith("# CATALOG v3")
    assert lines[2].startswith("p001|Paracetamol|B|para,pcm|strip|piece|10|20.5|medicine")
    assert '"kroshin dui patta" -> p002' in a
    assert "stock" not in a.lower()


def test_hints_prefer_most_sold():
    hints = build_hints([_prod("p001", "Paracetamol", sold=1), _prod("p002", "Crocin", sold=10)], limit=3)
    assert hints[0] == "Crocin"
    assert len(hints) <= 3
