"""The numbers a shopkeeper actually asks about: what sold, what moves, what earns.

Days are counted in India Standard Time, because "today" for a shop in Bhubaneswar starts at its own
midnight, not at midnight in London where the server's clock lives. India has no daylight saving, so a
fixed +05:30 is exact and needs no timezone database on a slim container.

Profit is an estimate: each sale is set against the product's CURRENT cost price, since cost is not
recorded per sale. That is close enough to rank products and to show roughly what a day earned, and
the response says how much of the money it could actually cover.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_shop
from app.db import get_session
from app.models import Product, Shop, Transaction, TransactionItem

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

IST = timezone(timedelta(hours=5, minutes=30))


class Totals(BaseModel):
    sales: float
    bills: int
    purchases: float
    purchase_bills: int
    profit: float
    profit_coverage: float  # share of sales money whose cost price is known, 0..1


class DayPoint(BaseModel):
    date: date
    sales: float
    bills: int


class ProductStat(BaseModel):
    code: str
    name: str
    local_name: str | None = None
    unit: str
    qty: float = 0
    revenue: float = 0
    times: int = 0
    profit: float | None = None


class MarginStat(BaseModel):
    code: str
    name: str
    local_name: str | None = None
    unit: str
    sell_price: float
    cost_price: float
    margin: float
    margin_pct: float
    stock_qty: float


class LowStock(BaseModel):
    code: str
    name: str
    unit: str
    stock_qty: float
    low_stock_threshold: float


class StockValue(BaseModel):
    at_cost: float
    at_sell: float
    products: int
    missing_prices: int


class AnalyticsOut(BaseModel):
    days: int
    since: datetime
    totals: Totals
    daily: list[DayPoint]
    top_revenue: list[ProductStat]
    top_frequency: list[ProductStat]
    top_margin: list[MarginStat]
    low_stock: list[LowStock]
    stock_value: StockValue


def _f(v) -> float:
    return float(v) if v is not None else 0.0


@router.get("", response_model=AnalyticsOut)
async def analytics(days: int = 30, shop: Shop = Depends(current_shop), db: AsyncSession = Depends(get_session)):
    days = max(1, min(days, 365))
    today_ist = datetime.now(IST).date()
    first_day = today_ist - timedelta(days=days - 1)
    since = datetime.combine(first_day, datetime.min.time(), tzinfo=IST)

    live = (Transaction.shop_id == shop.id, Transaction.status != "voided", Transaction.created_at >= since)

    # ---- totals by kind ----
    kind_rows = (await db.execute(
        select(Transaction.type, func.count(Transaction.id), func.coalesce(func.sum(Transaction.total_amount), 0))
        .where(*live).group_by(Transaction.type))).all()
    by_kind = {k: (int(n), _f(s)) for k, n, s in kind_rows}
    sales_bills, sales_total = by_kind.get("sale", (0, 0.0))
    buy_bills, buy_total = by_kind.get("purchase", (0, 0.0))

    # ---- per product, sales only ----
    margin_expr = TransactionItem.qty * (TransactionItem.unit_price - Product.cost_price)
    prod_rows = (await db.execute(
        select(Product.code, Product.name, Product.local_name, Product.unit,
               func.coalesce(func.sum(TransactionItem.qty), 0),
               func.coalesce(func.sum(TransactionItem.line_total), 0),
               func.count(TransactionItem.id),
               func.sum(margin_expr),  # NULL where the cost price is unknown
               func.coalesce(func.sum(TransactionItem.line_total).filter(Product.cost_price.is_not(None)), 0))
        .join(Transaction, Transaction.id == TransactionItem.transaction_id)
        .join(Product, Product.id == TransactionItem.product_id)
        .where(*live, Transaction.type == "sale")
        .group_by(Product.code, Product.name, Product.local_name, Product.unit))).all()

    stats = [ProductStat(code=c, name=n, local_name=ln, unit=u, qty=_f(q), revenue=_f(r), times=int(t),
                         profit=None if p is None else round(_f(p), 2))
             for c, n, ln, u, q, r, t, p, _covered in prod_rows]
    covered = sum(_f(row[8]) for row in prod_rows)
    profit = sum(s.profit or 0.0 for s in stats)

    top_revenue = sorted(stats, key=lambda s: (-s.revenue, s.name))[:5]
    # "Sells most" is ranked by how many bills it appears on, not by quantity: 40 kg of rice and
    # 40 packets of biscuits are not comparable numbers, but forty customers buying each is.
    top_frequency = sorted(stats, key=lambda s: (-s.times, -s.revenue, s.name))[:5]

    # ---- margins, from the prices the shop has set now ----
    products = (await db.execute(select(Product).where(Product.shop_id == shop.id,
                                                       Product.is_active.is_(True)))).scalars().all()
    margins = []
    at_cost = at_sell = Decimal("0")
    missing = 0
    low: list[LowStock] = []
    for p in products:
        stock = p.stock_qty or Decimal("0")
        if p.sell_price and p.sell_price > 0 and p.cost_price and p.cost_price > 0:
            m = p.sell_price - p.cost_price
            margins.append(MarginStat(code=p.code, name=p.name, local_name=p.local_name, unit=p.unit,
                                      sell_price=_f(p.sell_price), cost_price=_f(p.cost_price),
                                      margin=round(_f(m), 2), margin_pct=round(_f(m / p.cost_price) * 100, 1),
                                      stock_qty=_f(stock)))
        else:
            missing += 1
        if stock > 0:
            at_cost += stock * (p.cost_price or 0)
            at_sell += stock * (p.sell_price or 0)
        if stock <= (p.low_stock_threshold or 0):
            low.append(LowStock(code=p.code, name=p.name, unit=p.unit, stock_qty=_f(stock),
                                low_stock_threshold=_f(p.low_stock_threshold)))
    top_margin = sorted(margins, key=lambda m: (-m.margin_pct, -m.margin, m.name))[:5]

    # ---- one bar per day, zero-filled, so a quiet day shows as quiet rather than missing ----
    day_col = func.date(func.timezone("Asia/Kolkata", Transaction.created_at))
    day_rows = (await db.execute(
        select(day_col, func.coalesce(func.sum(Transaction.total_amount), 0), func.count(Transaction.id))
        .where(*live, Transaction.type == "sale").group_by(day_col))).all()
    per_day = {d: (_f(s), int(n)) for d, s, n in day_rows}
    span = min(days, 31)
    daily = [DayPoint(date=d, sales=per_day.get(d, (0.0, 0))[0], bills=per_day.get(d, (0.0, 0))[1])
             for d in (today_ist - timedelta(days=i) for i in range(span - 1, -1, -1))]

    return AnalyticsOut(
        days=days, since=since,
        totals=Totals(sales=round(sales_total, 2), bills=sales_bills, purchases=round(buy_total, 2),
                      purchase_bills=buy_bills, profit=round(profit, 2),
                      profit_coverage=round(covered / sales_total, 3) if sales_total else 0.0),
        daily=daily, top_revenue=top_revenue, top_frequency=top_frequency, top_margin=top_margin,
        low_stock=sorted(low, key=lambda x: (x.stock_qty, x.name))[:10],
        stock_value=StockValue(at_cost=round(_f(at_cost), 2), at_sell=round(_f(at_sell), 2),
                               products=len(products), missing_prices=missing),
    )
