from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.schemas.extraction import BillExtraction


# ---------- products ----------
# A product has exactly one unit, chosen by the shop as free text ("kg", "carton", "strip", anything).
# We never convert between units or infer a "pack size" -- the shop's own unit is authoritative.
class ProductOut(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    local_name: str | None = None
    brand: str
    category: str
    unit: str
    sell_price: Decimal
    cost_price: Decimal | None = None
    stock_qty: Decimal
    low_stock_threshold: Decimal
    is_active: bool
    aliases: list[str] = []


class ProductIn(BaseModel):
    name: str
    local_name: str | None = None  # derived from aliases in the shop's script when omitted
    brand: str = ""
    category: str = "general"
    unit: str = "piece"
    sell_price: Decimal = Decimal("0")
    cost_price: Decimal | None = None
    low_stock_threshold: Decimal = Decimal("0")
    aliases: list[str] = []
    opening_stock: Decimal | None = None  # in `unit`


class ProductPatch(BaseModel):
    name: str | None = None
    local_name: str | None = None  # "" clears it
    brand: str | None = None
    category: str | None = None
    unit: str | None = None
    sell_price: Decimal | None = None
    cost_price: Decimal | None = None
    low_stock_threshold: Decimal | None = None
    is_active: bool | None = None


STOCK_REASONS = {"restock", "damage", "expired", "return", "adjustment", "opening"}


class StockAdjustIn(BaseModel):
    """Signed quantity in the product's own unit: positive adds stock, negative removes it."""

    delta_qty: Decimal
    reason: str = "adjustment"
    note: str | None = None


class StockCountIn(BaseModel):
    """A physical count, in the product's own unit. The difference from current stock is recorded."""

    counted_qty: Decimal = Field(ge=0)
    note: str | None = None


class StockMovementOut(BaseModel):
    id: uuid.UUID
    created_at: datetime
    delta_qty: Decimal
    balance_after: Decimal
    reason: str
    ref_type: str | None
    note: str | None
    transaction_id: uuid.UUID | None = None


class AliasIn(BaseModel):
    alias: str
    lang: str = "mixed"


# ---------- voice sessions ----------
class ReviewProduct(BaseModel):
    """Catalog rows the review screen needs to render referenced ids without another round-trip."""

    code: str
    id: uuid.UUID
    name: str
    brand: str
    unit: str
    sell_price: Decimal
    stock_qty: Decimal
    local_name: str | None = None
    cost_price: Decimal | None = None


class VoiceSessionOut(BaseModel):
    session_id: uuid.UUID
    client_session_id: str
    status: str
    mode: str = "sale"
    transcript: str | None = None
    secondary_views: dict[str, str] = {}
    transcript_language: str | None = None
    language_probability: float | None = None
    low_language_confidence: bool = False
    extraction: BillExtraction | None = None
    review_products: list[ReviewProduct] = []
    latencies: dict[str, int] = {}
    error: str | None = None
    created_at: datetime


# ---------- transactions ----------
class FinalItem(BaseModel):
    item_index: int | None = None  # index into extraction.items, None if user-added
    product_code: str
    qty: Decimal
    unit: str
    unit_price: Decimal
    spoken_span: str | None = None
    llm_product_code: str | None = None
    llm_confidence: float | None = None


class SaveBillIn(BaseModel):
    voice_session_id: uuid.UUID | None = None
    type: str = Field(pattern="^(sale|purchase)$")
    items: list[FinalItem]
    customer_name: str | None = None
    payment_mode: str = "cash"
    notes: str | None = None
    deleted_item_indexes: list[int] = []
    llm_intent: str | None = None


class TransactionItemOut(BaseModel):
    id: uuid.UUID
    product_code: str
    product_name: str
    product_local_name: str | None = None
    qty: Decimal
    unit: str
    unit_price: Decimal
    line_total: Decimal
    was_corrected: bool


class TransactionOut(BaseModel):
    id: uuid.UUID
    type: str
    customer_name: str | None
    payment_mode: str
    total_amount: Decimal
    status: str
    notes: str | None
    created_at: datetime
    items: list[TransactionItemOut]


# ---------- shops ----------
class ShopOut(BaseModel):
    id: uuid.UUID
    name: str
    type: str
    default_language: str
    catalog_version: int


class ShopIn(BaseModel):
    name: str
    type: str = "general"
    default_language: str = "od-IN"
