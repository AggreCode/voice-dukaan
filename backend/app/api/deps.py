from __future__ import annotations

from fastapi import Cookie, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Session, Shop, User
from app.services import sessions as session_svc

# Requests that change something must carry this header. A cross-site HTML form cannot set a custom
# header, and a cross-origin script cannot either without a CORS preflight this service does not
# grant, so a login cookie alone is not enough to act on a shop's behalf from somewhere else. The web
# app sends it on every request; see frontend/src/lib/api.ts.
APP_HEADER = "x-vd-app"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


class AuthContext:
    """Who is calling: the signed-in user, their shop, and the session row behind the cookie."""

    def __init__(self, user: User, shop: Shop, session_row: Session):
        self.user = user
        self.shop = shop
        self.session_row = session_row


async def auth_context(
    request: Request,
    db: AsyncSession = Depends(get_session),
    vd_session: str | None = Cookie(default=None),
) -> AuthContext:
    """The only way into a shop's data.

    There used to be a second way: an X-Shop-Id header naming any shop, believed without proof. That
    made every shop's bills, stock and customers readable by anyone who could guess or read an id, so
    it is gone. A request now proves itself with the login cookie or it does not get in.
    """
    if request.method not in SAFE_METHODS and request.headers.get(APP_HEADER) != "1":
        raise HTTPException(403, "missing app header")
    if not vd_session:
        raise HTTPException(401, "not signed in")
    row = await session_svc.load_session(db, vd_session)
    if row is None:
        raise HTTPException(401, "session expired")
    user = await db.get(User, row.user_id)
    shop = await db.get(Shop, row.shop_id)
    if user is None or shop is None:
        raise HTTPException(401, "session no longer valid")
    await session_svc.touch(db, row)
    return AuthContext(user, shop, row)


async def current_shop(ctx: AuthContext = Depends(auth_context)) -> Shop:
    return ctx.shop


async def current_user(ctx: AuthContext = Depends(auth_context)) -> User:
    return ctx.user
