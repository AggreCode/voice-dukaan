"""Autocomplete suggestions for the manual "Add product" form.

This is a static, curated word list per store type -- NOT a shop's inventory. It never reads or
writes the products table; a shopkeeper may always type a name that isn't on the list.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import current_shop
from app.models import Shop
from app.services import glossary

router = APIRouter(prefix="/api/glossary", tags=["glossary"])


@router.get("", response_model=list[str])
async def search_glossary(q: str = "", limit: int = 20, shop: Shop = Depends(current_shop)):
    return glossary.search(shop.type, q, limit=max(1, min(limit, 50)))
