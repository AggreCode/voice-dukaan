from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.base import TimestampMixin, uuid_pk


class Shop(Base, TimestampMixin):
    __tablename__ = "shops"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    type: Mapped[str] = mapped_column(String(20), default="general", nullable=False)  # medical|kirana|general
    default_language: Mapped[str] = mapped_column(String(10), default="od-IN", nullable=False)
    catalog_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    settings: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)

    # Registration details. Everything but the name is optional at the database level so a shop is
    # never locked out of its own data by a validation rule added later; the form asks for them.
    gst_number: Mapped[str | None] = mapped_column(String(20))
    mobile: Mapped[str | None] = mapped_column(String(20))
    whatsapp: Mapped[str | None] = mapped_column(String(20))
    address: Mapped[str | None] = mapped_column(String(500))

    products = relationship("Product", back_populates="shop", lazy="noload")


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = uuid_pk()
    shop_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("shops.id"), nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    # Unique across the whole service, stored lowercased, so signing in needs a name and a password
    # and nothing else. Nullable only for rows created before logins existed.
    username: Mapped[str | None] = mapped_column(String(32), unique=True, index=True)
    # scrypt$n$r$p$salt$hash -- see services/passwords.py. Never a bare digest of the password.
    password_hash: Mapped[str | None] = mapped_column(String(255))
    mobile: Mapped[str | None] = mapped_column(String(20), index=True)
    pin_hash: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    role: Mapped[str] = mapped_column(String(20), default="owner", nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Session(Base, TimestampMixin):
    """One signed-in device.

    The cookie carries a random opaque token and nothing else; this row is the authority. Storing a
    peppered hash of the token rather than the token means a leaked database still cannot be used to
    sign in as anybody, and a row that can be revoked means "sign out" genuinely ends the session
    everywhere instead of hoping the browser forgets.
    """

    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"),
                                               nullable=False, index=True)
    shop_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("shops.id"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    user_agent: Mapped[str | None] = mapped_column(String(300))
