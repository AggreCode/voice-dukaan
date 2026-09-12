"""Structured-output schema Gemini/Claude must return. FROZEN: any change to this schema changes the
injected structured-output grammar and invalidates the prompt cache for every shop.

`unit` is free text, not a closed enum: a product has exactly one unit (whatever the shop calls it),
and the model's job is to report the unit word actually spoken/typed, not to classify it into a
fixed set. Consistency (kg vs kilo vs kilogram) is handled by prompt guidance, not schema constraints.
"""
from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict


class Intent(str, Enum):
    sale = "sale"
    purchase = "purchase"
    stock_query = "stock_query"
    unknown = "unknown"


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
    unit: str  # the unit word as spoken/typed, lightly normalised (see prompt cheat sheet)
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
