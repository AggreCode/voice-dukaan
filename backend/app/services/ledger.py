"""Saving a reviewed bill: transaction + items + stock ledger + corrections + learned aliases,
all in one DB transaction.

Quantities are stored and moved in whatever unit the product itself uses -- there is no pack/sub-unit
conversion. If a spoken or typed unit does not match the product's registered unit, that is caught by
the guards (extraction/postprocess.py) as a mismatch to review, not silently converted here.
"""
from __future__ import annotations

import uuid
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
from app.services.spoken import clean_learned_alias


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
                             qty_base=item.qty, unit_price=item.unit_price, line_total=line_total,
                             spoken_span=item.spoken_span, llm_confidence=item.llm_confidence,
                             was_corrected=was_corrected)
        session.add(ti)
        await session.flush()
        await apply_stock_movement(session, product, sign * item.qty, reason=body.type,
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
    """Remember how this shop says this product. Quantity and unit words are stripped, and a phrase
    that already belongs to another product is dropped rather than learned."""
    others = (await session.execute(select(Product).where(
        Product.shop_id == product.shop_id, Product.id != product.id))).scalars().all()
    taken: set[str] = set()
    for other in others:
        taken.add(other.name.casefold())
        if other.local_name:
            taken.add(other.local_name.casefold())
        taken.update(a.alias.casefold() for a in other.aliases)
    alias = clean_learned_alias(span, taken)
    if alias is None:
        return False
    existing = (await session.execute(select(ProductAlias).where(
        ProductAlias.product_id == product.id, ProductAlias.alias == alias))).scalar_one_or_none()
    if existing:
        existing.hit_count += 1
        return False
    session.add(ProductAlias(product_id=product.id, alias=alias, lang="mixed", source="user_correction",
                             hit_count=1))
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
