"""Saving a reviewed bill: transaction + items + stock ledger + corrections + learned aliases,
all in one DB transaction."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Correction,
    Product,
    ProductAlias,
    Shop,
    StockLedger,
    Transaction,
    TransactionItem,
    VoiceSession,
)
from app.schemas.api import SaveBillIn
from app.services import catalog as catalog_svc

PACK_UNITS = {"strip", "packet", "bottle", "box", "carton", "bundle", "dozen"}


def to_base_qty(qty: Decimal, unit: str, product: Product) -> Decimal:
    """Convert a spoken quantity to the product's sub_unit (stock base unit)."""
    unit = unit or product.pack_unit
    if unit == product.sub_unit:
        return qty
    if unit == product.pack_unit:
        return qty * product.pack_size
    if unit == "dozen" and product.sub_unit == "piece":
        return qty * 12
    if unit == "kg" and product.sub_unit == "g":
        return qty * 1000
    if unit == "g" and product.sub_unit == "kg":
        return qty / 1000
    if unit == "litre" and product.sub_unit == "ml":
        return qty * 1000
    if unit == "ml" and product.sub_unit == "litre":
        return qty / 1000
    if unit in PACK_UNITS and product.sub_unit == "piece":
        return qty * product.pack_size
    return qty


def price_for(unit: str, product: Product) -> Decimal:
    """Default price for a unit given the catalog sell_price (per pack_unit)."""
    if unit == product.pack_unit or not unit:
        return product.sell_price
    if unit == product.sub_unit and product.pack_size:
        return (product.sell_price / product.pack_size).quantize(Decimal("0.01"))
    return product.sell_price


async def apply_stock_movement(session: AsyncSession, product: Product, delta: Decimal, *, reason: str,
                               ref_type: str | None, ref_id: uuid.UUID | None, note: str | None = None) -> StockLedger:
    locked = (await session.execute(
        select(Product).where(Product.id == product.id).with_for_update()
        .execution_options(populate_existing=True))).scalar_one()
    locked.stock_qty = (locked.stock_qty or Decimal("0")) + delta
    row = StockLedger(shop_id=locked.shop_id, product_id=locked.id, delta_qty=delta, reason=reason,
                      ref_type=ref_type, ref_id=ref_id, balance_after=locked.stock_qty, note=note)
    session.add(row)
    return row


