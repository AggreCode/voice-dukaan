"""Registration, sign in, sign out, and who am I.

Design notes that matter more than the code:

* A password is checked with scrypt, never compared as a digest, and a wrong username costs the same
  time as a wrong password so the endpoint does not quietly confirm which usernames exist.
* Sign in is by username OR mobile number, because a shopkeeper remembers a phone number and may not
  remember a username they chose once.
* The session cookie is strictly necessary to sign in, so it needs no consent banner under the GDPR
  or India's DPDP rules. What genuinely deserves a choice is how long it lasts, which is what the
  "keep me signed in" box is, and the web app says so in one line rather than nagging.
"""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AuthContext, auth_context
from app.db import get_session
from app.models import Shop, User
from app.schemas.api import ShopOut
from app.services import sessions as session_svc
from app.services.passwords import MIN_PASSWORD_LENGTH, hash_password, needs_rehash, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])

USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{2,31}$")
MOBILE_RE = re.compile(r"^\+?[0-9]{10,15}$")
GST_RE = re.compile(r"^[0-9A-Z]{15}$")


def _clean_mobile(v: str | None) -> str | None:
    if not v:
        return None
    digits = re.sub(r"[\s()-]", "", v.strip())
    if not MOBILE_RE.match(digits):
        raise ValueError("mobile number must be 10 to 15 digits")
    return digits


class UserOut(BaseModel):
    id: str
    username: str | None
    display_name: str
    role: str


class MeOut(BaseModel):
    shop: ShopOut
    user: UserOut


def _me(shop: Shop, user: User) -> MeOut:
    return MeOut(shop=ShopOut.model_validate(shop, from_attributes=True),
                 user=UserOut(id=str(user.id), username=user.username,
                              display_name=user.display_name, role=user.role))


class RegisterIn(BaseModel):
    # step 1: the shop
    name: str = Field(min_length=2, max_length=200)
    type: str = "general"
    default_language: str = "od-IN"
    gst_number: str | None = None
    mobile: str
    whatsapp: str | None = None
    address: str | None = Field(default=None, max_length=500)
    # step 2: the login
    owner_name: str = Field(default="Owner", max_length=100)
    username: str
    password: str

    @field_validator("username")
    @classmethod
    def _username(cls, v: str) -> str:
        v = v.strip().lower()
        if not USERNAME_RE.match(v):
            raise ValueError("username must be 3-32 characters: letters, digits, dot, dash or underscore")
        return v

    @field_validator("password")
    @classmethod
    def _password(cls, v: str) -> str:
        if len(v) < MIN_PASSWORD_LENGTH:
            raise ValueError(f"password must be at least {MIN_PASSWORD_LENGTH} characters")
        return v

    @field_validator("mobile", "whatsapp")
    @classmethod
    def _mobile(cls, v):
        return _clean_mobile(v)

    @field_validator("gst_number")
    @classmethod
    def _gst(cls, v):
        if not v or not v.strip():
            return None
        v = v.strip().upper().replace(" ", "")
        if not GST_RE.match(v):
            raise ValueError("GST number must be 15 characters")
        return v


class LoginIn(BaseModel):
    username: str
    password: str
    remember: bool = True


class PasswordIn(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def _password(cls, v: str) -> str:
        if len(v) < MIN_PASSWORD_LENGTH:
            raise ValueError(f"password must be at least {MIN_PASSWORD_LENGTH} characters")
        return v


@router.get("/username-available")
async def username_available(username: str, db: AsyncSession = Depends(get_session)):
    candidate = username.strip().lower()
    if not USERNAME_RE.match(candidate):
        return {"username": candidate, "available": False,
                "reason": "3-32 characters: letters, digits, dot, dash or underscore"}
    taken = (await db.execute(select(User.id).where(User.username == candidate))).first() is not None
    return {"username": candidate, "available": not taken, "reason": "already taken" if taken else ""}


@router.post("/register", response_model=MeOut, status_code=201)
async def register(body: RegisterIn, request: Request, response: Response,
                   db: AsyncSession = Depends(get_session)):
    taken = (await db.execute(select(User.id).where(User.username == body.username))).first()
    if taken is not None:
        raise HTTPException(409, "that username is taken")

    shop = Shop(name=body.name.strip(), type=body.type, default_language=body.default_language,
                gst_number=body.gst_number, mobile=body.mobile,
                whatsapp=body.whatsapp or body.mobile, address=(body.address or "").strip() or None)
    db.add(shop)
    await db.flush()
    user = User(shop_id=shop.id, display_name=body.owner_name.strip() or body.name.strip(),
                username=body.username, password_hash=hash_password(body.password),
                mobile=body.mobile, pin_hash="", role="owner")
    db.add(user)
    await db.flush()
    _, token = await session_svc.create_session(db, user, remember=True,
                                                user_agent=request.headers.get("user-agent"))
    await db.commit()
    session_svc.set_cookie(response, token, remember=True)
    return _me(shop, user)


@router.post("/login", response_model=MeOut)
async def login(body: LoginIn, request: Request, response: Response,
                db: AsyncSession = Depends(get_session)):
    handle = body.username.strip().lower()
    user = (await db.execute(select(User).where(or_(
        User.username == handle, User.mobile == re.sub(r"[\s()-]", "", handle))))).scalars().first()
    # Always run a hash, so a username that does not exist takes as long as a wrong password and the
    # endpoint cannot be used to find out which shopkeepers are registered.
    stored = user.password_hash if user else None
    if not verify_password(body.password, stored):
        if user is None:
            verify_password(body.password, hash_password("decoy"))
        raise HTTPException(401, "wrong username or password")

    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)  # silently upgrade the cost
    user.last_login_at = func.now()
    _, token = await session_svc.create_session(db, user, remember=body.remember,
                                                user_agent=request.headers.get("user-agent"))
    shop = await db.get(Shop, user.shop_id)
    await db.commit()
    session_svc.set_cookie(response, token, remember=body.remember)
    return _me(shop, user)


@router.post("/logout")
async def logout(response: Response, ctx: AuthContext = Depends(auth_context),
                 db: AsyncSession = Depends(get_session)):
    await session_svc.revoke(db, ctx.session_row)
    await db.commit()
    session_svc.clear_cookie(response)
    return {"ok": True}


@router.get("/me", response_model=MeOut)
async def me(ctx: AuthContext = Depends(auth_context)):
    return _me(ctx.shop, ctx.user)


@router.post("/password")
async def change_password(body: PasswordIn, request: Request, response: Response,
                          ctx: AuthContext = Depends(auth_context),
                          db: AsyncSession = Depends(get_session)):
    if not verify_password(body.current_password, ctx.user.password_hash):
        raise HTTPException(401, "current password is wrong")
    ctx.user.password_hash = hash_password(body.new_password)
    # Every other device is signed out, which is the point of changing a password.
    await session_svc.revoke_all_for_user(db, ctx.user.id)
    _, token = await session_svc.create_session(db, ctx.user, remember=True,
                                                user_agent=request.headers.get("user-agent"))
    await db.commit()
    session_svc.set_cookie(response, token, remember=True)
    return {"ok": True}
