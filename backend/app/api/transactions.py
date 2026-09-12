from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_shop
from app.db import get_session
from app.models import Product, Shop, Transaction
from app.schemas.api import SaveBillIn, TransactionItemOut, TransactionOut
from app.services.ledger import save_reviewed_bill, void_transaction

router = APIRouter(prefix="/api/transactions", tags=["transactions"])


async def _out(session: AsyncSession, t: Transaction) -> TransactionOut:
    pids = {i.product_id for i in t.items}
    products = {p.id: p for p in (await session.execute(select(Product).where(Product.id.in_(pids)))).scalars()}
    return TransactionOut(
        id=t.id, type=t.type, customer_name=t.customer_name, payment_mode=t.payment_mode,
        total_amount=t.total_amount, status=t.status, notes=t.notes, created_at=t.created_at,
        items=[TransactionItemOut(id=i.id, product_code=products[i.product_id].code,
                                  product_name=products[i.product_id].name,
                                  product_local_name=products[i.product_id].local_name, qty=i.qty, unit=i.unit,
                                  unit_price=i.unit_price, line_total=i.line_total, was_corrected=i.was_corrected)
               for i in t.items],
    )


@router.post("", response_model=TransactionOut, status_code=201)
async def save_bill(body: SaveBillIn, shop: Shop = Depends(current_shop),
                    session: AsyncSession = Depends(get_session)):
    if not body.items:
        raise HTTPException(400, "no items")
    try:
        txn = await save_reviewed_bill(session, shop.id, body)
    except (ValueError, LookupError) as e:
        raise HTTPException(400, str(e)) from e
    return await _out(session, txn)


@router.get("", response_model=list[TransactionOut])
async def list_transactions(day: date | None = None, limit: int = 100, shop: Shop = Depends(current_shop),
                            session: AsyncSession = Depends(get_session)):
    stmt = select(Transaction).where(Transaction.shop_id == shop.id)
    if day:
        stmt = stmt.where(func.date(Transaction.created_at) == day)
    rows = (await session.execute(stmt.order_by(Transaction.created_at.desc()).limit(limit))).scalars().all()
    return [await _out(session, t) for t in rows]


@router.get("/{txn_id}", response_model=TransactionOut)
async def get_transaction(txn_id: uuid.UUID, shop: Shop = Depends(current_shop),
                          session: AsyncSession = Depends(get_session)):
    t = await session.get(Transaction, txn_id)
    if t is None or t.shop_id != shop.id:
        raise HTTPException(404, "not found")
    return await _out(session, t)


@router.post("/{txn_id}/void", response_model=TransactionOut)
async def void(txn_id: uuid.UUID, shop: Shop = Depends(current_shop), session: AsyncSession = Depends(get_session)):
    try:
        t = await void_transaction(session, shop.id, txn_id)
    except LookupError as e:
        raise HTTPException(404, str(e)) from e
    return await _out(session, t)