async def save_reviewed_bill(session: AsyncSession, shop_id: uuid.UUID, body: SaveBillIn) -> Transaction:
    shop = await session.get(Shop, shop_id)
    if shop is None:
        raise LookupError("shop not found")
    codes = {i.product_code for i in body.items}
    products = {p.code: p for p in (await session.execute(
        select(Product).where(Product.shop_id == shop_id, Product.code.in_(codes)))).scalars().all()}
    missing = codes - products.keys()
    if missing:
        raise ValueError(f"unknown product codes: {sorted(missing)}")

    vs: VoiceSession | None = None
    llm_items: list[dict] = []
    if body.voice_session_id:
        vs = await session.get(VoiceSession, body.voice_session_id)
        if vs is not None and vs.shop_id != shop_id:
            raise ValueError("voice session belongs to a different shop")
        if vs is not None and vs.llm_output_json:
            llm_items = vs.llm_output_json.get("items", [])

    txn = Transaction(shop_id=shop_id, voice_session_id=body.voice_session_id, type=body.type,
                      customer_name=body.customer_name, payment_mode=body.payment_mode or "cash",
                      notes=body.notes, status="saved")
    session.add(txn)
    await session.flush()

    total = Decimal("0")
    sign = Decimal("-1") if body.type == "sale" else Decimal("1")
    catalog_changed = False

    for item in body.items:
        product = products[item.product_code]
        qty_base = to_base_qty(item.qty, item.unit, product)
        line_total = (item.qty * item.unit_price).quantize(Decimal("0.01"))
        total += line_total
        llm = None
        if vs is not None and item.item_index is not None and 0 <= item.item_index < len(llm_items):
            llm = llm_items[item.item_index]
        # corrected = the shopkeeper changed what the model proposed (product, quantity or unit) or added the line
        if vs is None:
            was_corrected = False
        elif llm is None:
            was_corrected = True
        else:
            was_corrected = (llm.get("product_id") != item.product_code or llm.get("quantity") != float(item.qty)
                             or llm.get("unit") != item.unit)
        ti = TransactionItem(transaction_id=txn.id, product_id=product.id, qty=item.qty, unit=item.unit,
                             qty_base=qty_base, unit_price=item.unit_price, line_total=line_total,
                             spoken_span=item.spoken_span, llm_confidence=item.llm_confidence,
                             was_corrected=was_corrected)
        session.add(ti)
        await session.flush()
        await apply_stock_movement(session, product, sign * qty_base, reason=body.type,
                                   ref_type="transaction_item", ref_id=ti.id)
        if body.type == "sale":
            product.sold_count = (product.sold_count or 0) + 1

        # corrections + alias learning
        if vs is not None:
            if llm is None:
                session.add(Correction(voice_session_id=vs.id, shop_id=shop_id, item_index=item.item_index or -1,
                                       spoken_span=item.spoken_span, final_product_code=item.product_code,
                                       field="added", old_value=None, new_value=_final_dict(item)))
                continue
            if llm.get("product_id") != item.product_code:
                session.add(Correction(voice_session_id=vs.id, shop_id=shop_id, item_index=item.item_index,
                                       spoken_span=llm.get("spoken_span"), llm_product_code=llm.get("product_id"),
                                       llm_confidence=llm.get("confidence"), final_product_code=item.product_code,
                                       field="product", old_value={"product_id": llm.get("product_id")},
                                       new_value={"product_id": item.product_code}))
                span = (llm.get("spoken_span") or item.spoken_span or "").strip()
                if span and await _learn_alias(session, product, span):
                    catalog_changed = True
            if llm.get("quantity") != float(item.qty):
                session.add(Correction(voice_session_id=vs.id, shop_id=shop_id, item_index=item.item_index,
                                       spoken_span=llm.get("spoken_span"), llm_product_code=llm.get("product_id"),
                                       final_product_code=item.product_code, field="quantity",
                                       old_value={"quantity": llm.get("quantity")},
                                       new_value={"quantity": float(item.qty)}))
            if llm.get("unit") != item.unit:
                session.add(Correction(voice_session_id=vs.id, shop_id=shop_id, item_index=item.item_index,
                                       spoken_span=llm.get("spoken_span"), llm_product_code=llm.get("product_id"),
                                       final_product_code=item.product_code, field="unit",
                                       old_value={"unit": llm.get("unit")}, new_value={"unit": item.unit}))
            if llm.get("unit_price") is not None and float(llm["unit_price"]) != float(item.unit_price):
                session.add(Correction(voice_session_id=vs.id, shop_id=shop_id, item_index=item.item_index,
                                       spoken_span=llm.get("spoken_span"), llm_product_code=llm.get("product_id"),
                                       final_product_code=item.product_code, field="price",
                                       old_value={"unit_price": llm.get("unit_price")},
                                       new_value={"unit_price": float(item.unit_price)}))

    if vs is not None:
        for idx in body.deleted_item_indexes:
            llm = llm_items[idx] if 0 <= idx < len(llm_items) else None
            session.add(Correction(voice_session_id=vs.id, shop_id=shop_id, item_index=idx,
                                   spoken_span=(llm or {}).get("spoken_span"),
                                   llm_product_code=(llm or {}).get("product_id"),
                                   llm_confidence=(llm or {}).get("confidence"), field="deleted",
                                   old_value=llm, new_value=None))
        if body.llm_intent and body.llm_intent != body.type:
            session.add(Correction(voice_session_id=vs.id, shop_id=shop_id, item_index=-1, field="intent",
                                   old_value={"intent": body.llm_intent}, new_value={"intent": body.type}))
        vs.status = "saved"
        vs.final_json = body.model_dump(mode="json")

    txn.total_amount = total
    if catalog_changed:
        shop.catalog_version += 1
        catalog_svc.invalidate(shop_id)
    await session.commit()
    await session.refresh(txn)
    return txn


async def _learn_alias(session: AsyncSession, product: Product, span: str) -> bool:
    existing = (await session.execute(select(ProductAlias).where(
        ProductAlias.product_id == product.id, ProductAlias.alias == span))).scalar_one_or_none()
    if existing:
        existing.hit_count += 1
        existing.last_used_at = datetime.now(timezone.utc)
        return False
    session.add(ProductAlias(product_id=product.id, alias=span[:200], lang="mixed", source="user_correction",
                             hit_count=1, last_used_at=datetime.now(timezone.utc)))
    return True


def _final_dict(item) -> dict:
    return {"product_code": item.product_code, "qty": float(item.qty), "unit": item.unit,
            "unit_price": float(item.unit_price)}


async def void_transaction(session: AsyncSession, shop_id: uuid.UUID, txn_id: uuid.UUID) -> Transaction:
    txn = await session.get(Transaction, txn_id)
    if txn is None or txn.shop_id != shop_id:
        raise LookupError("transaction not found")
    if txn.status == "voided":
        return txn
    sign = Decimal("1") if txn.type == "sale" else Decimal("-1")
    for ti in txn.items:
        product = await session.get(Product, ti.product_id)
        await apply_stock_movement(session, product, sign * ti.qty_base, reason="void",
                                   ref_type="transaction_item", ref_id=ti.id)
    txn.status = "voided"
    await session.commit()
    await session.refresh(txn)
    return txn
