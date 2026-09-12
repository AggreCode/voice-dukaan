"""There is no unit conversion any more: a product has exactly one unit and stock moves in it."""
from decimal import Decimal

from app.models import Product


def _p(unit="strip", price="20"):
    return Product(code="p001", name="x", brand="", unit=unit, sell_price=Decimal(price))


def test_product_has_a_single_unit():
    p = _p(unit="carton")
    assert p.unit == "carton" and p.sell_price == Decimal("20")


def test_price_is_per_unit_directly():
    assert _p(unit="kg", price="42").sell_price == Decimal("42")
