from __future__ import annotations

import csv
import io
import uuid
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_shop
from app.db import get_session
from app.models import Product, ProductAlias, Shop, StockLedger, TransactionItem
from app.schemas.api import (
    STOCK_REASONS,
    AliasIn,
    ProductIn,
    ProductOut,
    ProductPatch,
    StockAdjustIn,
    StockCountIn,
    StockMovementOut,
)
from app.services import catalog as catalog_svc
from app.services.ledger import apply_stock_movement, to_base_qty
from app.services.locale import pick_local_name

router = APIRouter(prefix="/api/products", tags=["products"])


def _out(p: Product) -> ProductOut:
    return ProductOut(
        id=p.id, code=p.code, name=p.name, local_name=p.local_name, brand=p.brand, category=p.category,
        pack_unit=p.pack_unit, sub_unit=p.sub_unit, pack_size=p.pack_size, sell_price=p.sell_price,
        cost_price=p.cost_price, stock_qty=p.stock_qty, low_stock_threshold=p.low_stock_threshold,
        is_active=p.is_active, aliases=[a.alias for a in p.aliases],
    )


async def _load(session: AsyncSession, shop: Shop, product_id: uuid.UUID) -> Product:
    p = (await session.execute(select(Product).where(Product.id == product_id)
                               .execution_options(populate_existing=True))).scalar_one_or_none()
    if p is None or p.shop_id != shop.id:
        raise HTTPException(404, "product not found")
    return p


async def _bump(shop: Shop) -> None:
    shop.catalog_version += 1
    catalog_svc.invalidate(shop.id)


def _units_for(p: Product) -> set[str]:
    return {p.pack_unit, p.sub_unit, "dozen", "kg", "g", "litre", "ml"}


def _to_base(p: Product, qty: Decimal, unit: str | None) -> Decimal:
    if unit is None or unit == p.sub_unit:
        return qty
    if unit not in _units_for(p):
        raise HTTPException(400, f"unit must be {p.pack_unit} or {p.sub_unit} for {p.name}")
    return to_base_qty(qty, unit, p)


@router.get("", response_model=list[ProductOut])
async def list_products(q: str | None = None, low_stock: bool = False, include_inactive: bool = False,
                        shop: Shop = Depends(current_shop), session: AsyncSession = Depends(get_session)):
    stmt = select(Product).where(Product.shop_id == shop.id)
    if not include_inactive:
        stmt = stmt.where(Product.is_active.is_(True))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(Product.name.ilike(like) | Product.brand.ilike(like) | Product.local_name.ilike(like))
    if low_stock:
        stmt = stmt.where(Product.stock_qty <= Product.low_stock_threshold)
    rows = (await session.execute(stmt.order_by(Product.name))).scalars().all()
    return [_out(p) for p in rows]


@router.post("", response_model=ProductOut, status_code=201)
async def create_product(body: ProductIn, shop: Shop = Depends(current_shop),
                         session: AsyncSession = Depends(get_session)):
    aliases = list(dict.fromkeys(x.strip() for x in body.aliases if x.strip()))
    local = (body.local_name or "").strip() or pick_local_name(aliases, shop.default_language)
    code = await catalog_svc.next_product_code(session, shop.id)
    p = Product(shop_id=shop.id, code=code, name=body.name.strip(), local_name=local, brand=body.brand.strip(),
                category=body.category, pack_unit=body.pack_unit, sub_unit=body.sub_unit, pack_size=body.pack_size,
                sell_price=body.sell_price, cost_price=body.cost_price, low_stock_threshold=body.low_stock_threshold)
    session.add(p)
    await session.flush()
    for a in aliases:
        session.add(ProductAlias(product_id=p.id, alias=a, source="seed"))
    if body.opening_stock:
        base = _to_base(p, body.opening_stock, body.opening_stock_unit)
        await apply_stock_movement(session, p, base, reason="opening", ref_type="manual", ref_id=None)
    await _bump(shop)
    await session.commit()
    return _out(await _load(session, shop, p.id))


@router.patch("/{product_id}", response_model=ProductOut)
async def patch_product(product_id: uuid.UUID, body: ProductPatch, shop: Shop = Depends(current_shop),
                        session: AsyncSession = Depends(get_session)):
    p = await _load(session, shop, product_id)
    data = body.model_dump(exclude_none=True)
    if "local_name" in data:
        data["local_name"] = data["local_name"].strip() or None
    for k, v in data.items():
        setattr(p, k, v)
    await _bump(shop)
    await session.commit()
    return _out(await _load(session, shop, product_id))


@router.post("/{product_id}/stock", response_model=ProductOut)
async def adjust_stock(product_id: uuid.UUID, body: StockAdjustIn, shop: Shop = Depends(current_shop),
                       session: AsyncSession = Depends(get_session)):
    p = await _load(session, shop, product_id)
    if body.reason not in STOCK_REASONS:
        raise HTTPException(400, f"reason must be one of {sorted(STOCK_REASONS)}")
    if body.qty is not None:
        delta = _to_base(p, body.qty, body.unit)
    elif body.delta_qty is not None:
        delta = body.delta_qty
    else:
        raise HTTPException(400, "send qty with unit, or delta_qty")
    if delta == 0:
        raise HTTPException(400, "quantity must not be zero")
    await apply_stock_movement(session, p, delta, reason=body.reason, ref_type="manual", ref_id=None, note=body.note)
    await session.commit()
    return _out(await _load(session, shop, product_id))


