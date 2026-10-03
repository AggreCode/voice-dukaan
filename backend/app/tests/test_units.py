"""Units: every way of saying one, and the arithmetic between those that measure the same thing."""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.services.units import normalize_unit, unit_factor


@pytest.mark.parametrize("said", ["g", "gm", "gms", "gram", "Grams", "GRM", "ग्राम", "ଗ୍ରାମ"])
def test_every_way_of_saying_gram_is_one_unit(said):
    assert normalize_unit(said) == "g"


@pytest.mark.parametrize("said", ["kg", "Kg", "KGS", "kilo", "kilogram", "किलो", "କେଜି", "କିଲୋ"])
def test_every_way_of_saying_kilo_is_one_unit(said):
    assert normalize_unit(said) == "kg"


def test_the_arithmetic():
    assert unit_factor("gram", "Kg") == Decimal("0.001")
    assert unit_factor("kg", "g") == Decimal("1000")
    assert unit_factor("ml", "ltr") == Decimal("0.001")
    assert unit_factor("dozen", "pcs") == Decimal("12")
    assert unit_factor("pkt", "packet") == Decimal("1")
    assert unit_factor("", "kg") == Decimal("1"), "no unit said means the product's own"


def test_units_that_measure_different_things_do_not_convert():
    """The Bhusi case: stocked in grams, sold "1 packet". There is no honest number of grams."""
    assert unit_factor("packet", "g") is None
    assert unit_factor("kg", "litre") is None
    assert unit_factor("piece", "kg") is None
