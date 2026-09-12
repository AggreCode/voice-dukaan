from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import Boolean, ForeignKey, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.base import TimestampMixin, uuid_pk


class Transaction(Base, TimestampMixin):
    __tablename__ = "transactions"

    id: Mapped[uuid.UUID] = uuid_pk()
    shop_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("shops.id"), nullable=False, index=True)
    voice_session_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("voice_sessions.id"))
    type: Mapped[str] = mapped_column(String(20), nullable=False)  # sale|purchase
    customer_name: Mapped[str | None] = mapped_column(String(200))
    payment_mode: Mapped[str] = mapped_column(String(20), default="cash", nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="saved", nullable=False)  # saved|voided
    notes: Mapped[str | None] = mapped_column(Text)

    items = relationship("TransactionItem", back_populates="transaction", lazy="selectin", cascade="all, delete-orphan")


class TransactionItem(Base, TimestampMixin):
    __tablename__ = "transaction_items"

    id: Mapped[uuid.UUID] = uuid_pk()
    transaction_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("transactions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    unit: Mapped[str] = mapped_column(String(20), nullable=False)
    qty_base: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)  # converted to product.sub_unit
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    line_total: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    spoken_span: Mapped[str | None] = mapped_column(Text)
    llm_confidence: Mapped[float | None] = mapped_column(Numeric(4, 3))
    was_corrected: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    transaction = relationship("Transaction", back_populates="items", lazy="noload")
