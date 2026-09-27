"""Grant, or take away, the admin role on an existing account.

    .venv/bin/python scripts/make_admin.py --username biswajit
    .venv/bin/python scripts/make_admin.py --username biswajit --revoke
    .venv/bin/python scripts/make_admin.py --list

Only from a shell on the server, never through the API, so no bug in a form can hand somebody every
shop on the service. An admin keeps their own shop and signs in the ordinary way; the console simply
appears for them.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.db import get_sessionmaker  # noqa: E402
from app.models import Shop, User  # noqa: E402
from app.services.sessions import revoke_all_for_user  # noqa: E402


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--username")
    ap.add_argument("--revoke", action="store_true", help="take the role away again")
    ap.add_argument("--list", action="store_true", help="show who has it")
    args = ap.parse_args()

    async with get_sessionmaker()() as db:
        if args.list or not args.username:
            rows = (await db.execute(
                select(User, Shop).join(Shop, Shop.id == User.shop_id)
                .where(User.role == "admin").order_by(User.username))).all()
            if not rows:
                print("No administrators.")
            for user, shop in rows:
                print(f"{user.username}  ({user.display_name}, shop: {shop.name})")
            if not args.username:
                return

        user = (await db.execute(
            select(User).where(User.username == args.username.strip().lower()))).scalars().first()
        if user is None:
            raise SystemExit(f"no account called {args.username!r}")

        user.role = "owner" if args.revoke else "admin"
        # The role is read from the session's user on every request, so existing sessions would pick
        # this up anyway. Revoking them makes the change deliberate and visible to whoever is signed in.
        await revoke_all_for_user(db, user.id)
        await db.commit()
        print(f"{user.username} is now {user.role}. Their other sessions were signed out.")


if __name__ == "__main__":
    asyncio.run(main())
