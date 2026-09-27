"""Server-side sessions, carried by one cookie.

Why a row and not a self-contained signed token: signing out has to mean something. A stateless token
stays valid until it expires no matter what the user does, so a shopkeeper who loses a phone cannot
end that session, and neither can we. A row can be revoked, listed and expired.

The cookie holds a random 256-bit token. What is stored is an HMAC of it under APP_SECRET, so a
database that leaks does not hand over a single working session, and the token itself is never written
to disk or to a log.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import Response
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import Session, User

COOKIE_NAME = "vd_session"
TOKEN_BYTES = 32


def new_token() -> str:
    return secrets.token_urlsafe(TOKEN_BYTES)


def token_hash(token: str) -> str:
    """Peppered, so the stored value is useless without the application secret."""
    s = get_settings()
    # The "vd-session:" prefix is part of the stored hash, not branding: changing it would invalidate
    # every session in the database and sign every shopkeeper out.
    return hmac.new(("vd-session:" + s.APP_SECRET).encode(), token.encode(), hashlib.sha256).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def create_session(db: AsyncSession, user: User, *, remember: bool = True,
                         user_agent: str | None = None) -> tuple[Session, str]:
    s = get_settings()
    token = new_token()
    days = s.SESSION_DAYS if remember else s.SESSION_SHORT_DAYS
    row = Session(user_id=user.id, shop_id=user.shop_id, token_hash=token_hash(token),
                  expires_at=_now() + timedelta(days=days), last_seen_at=_now(),
                  user_agent=(user_agent or "")[:300] or None)
    db.add(row)
    await db.flush()
    return row, token


async def load_session(db: AsyncSession, token: str) -> Session | None:
    row = (await db.execute(select(Session).where(Session.token_hash == token_hash(token)))).scalar_one_or_none()
    if row is None or row.revoked_at is not None:
        return None
    expires = row.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < _now():
        return None
    return row


async def touch(db: AsyncSession, row: Session) -> None:
    """Record activity without writing on every single request."""
    last = row.last_seen_at
    if last is not None and last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    if last is None or (_now() - last) > timedelta(hours=1):
        row.last_seen_at = _now()


async def revoke(db: AsyncSession, row: Session) -> None:
    row.revoked_at = _now()


async def revoke_all_for_user(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Used when a password changes: every other device must be signed out."""
    await db.execute(update(Session).where(Session.user_id == user_id, Session.revoked_at.is_(None))
                     .values(revoked_at=_now()))


def set_cookie(response: Response, token: str, *, remember: bool = True) -> None:
    """HttpOnly so no script can read it, SameSite=Lax so another site cannot ride on it, Secure so it
    never crosses plain HTTP. Without `remember` it is a session cookie and dies with the browser."""
    s = get_settings()
    response.set_cookie(
        COOKIE_NAME, token,
        max_age=s.SESSION_DAYS * 24 * 3600 if remember else None,
        httponly=True, secure=s.COOKIE_SECURE, samesite="lax", path="/",
    )


def clear_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/")
