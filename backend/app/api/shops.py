"""What is left of the shops router once accounts moved to /api/auth.

`GET /api/shops`, which listed every shop on the service to anybody who asked, is deliberately gone:
it leaked the name of every customer of this product, and the app used it to let a visitor walk into
any shop without a password.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_shop
from app.db import get_session
from app.models import Shop
from app.schemas.api import ShopIn, ShopOut

router = APIRouter(prefix="/api", tags=["shops"])


@router.get("/shops/me", response_model=ShopOut)
async def me(shop: Shop = Depends(current_shop)):
    return ShopOut.model_validate(shop, from_attributes=True)


@router.patch("/shops/me", response_model=ShopOut)
async def update_me(body: ShopIn, shop: Shop = Depends(current_shop),
                    session: AsyncSession = Depends(get_session)):
    shop.name, shop.type, shop.default_language = body.name, body.type, body.default_language
    for field in ("gst_number", "mobile", "whatsapp", "address"):
        value = getattr(body, field)
        if value is not None:
            setattr(shop, field, value.strip() or None)
    await session.commit()
    return ShopOut.model_validate(shop, from_attributes=True)
