from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_shop, hash_pin, make_token
from app.db import get_session
from app.models import Shop, User
from app.schemas.api import ShopIn, ShopOut

router = APIRouter(prefix="/api", tags=["shops"])


class RegisterIn(ShopIn):
    owner_name: str = "Owner"
    pin: str | None = None


class LoginIn(BaseModel):
    shop_id: str
    pin: str


class LoginOut(BaseModel):
    token: str
    shop: ShopOut


@router.post("/shops", response_model=LoginOut)
async def register_shop(body: RegisterIn, session: AsyncSession = Depends(get_session)):
    shop = Shop(name=body.name, type=body.type, default_language=body.default_language)
    session.add(shop)
    await session.flush()
    user = User(shop_id=shop.id, display_name=body.owner_name, pin_hash=hash_pin(body.pin or ""), role="owner")
    session.add(user)
    await session.commit()
    return LoginOut(token=make_token(shop.id, user.id), shop=ShopOut.model_validate(shop, from_attributes=True))


@router.post("/auth/login", response_model=LoginOut)
async def login(body: LoginIn, session: AsyncSession = Depends(get_session)):
    shop = await session.get(Shop, body.shop_id)
    if shop is None:
        raise HTTPException(404, "shop not found")
    user = (await session.execute(select(User).where(User.shop_id == shop.id))).scalars().first()
    if user is None or user.pin_hash != hash_pin(body.pin):
        raise HTTPException(401, "wrong pin")
    return LoginOut(token=make_token(shop.id, user.id), shop=ShopOut.model_validate(shop, from_attributes=True))


@router.get("/shops", response_model=list[ShopOut])
async def list_shops(session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(select(Shop).order_by(Shop.created_at))).scalars().all()
    return [ShopOut.model_validate(r, from_attributes=True) for r in rows]


@router.get("/shops/me", response_model=ShopOut)
async def me(shop: Shop = Depends(current_shop)):
    return ShopOut.model_validate(shop, from_attributes=True)


@router.patch("/shops/me", response_model=ShopOut)
async def update_me(body: ShopIn, shop: Shop = Depends(current_shop), session: AsyncSession = Depends(get_session)):
    shop.name, shop.type, shop.default_language = body.name, body.type, body.default_language
    await session.commit()
    return ShopOut.model_validate(shop, from_attributes=True)
