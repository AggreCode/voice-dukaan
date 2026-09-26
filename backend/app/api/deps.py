from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import uuid

from fastapi import Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.models import Shop

TOKEN_TTL_S = 30 * 24 * 3600


def _secret() -> bytes:
    """Signing key for login tokens and PIN hashes.

    APP_SECRET is authoritative. When it is unset we fall back to the historical derivation from the
    AI keys, which is why tokens used to die the moment a key was added or rotated -- see APP_SECRET
    in config.py. New deployments must set APP_SECRET.
    """
    s = get_settings()
    if s.APP_SECRET:
        return hashlib.sha256(("voice-dukan:" + s.APP_SECRET).encode()).digest()
    return _legacy_secret()


def _legacy_secret() -> bytes:
    """The pre-APP_SECRET derivation, kept only to re-hash PINs saved under it on first login."""
    s = get_settings()
    return hashlib.sha256((s.ANTHROPIC_API_KEY + s.SARVAM_API_KEY + "voice-dukan").encode()).digest()


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _b64d(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def make_token(shop_id: uuid.UUID, user_id: uuid.UUID) -> str:
    """payload.signature, each base64url on its own.

    The separator must sit OUTSIDE the encoded parts. The previous format base64-encoded
    `payload + b"." + signature` as one blob, so when the signature happened to contain the byte 0x2e
    -- about 11% of tokens, since any of its 32 bytes will do -- parsing split in the middle of the
    signature and rejected a perfectly valid token. That is a second, independent cause of the
    "invalid or expired token" screen, and it survived every retry because the token never changed.
    """
    payload = json.dumps({"s": str(shop_id), "u": str(user_id), "exp": int(time.time()) + TOKEN_TTL_S}).encode()
    sig = hmac.new(_secret(), payload, hashlib.sha256).digest()
    return f"{_b64e(payload)}.{_b64e(sig)}"


def parse_token(token: str) -> dict | None:
    try:
        payload_b64, sep, sig_b64 = token.partition(".")
        if not sep:
            return None  # includes every token in the old single-blob format
        payload, sig = _b64d(payload_b64), _b64d(sig_b64)
        if not hmac.compare_digest(hmac.new(_secret(), payload, hashlib.sha256).digest(), sig):
            return None
        data = json.loads(payload)
        if data.get("exp", 0) < time.time():
            return None
        return data
    except Exception:  # noqa: BLE001
        return None


def hash_pin(pin: str) -> str:
    return hashlib.sha256(hmac.new(_secret(), pin.encode(), hashlib.sha256).digest()).hexdigest()


def hash_pin_legacy(pin: str) -> str:
    """Same PIN under the old AI-key-derived secret, so a shop that set a PIN before APP_SECRET
    existed can still log in once and have its hash upgraded."""
    return hashlib.sha256(hmac.new(_legacy_secret(), pin.encode(), hashlib.sha256).digest()).hexdigest()


async def current_shop(
    session: AsyncSession = Depends(get_session),
    authorization: str | None = Header(default=None),
    x_shop_id: str | None = Header(default=None),
) -> Shop:
    """Phase-1 auth: a signed token from /api/auth/login, or a bare X-Shop-Id header (dev / no PIN set)."""
    shop_id: uuid.UUID | None = None
    if authorization and authorization.lower().startswith("bearer "):
        data = parse_token(authorization[7:].strip())
        if data is None:
            raise HTTPException(401, "invalid or expired token")
        shop_id = uuid.UUID(data["s"])
    elif x_shop_id:
        try:
            shop_id = uuid.UUID(x_shop_id)
        except ValueError as e:
            raise HTTPException(400, "bad X-Shop-Id") from e
    if shop_id is None:
        raise HTTPException(401, "missing credentials")
    shop = await session.get(Shop, shop_id)
    if shop is None:
        raise HTTPException(404, "shop not found")
    return shop
