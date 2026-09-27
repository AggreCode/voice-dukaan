"""A read-only console for whoever runs the service, not for shopkeepers.

Two things it deliberately is not. It cannot act as a shop: there is no endpoint here that writes a
bill, edits stock or changes a price, so support can answer "what does my ledger say" without ever
being able to alter the answer. And it never returns a password hash or a session token, because
nobody supporting a shop needs either.

What it does return is a shop's business data, which belongs to the shopkeeper. Every call is logged
with the administrator's username so there is a record of who looked at what.
"""
from __future__ import annotations

import uuid

import structlog
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AuthContext, auth_context
from app.db import get_session
from app.models import Product, Shop, Transaction, User, VoiceSession

log = structlog.get_logger(__name__)
router = APIRouter(prefix="/api/admin", tags=["admin"])


async def current_admin(ctx: AuthContext = Depends(auth_context)) -> AuthContext:
    """Admin is a role on an ordinary account, granted only by scripts/make_admin.py on the server.

    There is no way to grant it through the API, on purpose: a bug in a registration form should never
    be able to hand somebody every shop on the service.
    """
    if ctx.user.role != "admin":
        raise HTTPException(404, "not found")  # do not confirm that this console exists
    return ctx


class AdminShopRow(BaseModel):
    id: uuid.UUID
    name: str
    type: str
    created_at: str
    mobile: str | None = None
    whatsapp: str | None = None
    gst_number: str | None = None
    address: str | None = None
    owner: str | None = None
    owner_username: str | None = None
    users: int = 0
    products: int = 0
    bills: int = 0
    sales_total: float = 0.0
    purchases_total: float = 0.0
    captures: int = 0
    last_activity_at: str | None = None


class AdminOverview(BaseModel):
    shops: int
    users: int
    bills: int
    products: int
    rows: list[AdminShopRow]


def _iso(value) -> str | None:
    return value.isoformat() if value is not None else None


@router.get("/shops", response_model=AdminOverview)
async def list_shops(ctx: AuthContext = Depends(current_admin), db: AsyncSession = Depends(get_session)):
    log.info("admin_listed_shops", admin=ctx.user.username)

    shops = (await db.execute(select(Shop).order_by(Shop.created_at.desc()))).scalars().all()

    user_rows = (await db.execute(
        select(User.shop_id, func.count(User.id), func.min(User.username), func.min(User.display_name))
        .group_by(User.shop_id))).all()
    users_by_shop = {r[0]: r for r in user_rows}

    product_rows = (await db.execute(
        select(Product.shop_id, func.count(Product.id)).group_by(Product.shop_id))).all()
    products_by_shop = dict(product_rows)

    capture_rows = (await db.execute(
        select(VoiceSession.shop_id, func.count(VoiceSession.id)).group_by(VoiceSession.shop_id))).all()
    captures_by_shop = dict(capture_rows)

    txn_rows = (await db.execute(
        select(Transaction.shop_id, Transaction.type, func.count(Transaction.id),
               func.coalesce(func.sum(Transaction.total_amount), 0), func.max(Transaction.created_at))
        .where(Transaction.status != "voided")
        .group_by(Transaction.shop_id, Transaction.type))).all()

    bills: dict[uuid.UUID, int] = {}
    sales: dict[uuid.UUID, float] = {}
    purchases: dict[uuid.UUID, float] = {}
    last: dict[uuid.UUID, object] = {}
    for shop_id, kind, count, total, latest in txn_rows:
        bills[shop_id] = bills.get(shop_id, 0) + count
        if kind == "purchase":
            purchases[shop_id] = purchases.get(shop_id, 0.0) + float(total)
        else:
            sales[shop_id] = sales.get(shop_id, 0.0) + float(total)
        if latest is not None and (shop_id not in last or latest > last[shop_id]):
            last[shop_id] = latest

    rows = []
    for shop in shops:
        u = users_by_shop.get(shop.id)
        rows.append(AdminShopRow(
            id=shop.id, name=shop.name, type=shop.type, created_at=_iso(shop.created_at) or "",
            mobile=shop.mobile, whatsapp=shop.whatsapp, gst_number=shop.gst_number, address=shop.address,
            owner=u[3] if u else None, owner_username=u[2] if u else None, users=u[1] if u else 0,
            products=products_by_shop.get(shop.id, 0), bills=bills.get(shop.id, 0),
            sales_total=round(sales.get(shop.id, 0.0), 2),
            purchases_total=round(purchases.get(shop.id, 0.0), 2),
            captures=captures_by_shop.get(shop.id, 0),
            last_activity_at=_iso(last.get(shop.id)),
        ))
    return AdminOverview(
        shops=len(rows), users=sum(r.users for r in rows), bills=sum(r.bills for r in rows),
        products=sum(r.products for r in rows), rows=rows,
    )


class AdminUser(BaseModel):
    id: uuid.UUID
    username: str | None
    display_name: str
    role: str
    mobile: str | None
    last_login_at: str | None
    created_at: str


class AdminBill(BaseModel):
    id: uuid.UUID
    type: str
    total_amount: float
    status: str
    customer_name: str | None
    payment_mode: str
    items: int
    created_at: str


class AdminShopDetail(BaseModel):
    shop: AdminShopRow
    users: list[AdminUser]
    recent_bills: list[AdminBill]
    low_stock: list[str]


@router.get("/shops/{shop_id}", response_model=AdminShopDetail)
async def shop_detail(shop_id: uuid.UUID, ctx: AuthContext = Depends(current_admin),
                      db: AsyncSession = Depends(get_session)):
    log.info("admin_opened_shop", admin=ctx.user.username, shop_id=str(shop_id))
    overview = await list_shops(ctx=ctx, db=db)
    row = next((r for r in overview.rows if r.id == shop_id), None)
    if row is None:
        raise HTTPException(404, "shop not found")

    users = (await db.execute(select(User).where(User.shop_id == shop_id)
                              .order_by(User.created_at))).scalars().all()
    bills = (await db.execute(select(Transaction).where(Transaction.shop_id == shop_id)
                              .order_by(Transaction.created_at.desc()).limit(25))).scalars().all()
    item_counts = dict((await db.execute(
        select(Transaction.id, func.count())
        .join(Transaction.items)
        .where(Transaction.shop_id == shop_id)
        .group_by(Transaction.id))).all()) if bills else {}
    low = (await db.execute(
        select(Product.name).where(Product.shop_id == shop_id, Product.is_active.is_(True),
                                   Product.stock_qty <= Product.low_stock_threshold)
        .order_by(Product.name).limit(20))).scalars().all()

    return AdminShopDetail(
        shop=row,
        users=[AdminUser(id=u.id, username=u.username, display_name=u.display_name, role=u.role,
                         mobile=u.mobile, last_login_at=_iso(u.last_login_at),
                         created_at=_iso(u.created_at) or "") for u in users],
        recent_bills=[AdminBill(id=b.id, type=b.type, total_amount=float(b.total_amount), status=b.status,
                                customer_name=b.customer_name, payment_mode=b.payment_mode,
                                items=item_counts.get(b.id, 0), created_at=_iso(b.created_at) or "")
                      for b in bills],
        low_stock=list(low),
    )
