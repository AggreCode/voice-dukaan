from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.base import TimestampMixin, uuid_pk


class Correction(Base, TimestampMixin):
    """What the user changed on the review screen vs. what the LLM produced. Training signal + eval set."""

    __tablename__ = "corrections"

    id: Mapped[uuid.UUID] = uuid_pk()
    voice_session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("voice_sessions.id"), nullable=False, index=True
    )
    shop_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("shops.id"), nullable=False, index=True)
    item_index: Mapped[int] = mapped_column(Integer, nullable=False)
    spoken_span: Mapped[str | None] = mapped_column(Text)
    llm_product_code: Mapped[str | None] = mapped_column(String(16))
    llm_confidence: Mapped[float | None] = mapped_column(Numeric(4, 3))
    final_product_code: Mapped[str | None] = mapped_column(String(16))
    field: Mapped[str] = mapped_column(String(20), nullable=False)  # product|quantity|unit|price|intent|deleted|added
    old_value: Mapped[dict | None] = mapped_column(JSONB)
    new_value: Mapped[dict | None] = mapped_column(JSONB)
