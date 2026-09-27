"""Attach a username and password to a shop that predates logins, or reset a forgotten password.

    backend/.venv/bin/python scripts/set_password.py --shop "Maa Tarini Medical" --username maa --password '...'

Without --password it asks for one without echoing it. Every existing session for that user is
revoked, so a reset also kicks out whoever was using the old one.
"""
from __future__ import annotations

import argparse
import asyncio
import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.db import get_sessionmaker  # noqa: E402
from app.models import Shop, User  # noqa: E402
from app.services.passwords import MIN_PASSWORD_LENGTH, hash_password  # noqa: E402
from app.services.sessions import revoke_all_for_user  # noqa: E402


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--shop", required=True, help="shop name, or its id")
    ap.add_argument("--username", required=True)
    ap.add_argument("--password", default=None)
    ap.add_argument("--display-name", default=None)
    args = ap.parse_args()

    password = args.password or getpass.getpass("New password: ")
    if len(password) < MIN_PASSWORD_LENGTH:
        raise SystemExit(f"password must be at least {MIN_PASSWORD_LENGTH} characters")
    username = args.username.strip().lower()

    async with get_sessionmaker()() as db:
        shop = (await db.execute(select(Shop).where(Shop.name == args.shop))).scalars().first()
        if shop is None:
            shop = (await db.execute(select(Shop).where(Shop.id == args.shop))).scalars().first()
        if shop is None:
            raise SystemExit(f"no shop called {args.shop!r}")

        clash = (await db.execute(select(User).where(User.username == username))).scalars().first()
        if clash is not None and clash.shop_id != shop.id:
            raise SystemExit(f"username {username!r} already belongs to another shop")

        user = (await db.execute(select(User).where(User.shop_id == shop.id))).scalars().first()
        if user is None:
            user = User(shop_id=shop.id, display_name=args.display_name or shop.name, pin_hash="", role="owner")
            db.add(user)
        user.username = username
        user.password_hash = hash_password(password)
        if args.display_name:
            user.display_name = args.display_name
        await db.flush()
        await revoke_all_for_user(db, user.id)
        await db.commit()
        print(f"{shop.name}: sign in as {username!r}. All previous sessions were revoked.")


if __name__ == "__main__":
    asyncio.run(main())
