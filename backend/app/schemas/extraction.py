"""Structured-output schema Claude must return. FROZEN: any change to this schema changes the
injected structured-output grammar and invalidates the prompt cache for every shop."""
from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict


class Intent(str, Enum):
    sale = "sale"
    purchase = "purchase"
    stock_query = "stock_query"
    unknown = "unknown"


class Unit(str, Enum):
    piece = "piece"
    strip = "strip"
    packet = "packet"
    bottle = "bottle"
    box = "box"
    carton = "carton"
    kg = "kg"
    g = "g"
    litre = "litre"
    ml = "ml"
    dozen = "dozen"
    bundle = "bundle"
    other = "other"


class PaymentMode(str, Enum):
    cash = "cash"
    upi = "upi"
    credit = "credit"
    unknown = "unknown"


class Alternative(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product_id: str
    confidence: float


class ExtractedItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    spoken_span: str
    product_id: str | None
    product_name_guess: str
    quantity: float
    unit: Unit
    unit_raw: str
    unit_price: float | None
    alternatives: list[Alternative]
    confidence: float
    needs_review: bool
    reason: str


class BillExtraction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    intent: Intent
    items: list[ExtractedItem]
    customer_name: str | None
    payment_mode: PaymentMode | None
    notes: str
    transcript_language: str  # od | hi | en | mixed
