from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.base import TimestampMixin, uuid_pk


class VoiceSession(Base, TimestampMixin):
    __tablename__ = "voice_sessions"
    __table_args__ = (UniqueConstraint("shop_id", "client_session_id", name="uq_voice_session_client"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    shop_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("shops.id"), nullable=False, index=True)
    client_session_id: Mapped[str] = mapped_column(String(64), nullable=False)
    # processing|extracted|no_speech|saved|failed|needs_manual
    status: Mapped[str] = mapped_column(String(20), default="processing", nullable=False)
    input_mode: Mapped[str] = mapped_column(String(20), default="sale", server_default="sale", nullable=False)  # sale|stock_in
    audio_path: Mapped[str | None] = mapped_column(Text)
    mime_type: Mapped[str | None] = mapped_column(String(80))
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    speech_ms: Mapped[int | None] = mapped_column(Integer)
    chunks_json: Mapped[list | None] = mapped_column(JSONB)

    sarvam_transcript: Mapped[str | None] = mapped_column(Text)
    sarvam_meta: Mapped[dict | None] = mapped_column(JSONB)
    saaras_translation: Mapped[str | None] = mapped_column(Text)
    saaras_codemix: Mapped[str | None] = mapped_column(Text)
    google_transcript: Mapped[str | None] = mapped_column(Text)
    google_meta: Mapped[dict | None] = mapped_column(JSONB)

    llm_request_id: Mapped[str | None] = mapped_column(String(80))
    llm_model: Mapped[str | None] = mapped_column(String(60))
    llm_output_json: Mapped[dict | None] = mapped_column(JSONB)
    final_json: Mapped[dict | None] = mapped_column(JSONB)
    latencies: Mapped[dict | None] = mapped_column(JSONB)
    token_usage: Mapped[dict | None] = mapped_column(JSONB)
    error: Mapped[str | None] = mapped_column(Text)
