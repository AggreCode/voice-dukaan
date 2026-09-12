from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.base import TimestampMixin, uuid_pk


class Product(Base, TimestampMixin):
    __tablename__ = "products"

    id: Mapped[uuid.UUID] = uuid_pk()
    shop_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("shops.id"), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(16), nullable=False)  # short id shown to the LLM, e.g. p001
    sku: Mapped[str | None] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    local_name: Mapped[str | None] = mapped_column(String(200))  # e.g. ପାରାସିଟାମଲ, shown under the name
    brand: Mapped[str] = mapped_column(String(100), default="", nullable=False)
    category: Mapped[str] = mapped_column(String(50), default="general", nullable=False)
    pack_unit: Mapped[str] = mapped_column(String(20), default="piece", nullable=False)  # what is normally sold
    sub_unit: Mapped[str] = mapped_column(String(20), default="piece", nullable=False)  # stock base unit
    pack_size: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=Decimal("1"), nullable=False)  # sub per pack
    sell_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"), nullable=False)  # per pack_unit
    cost_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    stock_qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=Decimal("0"), nullable=False)  # in sub_unit
    low_stock_threshold: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=Decimal("0"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sold_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    shop = relationship("Shop", back_populates="products", lazy="noload")
    aliases = relationship("ProductAlias", back_populates="product", lazy="selectin", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("shop_id", "name", "brand", name="uq_product_shop_name_brand"),
        UniqueConstraint("shop_id", "code", name="uq_product_shop_code"),
    )


class ProductAlias(Base, TimestampMixin):
    __tablename__ = "product_aliases"
    __table_args__ = (UniqueConstraint("product_id", "alias", name="uq_alias_product_alias"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    alias: Mapped[str] = mapped_column(String(200), nullable=False)
    lang: Mapped[str] = mapped_column(String(10), default="mixed", nullable=False)  # od|hi|en|mixed
    source: Mapped[str] = mapped_column(String(20), default="seed", nullable=False)  # seed|user_correction|llm_suggested
    hit_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    product = relationship("Product", back_populates="aliases", lazy="noload")
