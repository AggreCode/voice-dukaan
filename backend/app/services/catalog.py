"""Shop catalog snapshot: the compact text block Claude sees (cached), plus STT hints.

The rendered text must be byte-stable for a given (shop_id, catalog_version): products sorted by code,
aliases sorted, no timestamps or stock counts (those change per request and would bust the cache).
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Product, ProductAlias, Shop

MAX_ALIASES_IN_COLUMN = 6
MAX_LEARNED_LINES = 300
MAX_HINTS = 50


@dataclass
class CatalogProduct:
    id: uuid.UUID
    code: str
    name: str
    brand: str
    category: str
    pack_unit: str
    sub_unit: str
    pack_size: Decimal
    sell_price: Decimal
    stock_qty: Decimal
    aliases: list[str] = field(default_factory=list)
    learned: list[str] = field(default_factory=list)
    local_name: str | None = None
    sold_count: int = 0


@dataclass
class CatalogSnapshot:
    shop_id: uuid.UUID
    version: int
    products: dict[str, CatalogProduct]  # by code
    rendered: str
    hints: list[str]

    def by_uuid(self, pid: uuid.UUID) -> CatalogProduct | None:
        for p in self.products.values():
            if p.id == pid:
                return p
        return None


_cache: dict[tuple[uuid.UUID, int], CatalogSnapshot] = {}


def _fmt(d: Decimal) -> str:
    s = format(d.normalize(), "f")
    return s if s != "-0" else "0"


def render_catalog(shop: Shop, products: list[CatalogProduct]) -> str:
    lines = [
        f"# CATALOG v{shop.catalog_version} shop={shop.id} type={shop.type}",
        "# id|name|brand|aliases|pack_unit|sub_unit|pack_size|price_inr|category",
    ]
    learned_lines: list[str] = []
    for p in sorted(products, key=lambda x: x.code):
        base = sorted(set(a for a in p.aliases if a))
        if p.local_name and p.local_name not in base:
            base = [p.local_name, *base]
        aliases = base[:MAX_ALIASES_IN_COLUMN]
        lines.append("|".join([
            p.code, p.name, p.brand or "-", ",".join(aliases) or "-",
            p.pack_unit, p.sub_unit, _fmt(p.pack_size), _fmt(p.sell_price), p.category,
        ]))
        for phrase in sorted(set(p.learned)):
            learned_lines.append(f'"{phrase}" -> {p.code}')
    if learned_lines:
        lines.append("")
        lines.append("# LEARNED from this shop's corrections (spoken phrase -> id):")
        lines.extend(learned_lines[:MAX_LEARNED_LINES])
    return "\n".join(lines) + "\n"


def build_hints(products: list[CatalogProduct], limit: int = MAX_HINTS) -> list[str]:
    """Product names/brands most worth boosting in the ASR: most-sold first, then the rest."""
    ranked = sorted(products, key=lambda p: (-p.sold_count, p.code))
    out: list[str] = []
    seen: set[str] = set()
    for p in ranked:
        for term in [p.name, p.brand, *p.learned[:1]]:
            t = (term or "").strip()
            if t and t != "-" and t.casefold() not in seen and len(t) <= 64:
                seen.add(t.casefold())
                out.append(t)
                if len(out) >= limit:
                    return out
    return out


async def load_snapshot(session: AsyncSession, shop_id: uuid.UUID, *, use_cache: bool = True) -> CatalogSnapshot:
    shop = await session.get(Shop, shop_id)
    if shop is None:
        raise LookupError(f"shop {shop_id} not found")
    key = (shop.id, shop.catalog_version)
    if use_cache and key in _cache:
        return _cache[key]

    rows = (await session.execute(
        select(Product).where(Product.shop_id == shop_id, Product.is_active.is_(True))
    )).scalars().all()
    products: list[CatalogProduct] = []
    for r in rows:
        seed = [a.alias for a in r.aliases if a.source != "user_correction"]
        learned = [a.alias for a in r.aliases if a.source == "user_correction"]
        products.append(CatalogProduct(
            id=r.id, code=r.code, name=r.name, brand=r.brand, category=r.category,
            pack_unit=r.pack_unit, sub_unit=r.sub_unit, pack_size=r.pack_size, sell_price=r.sell_price,
            stock_qty=r.stock_qty, aliases=seed, learned=learned, sold_count=r.sold_count, local_name=r.local_name,
        ))
    snap = CatalogSnapshot(
        shop_id=shop.id, version=shop.catalog_version,
        products={p.code: p for p in products},
        rendered=render_catalog(shop, products),
        hints=build_hints(products),
    )
    # keep the cache small: only the latest version per shop
    for k in [k for k in _cache if k[0] == shop.id]:
        del _cache[k]
    _cache[key] = snap
    return snap


def invalidate(shop_id: uuid.UUID) -> None:
    for k in [k for k in _cache if k[0] == shop_id]:
        del _cache[k]


async def next_product_code(session: AsyncSession, shop_id: uuid.UUID) -> str:
    codes = (await session.execute(select(Product.code).where(Product.shop_id == shop_id))).scalars().all()
    nums = [int(c[1:]) for c in codes if c.startswith("p") and c[1:].isdigit()]
    return f"p{(max(nums) + 1) if nums else 1:03d}"


__all__ = ["CatalogProduct", "CatalogSnapshot", "ProductAlias", "load_snapshot", "invalidate", "render_catalog",
           "build_hints", "next_product_code"]
