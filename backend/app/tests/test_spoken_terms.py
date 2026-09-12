"""Alias learning must generalise (drop quantities) without hiding other products."""
import uuid
from decimal import Decimal

from app.services.catalog import CatalogProduct, build_hints
from app.services.spoken import clean_learned_alias, strip_quantity_words


def test_strip_quantity_words():
    assert strip_quantity_words("2 packet biscuit") == "biscuit"
    assert strip_quantity_words("ବ୍ରାଣ୍ଡେଡ୍ ଏକ ପ୍ୟାକେଟ୍") == "ବ୍ରାଣ୍ଡେଡ୍"
    assert strip_quantity_words("ଦୁଇ ପ୍ୟାକେଟ୍ ଓଆର୍ଏସ୍") == "ଓଆର୍ଏସ୍"
    assert strip_quantity_words("4 kg chicken") == "chicken"
    assert strip_quantity_words("10 packet") == ""


def test_alias_is_learned_when_it_belongs_to_nobody_else():
    assert clean_learned_alias("2 packet battery", {"biscuit parle g", "besan"}) == "battery"


def test_alias_is_refused_when_it_shadows_another_product():
    shop_terms = {"biscuit parle g", "biscuit good day", "marie gold"}
    assert clean_learned_alias("2 packet biscuit", shop_terms) is None  # would hide both biscuits
    assert clean_learned_alias("dui patta crocin", {"crocin 500"}) is None
    assert clean_learned_alias("10 packet", {"anything"}) is None


def _p(code, name, brand, aliases, sold=0):
    return CatalogProduct(id=uuid.uuid4(), code=code, name=name, brand=brand, category="general", unit="packet",
                          sell_price=Decimal(10), stock_qty=Decimal(0), aliases=list(aliases), sold_count=sold)


def test_hints_use_spoken_words_not_category_names():
    hints = build_hints([
        _p("p037", "Biscuit Parle G", "Parle", ["parle g", "ପାର୍ଲେ"], sold=1),
        _p("p039", "Biscuit Good Day", "Britannia", ["good day", "4 packet biscuit"], sold=3),
        _p("p087", "Batteries AA", "Eveready", ["battery", "cell", "ବ୍ୟାଟେରୀ"], sold=2),
        _p("p001", "Rice Swarna", "Loose", [], sold=0),
    ])
    assert "battery" in hints and "parle g" in hints and "good day" in hints
    assert not any(h.casefold().startswith("biscuit") for h in hints)  # the confusable category word
    assert not any(h[0].isdigit() for h in hints)  # no "4 packet biscuit"
    assert "Loose" not in hints and len(hints) == len(set(hints))