@router.post("/{product_id}/stock/count", response_model=ProductOut)
async def count_stock(product_id: uuid.UUID, body: StockCountIn, shop: Shop = Depends(current_shop),
                      session: AsyncSession = Depends(get_session)):
    """Physical count: set stock to what the shopkeeper counted and record the difference."""
    p = await _load(session, shop, product_id)
    counted = _to_base(p, body.counted_qty, body.unit)
    delta = counted - (p.stock_qty or Decimal("0"))
    await apply_stock_movement(session, p, delta, reason="count", ref_type="manual", ref_id=None,
                               note=body.note or f"counted {body.counted_qty} {body.unit or p.sub_unit}")
    await session.commit()
    return _out(await _load(session, shop, product_id))


@router.get("/{product_id}/ledger", response_model=list[StockMovementOut])
async def product_ledger(product_id: uuid.UUID, limit: int = 50, shop: Shop = Depends(current_shop),
                         session: AsyncSession = Depends(get_session)):
    p = await _load(session, shop, product_id)
    rows = (await session.execute(select(StockLedger).where(StockLedger.product_id == p.id)
                                  .order_by(StockLedger.created_at.desc()).limit(max(1, min(limit, 200))))).scalars().all()
    item_ids = [r.ref_id for r in rows if r.ref_type == "transaction_item" and r.ref_id]
    txn_of: dict[uuid.UUID, uuid.UUID] = {}
    if item_ids:
        for ti_id, txn_id in (await session.execute(select(TransactionItem.id, TransactionItem.transaction_id)
                                                     .where(TransactionItem.id.in_(item_ids)))).all():
            txn_of[ti_id] = txn_id
    return [StockMovementOut(id=r.id, created_at=r.created_at, delta_qty=r.delta_qty, balance_after=r.balance_after,
                             reason=r.reason, ref_type=r.ref_type, note=r.note,
                             transaction_id=txn_of.get(r.ref_id) if r.ref_id else None) for r in rows]


@router.post("/{product_id}/aliases", response_model=ProductOut)
async def add_alias(product_id: uuid.UUID, body: AliasIn, shop: Shop = Depends(current_shop),
                    session: AsyncSession = Depends(get_session)):
    p = await _load(session, shop, product_id)
    alias = body.alias.strip()
    if alias and alias not in [a.alias for a in p.aliases]:
        session.add(ProductAlias(product_id=p.id, alias=alias, lang=body.lang, source="seed"))
        await _bump(shop)
        await session.commit()
    return _out(await _load(session, shop, product_id))


@router.delete("/{product_id}/aliases/{alias}", response_model=ProductOut)
async def delete_alias(product_id: uuid.UUID, alias: str, shop: Shop = Depends(current_shop),
                       session: AsyncSession = Depends(get_session)):
    p = await _load(session, shop, product_id)
    for a in list(p.aliases):
        if a.alias == alias:
            await session.delete(a)
    await _bump(shop)
    await session.commit()
    return _out(await _load(session, shop, product_id))


@router.post("/import", response_model=dict)
async def import_csv(file: UploadFile = File(...), shop: Shop = Depends(current_shop),
                     session: AsyncSession = Depends(get_session)):
    """CSV columns: name, brand, category, pack_unit, sub_unit, pack_size, sell_price, cost_price,
    aliases (; separated), opening_stock (base units), local_name. Only name is required."""
    text = (await file.read()).decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    existing = {(p.name.casefold(), p.brand.casefold()): p for p in (await session.execute(
        select(Product).where(Product.shop_id == shop.id))).scalars().all()}
    alias_sets = {key: {a.alias for a in prod.aliases} for key, prod in existing.items()}
    created = updated = 0
    try:
        for row in reader:
            name = (row.get("name") or "").strip()
            if not name:
                continue
            brand = (row.get("brand") or "").strip()
            key = (name.casefold(), brand.casefold())
            aliases = [a.strip() for a in (row.get("aliases") or "").split(";") if a.strip()]
            if key in existing:
                p = existing[key]
                updated += 1
            else:
                p = Product(shop_id=shop.id, code=await catalog_svc.next_product_code(session, shop.id), name=name,
                            brand=brand)
                session.add(p)
                await session.flush()
                existing[key] = p
                alias_sets[key] = set()
                created += 1
            p.category = (row.get("category") or p.category or "general").strip()
            p.pack_unit = (row.get("pack_unit") or p.pack_unit or "piece").strip()
            p.sub_unit = (row.get("sub_unit") or p.sub_unit or "piece").strip()
            p.pack_size = Decimal(row.get("pack_size") or p.pack_size or "1")
            p.sell_price = Decimal(row.get("sell_price") or p.sell_price or "0")
            if row.get("cost_price"):
                p.cost_price = Decimal(row["cost_price"])
            have = alias_sets[key]
            for a in aliases:
                if a not in have:
                    session.add(ProductAlias(product_id=p.id, alias=a, source="seed"))
                    have.add(a)
            local = (row.get("local_name") or "").strip() or pick_local_name(aliases, shop.default_language)
            if local:
                p.local_name = local
            opening = row.get("opening_stock")
            if opening and Decimal(opening) != 0:
                await apply_stock_movement(session, p, Decimal(opening), reason="opening", ref_type="manual",
                                           ref_id=None)
    except (InvalidOperation, ValueError) as e:
        await session.rollback()
        raise HTTPException(400, f"bad number in CSV: {e}") from e
    await _bump(shop)
    await session.commit()
    return {"created": created, "updated": updated}
