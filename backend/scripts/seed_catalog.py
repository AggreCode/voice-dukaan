"""Seed a shop and its catalog from a CSV.

Usage (from backend/):  python scripts/seed_catalog.py --shop-name "Maa Tarini Medical" --type medical \
                            --csv ../eval/data/catalog_medical.csv [--pin 1234]
Prints the shop id to use in the frontend (X-Shop-Id).
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.api.deps import hash_pin  # noqa: E402
from app.db import get_sessionmaker  # noqa: E402
from app.models import Product, ProductAlias, Shop, User  # noqa: E402
from app.services.ledger import apply_stock_movement  # noqa: E402
from app.services.locale import pick_local_name  # noqa: E402


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--shop-name", required=True)
    ap.add_argument("--type", default="general", choices=["medical", "kirana", "general"])
    ap.add_argument("--csv", required=True)
    ap.add_argument("--pin", default="")
    ap.add_argument("--shop-id", default=None, help="add products to an existing shop instead of creating one")
    args = ap.parse_args()

    async with get_sessionmaker()() as session:
        if args.shop_id:
            shop = await session.get(Shop, args.shop_id)
            if shop is None:
                raise SystemExit("shop not found")
        else:
            shop = Shop(name=args.shop_name, type=args.type)
            session.add(shop)
            await session.flush()
            session.add(User(shop_id=shop.id, display_name="Owner", pin_hash=hash_pin(args.pin), role="owner"))

        existing = {(p.name.casefold(), p.brand.casefold()): p for p in (await session.execute(
            select(Product).where(Product.shop_id == shop.id))).scalars().all()}
        codes = [int(p.code[1:]) for p in existing.values() if p.code[1:].isdigit()]
        n = max(codes) if codes else 0
        created = 0
        with open(args.csv, encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                key = (row["name"].casefold(), (row.get("brand") or "").casefold())
                if key in existing:
                    continue
                n += 1
                row_aliases = [x.strip() for x in (row.get("aliases") or "").split(";") if x.strip()]
                p = Product(
                    shop_id=shop.id, code=f"p{n:03d}", name=row["name"].strip(), brand=(row.get("brand") or "").strip(),
                    category=row.get("category") or "general", unit=row.get("unit") or "piece",
                    sell_price=Decimal(row.get("sell_price") or "0"),
                    local_name=(row.get("local_name") or "").strip() or pick_local_name(row_aliases, shop.default_language),
                )
                session.add(p)
                await session.flush()
                for a in dict.fromkeys(row_aliases):
                    session.add(ProductAlias(product_id=p.id, alias=a, source="seed"))
                opening = row.get("opening_stock")
                if opening and Decimal(opening) != 0:
                    await apply_stock_movement(session, p, Decimal(opening), reason="opening", ref_type="manual",
                                               ref_id=None)
                created += 1
        shop.catalog_version += 1
        await session.commit()
        print(f"shop_id={shop.id}  name={shop.name}  type={shop.type}  products_created={created}")


if __name__ == "__main__":
    asyncio.run(main())
