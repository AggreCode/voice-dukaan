"""One spelling per unit, and the arithmetic between units that measure the same thing.

A shopkeeper says "500 gram", "500 gm", "500 g" or "୫୦୦ ଗ୍ରାମ" and means one thing; the product may be
stocked as "Kg", "kg" or "kilo" and that is one thing too. Before this table the app compared the
words, found "g" and "kg" different, and quietly billed 500 grams of butter at the per-kilo price:
500 x ₹120 = ₹60,000, with 500 kg taken off the shelf.

Units in the same family convert (g/kg/quintal, ml/litre, piece/dozen). Packaging words (packet,
strip, bottle, box...) only convert to themselves: a "packet" of something stocked in grams says
nothing about how many grams, so that is an error for the shopkeeper to settle, never a guess.

frontend/src/lib/units.ts is GENERATED from this file ;
after editing a unit here, regenerate it with scripts/gen_units_ts.py so the phone shows the totals the server saves.
"""
from __future__ import annotations

from decimal import Decimal

# canonical -> (family, size in the family's base unit)
_SIZES: dict[str, tuple[str, Decimal]] = {
    "g": ("mass", Decimal("1")),
    "kg": ("mass", Decimal("1000")),
    "quintal": ("mass", Decimal("100000")),
    "ml": ("volume", Decimal("1")),
    "litre": ("volume", Decimal("1000")),
    "piece": ("count", Decimal("1")),
    "dozen": ("count", Decimal("12")),
}

_SYNONYMS: dict[str, tuple[str, ...]] = {
    "g": ("g", "gm", "gms", "gram", "grams", "gramme", "grammes", "gr", "grm", "grms", "ग्राम", "ଗ୍ରାମ", "ଗ୍ରାମ୍"),
    "kg": ("kg", "kgs", "kilo", "kilos", "kilogram", "kilograms", "kilogramme", "kejee", "keji", "kg.",
           "किलो", "किलोग्राम", "କିଲୋ", "କେଜି", "କିଲୋଗ୍ରାମ"),
    "quintal": ("quintal", "quintals", "qtl", "qntl", "क्विंटल", "କ୍ୱିଣ୍ଟାଲ"),
    "ml": ("ml", "mls", "millilitre", "millilitres", "milliliter", "milliliters", "mili", "एमएल", "ମିଲି"),
    "litre": ("litre", "litres", "liter", "liters", "l", "ltr", "ltrs", "lt", "lita", "लीटर", "लिटर", "ଲିଟର", "ଲିଟର୍"),
    "piece": ("piece", "pieces", "pc", "pcs", "nos", "no", "number", "nag", "gota", "gote", "unit", "units",
              "tablet", "tablets", "goli", "khanda", "पीस", "नग", "ଗୋଟା", "ଗୋଟେ", "ଟା", "ଖଣ୍ଡ"),
    "dozen": ("dozen", "dozens", "dz", "doz", "darjan", "दर्जन", "ଡଜନ"),
    "packet": ("packet", "packets", "pkt", "pkts", "pack", "packs", "pouch", "sachet", "pakat", "puda",
               "pudia", "पैकेट", "ପ୍ୟାକେଟ", "ପ୍ୟାକେଟ୍", "ପ୍ୟାକେଟ"),
    "strip": ("strip", "strips", "patta", "patti", "pata", "पत्ता", "पत्ती", "स्ट्रिप", "ପତା", "ଷ୍ଟ୍ରିପ"),
    "bottle": ("bottle", "bottles", "btl", "botal", "sisi", "shishi", "बोतल", "ବୋତଲ", "ବୋତଲ୍"),
    "box": ("box", "boxes", "dabba", "dibba", "baksa", "डिब्बा", "ଡବା"),
    "carton": ("carton", "cartons", "peti", "case", "cases", "पेटी", "ପେଟି"),
    "bag": ("bag", "bags", "bora", "sack", "sacks", "बोरा", "ବସ୍ତା"),
    "bundle": ("bundle", "bundles", "gathi", "bandal"),
    "can": ("can", "cans", "tin", "tins"),
    "jar": ("jar", "jars"),
    "tube": ("tube", "tubes"),
    "roll": ("roll", "rolls"),
}

_LOOKUP = {s: canon for canon, syns in _SYNONYMS.items() for s in syns}


def normalize_unit(unit: str | None) -> str:
    """The one spelling for a unit word, or the word itself lowercased when it is not in the table."""
    u = (unit or "").strip().casefold().rstrip(".")
    return _LOOKUP.get(u, u)


def unit_factor(from_unit: str | None, to_unit: str | None) -> Decimal | None:
    """How many `to_unit` one `from_unit` is: 1 g -> kg is 0.001. None when they cannot be converted."""
    a, b = normalize_unit(from_unit), normalize_unit(to_unit)
    if not a or not b or a == b:
        return Decimal("1")
    fa, fb = _SIZES.get(a), _SIZES.get(b)
    if fa is None or fb is None or fa[0] != fb[0]:
        return None
    return fa[1] / fb[1]
