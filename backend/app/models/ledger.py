from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import ForeignKey, Index, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.base import TimestampMixin, uuid_pk


class StockLedger(Base, TimestampMixin):
    """Append-only stock movements, quantities in the product's sub_unit."""

    __tablename__ = "stock_ledger"
    __table_args__ = (Index("ix_stock_ledger_product_created", "product_id", "created_at"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    shop_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("shops.id"), nullable=False, index=True)
    product_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    delta_qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    reason: Mapped[str] = mapped_column(String(20), nullable=False)  # sale|purchase|adjustment|return|opening|void
    ref_type: Mapped[str | None] = mapped_column(String(30))  # transaction_item|manual
    ref_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    balance_after: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
