from decimal import Decimal

from app.models import Product
from app.services.ledger import price_for, to_base_qty


def _p(pack_unit="strip", sub_unit="piece", pack_size="10", price="20"):
    return Product(code="p001", name="x", brand="", pack_unit=pack_unit, sub_unit=sub_unit,
                   pack_size=Decimal(pack_size), sell_price=Decimal(price))


def test_strip_to_pieces():
    assert to_base_qty(Decimal(2), "strip", _p()) == Decimal(20)


def test_piece_stays_piece():
    assert to_base_qty(Decimal(7), "piece", _p()) == Decimal(7)


def test_kg_grams():
    assert to_base_qty(Decimal("0.5"), "kg", _p("kg", "g", "1000", "42")) == Decimal(500)
    assert to_base_qty(Decimal("250"), "g", _p("kg", "kg", "1", "42")) == Decimal("0.25")


def test_dozen_to_pieces():
    assert to_base_qty(Decimal(2), "dozen", _p("dozen", "piece", "12", "84")) == Decimal(24)


def test_price_per_unit():
    p = _p()
    assert price_for("strip", p) == Decimal(20)
    assert price_for("piece", p) == Decimal("2.00")
