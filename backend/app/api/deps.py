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
    s = get_settings()
    return hashlib.sha256((s.ANTHROPIC_API_KEY + s.SARVAM_API_KEY + "voice-dukan").encode()).digest()


def make_token(shop_id: uuid.UUID, user_id: uuid.UUID) -> str:
    payload = json.dumps({"s": str(shop_id), "u": str(user_id), "exp": int(time.time()) + TOKEN_TTL_S}).encode()
    sig = hmac.new(_secret(), payload, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(payload + b"." + sig).decode()


def parse_token(token: str) -> dict | None:
    try:
        raw = base64.urlsafe_b64decode(token.encode())
        payload, sig = raw.rsplit(b".", 1)
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
