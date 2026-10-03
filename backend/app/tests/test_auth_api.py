"""Sign up, sign in, sign out, and the isolation that makes them worth having.

Needs the compose Postgres; skipped when it is not up.
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://vd:vd@localhost:5433/voicedukan")
os.environ["DATA_DIR"] = os.environ.get("PYTEST_DATA_DIR") or str(
    Path(__import__("tempfile").mkdtemp(prefix="vd-auth-test-")))

from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.db import get_engine  # noqa: E402
from app.services.sessions import COOKIE_NAME  # noqa: E402

pytestmark = pytest.mark.asyncio


async def _db_ready() -> bool:
    try:
        async with get_engine().connect() as conn:
            await conn.execute(text("select 1"))
        return True
    except Exception:  # noqa: BLE001
        return False


def _client():
    from app.main import app

    return AsyncClient(transport=ASGITransport(app=app), base_url="https://test",
                       headers={"x-vd-app": "1"})


def _digits(handle: str) -> str:
    """A ten digit phone number made from a hex handle. Padded, because an eight character handle is
    two digits short of a real mobile number and the server is right to refuse it."""
    return ("9" + "".join(str(int(c, 16) % 10) for c in handle) + "0000000000")[:10]


def _registration(handle: str) -> dict:
    return {"name": f"t-{handle}", "type": "kirana", "mobile": _digits(handle),
            "address": "Main Road, Bhubaneswar", "gst_number": "21ABCDE1234F1Z5",
            "owner_name": "Owner", "username": f"u{handle}", "password": "a-good-password"}


async def test_register_then_use_the_app_then_sign_out():
    if not await _db_ready():
        pytest.skip("postgres not reachable on localhost:5433")
    handle = uuid.uuid4().hex[:8]
    async with _client() as c:
        assert (await c.get("/api/shops/me")).status_code == 401  # nothing yet

        r = await c.post("/api/auth/register", json=_registration(handle))
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["user"]["username"] == f"u{handle}"
        assert body["shop"]["gst_number"] == "21ABCDE1234F1Z5"
        assert body["shop"]["whatsapp"] == body["shop"]["mobile"], "unticked box means same as mobile"
        assert c.cookies.get(COOKIE_NAME), "registering should sign the shopkeeper in"
        assert "password" not in r.text.lower()

        assert (await c.get("/api/auth/me")).status_code == 200
        assert (await c.get("/api/shops/me")).json()["name"] == f"t-{handle}"

        assert (await c.post("/api/auth/logout")).status_code == 200
        assert (await c.get("/api/auth/me")).status_code == 401
        assert (await c.get("/api/products")).status_code == 401


async def test_login_by_username_or_mobile_and_reject_a_wrong_password():
    if not await _db_ready():
        pytest.skip("postgres not reachable on localhost:5433")
    handle = uuid.uuid4().hex[:8]
    reg = _registration(handle)
    async with _client() as c:
        await c.post("/api/auth/register", json=reg)
        await c.post("/api/auth/logout")

        bad = await c.post("/api/auth/login", json={"username": reg["username"], "password": "wrong"})
        assert bad.status_code == 401
        # the same answer for a user that does not exist, so the endpoint does not confirm who is registered
        missing = await c.post("/api/auth/login", json={"username": "nobody-here", "password": "wrong"})
        assert missing.status_code == 401 and missing.json()["detail"] == bad.json()["detail"]

        ok = await c.post("/api/auth/login", json={"username": reg["username"], "password": reg["password"]})
        assert ok.status_code == 200 and (await c.get("/api/auth/me")).status_code == 200
        await c.post("/api/auth/logout")

        by_phone = await c.post("/api/auth/login", json={"username": reg["mobile"], "password": reg["password"]})
        assert by_phone.status_code == 200, "a shopkeeper remembers a phone number"


async def test_one_shop_cannot_reach_another_shops_data():
    """The reason the X-Shop-Id header had to go: it let anybody name any shop and be believed."""
    if not await _db_ready():
        pytest.skip("postgres not reachable on localhost:5433")
    a_handle, b_handle = uuid.uuid4().hex[:8], uuid.uuid4().hex[:8]
    async with _client() as a, _client() as b:
        ra = await a.post("/api/auth/register", json=_registration(a_handle))
        shop_a = ra.json()["shop"]["id"]
        r = await a.post("/api/products", json={"name": "Secret Stock", "unit": "kg", "sell_price": 10})
        assert r.status_code == 201, r.text

        await b.post("/api/auth/register", json=_registration(b_handle))
        assert [p["name"] for p in (await b.get("/api/products")).json()] == []
        # naming shop A explicitly must change nothing at all
        assert [p["name"] for p in (await b.get("/api/products", headers={"X-Shop-Id": shop_a})).json()] == []
        assert (await b.get("/api/shops/me")).json()["id"] != shop_a


async def test_a_duplicate_username_is_refused_and_a_weak_password_is_rejected():
    if not await _db_ready():
        pytest.skip("postgres not reachable on localhost:5433")
    handle = uuid.uuid4().hex[:8]
    reg = _registration(handle)
    async with _client() as c:
        assert (await c.post("/api/auth/register", json=reg)).status_code == 201
        assert (await c.post("/api/auth/register", json=reg)).status_code == 409
        assert (await c.get("/api/auth/username-available",
                            params={"username": reg["username"]})).json()["available"] is False
        assert (await c.get("/api/auth/username-available",
                            params={"username": f"free{handle}"})).json()["available"] is True

    async with _client() as c:
        weak = _registration(uuid.uuid4().hex[:8]) | {"password": "short"}
        assert (await c.post("/api/auth/register", json=weak)).status_code == 422
        bad_name = _registration(uuid.uuid4().hex[:8]) | {"username": "a b"}
        assert (await c.post("/api/auth/register", json=bad_name)).status_code == 422
        bad_phone = _registration(uuid.uuid4().hex[:8]) | {"mobile": "12"}
        assert (await c.post("/api/auth/register", json=bad_phone)).status_code == 422


async def test_changing_the_password_signs_other_devices_out():
    if not await _db_ready():
        pytest.skip("postgres not reachable on localhost:5433")
    handle = uuid.uuid4().hex[:8]
    reg = _registration(handle)
    async with _client() as phone, _client() as laptop:
        await phone.post("/api/auth/register", json=reg)
        await laptop.post("/api/auth/login", json={"username": reg["username"], "password": reg["password"]})
        assert (await laptop.get("/api/auth/me")).status_code == 200

        r = await phone.post("/api/auth/password",
                             json={"current_password": reg["password"], "new_password": "an-even-better-one"})
        assert r.status_code == 200
        assert (await laptop.get("/api/auth/me")).status_code == 401, "the other device must be signed out"
        assert (await phone.get("/api/auth/me")).status_code == 200, "the device that changed it stays in"


async def test_a_state_changing_request_needs_the_app_header():
    """A cross-site form post carries the cookie but cannot set a custom header."""
    if not await _db_ready():
        pytest.skip("postgres not reachable on localhost:5433")
    from app.main import app

    handle = uuid.uuid4().hex[:8]
    async with _client() as c:
        await c.post("/api/auth/register", json=_registration(handle))
        cookie = c.cookies.get(COOKIE_NAME)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test",
                           cookies={COOKIE_NAME: cookie}) as forged:
        assert (await forged.get("/api/products")).status_code == 200, "reading is unaffected"
        r = await forged.post("/api/products", json={"name": "Injected", "unit": "kg"})
        assert r.status_code == 403


async def test_the_admin_console_is_invisible_and_unreachable_to_an_ordinary_shop():
    """It must not even admit to existing: a 404, not a 403, so nobody learns there is a console."""
    if not await _db_ready():
        pytest.skip("postgres not reachable on localhost:5433")
    handle = uuid.uuid4().hex[:8]
    async with _client() as c:
        await c.post("/api/auth/register", json=_registration(handle))
        assert (await c.get("/api/admin/shops")).status_code == 404
        assert (await c.get(f"/api/admin/shops/{uuid.uuid4()}")).status_code == 404
    # and signed out it is simply unauthorised
    async with _client() as anon:
        assert (await anon.get("/api/admin/shops")).status_code == 401


async def test_an_admin_sees_every_shop_but_cannot_change_any_of_them():
    if not await _db_ready():
        pytest.skip("postgres not reachable on localhost:5433")
    from sqlalchemy import select, update

    from app.db import get_sessionmaker
    from app.models import User

    a_handle, b_handle = uuid.uuid4().hex[:8], uuid.uuid4().hex[:8]
    async with _client() as shop_a, _client() as boss:
        await shop_a.post("/api/auth/register", json=_registration(a_handle))
        r = await shop_a.post("/api/products", json={"name": "Chini", "unit": "kg", "sell_price": 45})
        assert r.status_code == 201, r.text
        await shop_a.post("/api/transactions", json={
            "voice_session_id": None, "type": "sale", "payment_mode": "cash", "customer_name": "Ramesh",
            "notes": None, "deleted_item_indexes": [], "llm_intent": None,
            "items": [{"item_index": None, "product_code": "p001", "qty": 2, "unit": "kg",
                       "unit_price": 45, "spoken_span": None, "llm_product_code": None,
                       "llm_confidence": None}]})

        reg = _registration(b_handle)
        await boss.post("/api/auth/register", json=reg)
        async with get_sessionmaker()() as db:
            await db.execute(update(User).where(User.username == reg["username"]).values(role="admin"))
            await db.commit()

        overview = (await boss.get("/api/admin/shops")).json()
        assert overview["shops"] >= 2
        names = {row["name"]: row for row in overview["rows"]}
        mine = names[f"t-{a_handle}"]
        assert mine["products"] == 1 and mine["bills"] == 1 and mine["sales_total"] == 90.0
        assert mine["owner_username"] == f"u{a_handle}"
        assert "password" not in (await boss.get("/api/admin/shops")).text.lower()

        detail = (await boss.get(f"/api/admin/shops/{mine['id']}")).json()
        assert [u["username"] for u in detail["users"]] == [f"u{a_handle}"]
        assert detail["recent_bills"][0]["customer_name"] == "Ramesh"
        assert detail["recent_bills"][0]["items"] == 1
        assert all("hash" not in key for user in detail["users"] for key in user)

        # the console is read-only: an admin still only writes to their own shop
        r = await boss.post("/api/products", json={"name": "Not in shop A", "unit": "kg"})
        assert r.status_code == 201
        assert [p["name"] for p in (await shop_a.get("/api/products")).json()] == ["Chini"]
        assert (await boss.get("/api/shops/me")).json()["name"] == f"t-{b_handle}"
        assert select is not None


async def test_buying_sets_both_prices_and_selling_uses_them():
    """The buy screen asks for the wholesaler's rate and the shop's own selling price on the same line,
    so the margin is decided the moment the cost is known. Both must land on the product."""
    if not await _db_ready():
        pytest.skip("postgres not reachable on localhost:5433")
    handle = uuid.uuid4().hex[:8]
    async with _client() as c:
        await c.post("/api/auth/register", json=_registration(handle))
        r = await c.post("/api/products", json={"name": "Tiger Biscuit", "unit": "packet",
                                                "sell_price": 10, "cost_price": 7})
        assert r.status_code == 201, r.text

        bill = {"voice_session_id": None, "type": "purchase", "payment_mode": "cash", "customer_name": None,
                "notes": None, "deleted_item_indexes": [], "llm_intent": None,
                "items": [{"item_index": None, "product_code": "p001", "qty": 24, "unit": "packet",
                           "unit_price": 8, "sell_price": 12, "spoken_span": None, "llm_product_code": None,
                           "llm_confidence": None}]}
        r = await c.post("/api/transactions", json=bill)
        assert r.status_code == 201, r.text
        assert float(r.json()["total_amount"]) == 24 * 8, "a purchase is totalled at cost"

        p = (await c.get("/api/products")).json()[0]
        assert float(p["cost_price"]) == 8, "the last purchase sets the cost"
        assert float(p["sell_price"]) == 12, "and the shop's new selling price with it"
        assert float(p["stock_qty"]) == 24

        # selling then bills at the new price
        sale = bill | {"type": "sale", "items": [bill["items"][0] | {"qty": 2, "unit_price": 12,
                                                                     "sell_price": None}]}
        r = await c.post("/api/transactions", json=sale)
        assert float(r.json()["total_amount"]) == 24.0
        assert float((await c.get("/api/products")).json()[0]["stock_qty"]) == 22


async def test_analytics_ranks_what_sold_what_moves_and_what_earns():
    if not await _db_ready():
        pytest.skip("postgres not reachable on localhost:5433")
    handle = uuid.uuid4().hex[:8]
    async with _client() as c:
        await c.post("/api/auth/register", json=_registration(handle))
        for name, unit, sell, cost in (("Rice", "kg", 60, 50), ("Tiger Biscuit", "packet", 10, 6),
                                       ("Soap", "piece", 40, None)):
            body = {"name": name, "unit": unit, "sell_price": sell, "opening_stock": 100}
            if cost is not None:
                body["cost_price"] = cost
            assert (await c.post("/api/products", json=body)).status_code == 201

        def sale(code, qty, price):
            return {"voice_session_id": None, "type": "sale", "payment_mode": "cash", "customer_name": None,
                    "notes": None, "deleted_item_indexes": [], "llm_intent": None,
                    "items": [{"item_index": None, "product_code": code, "qty": qty, "unit": "",
                               "unit_price": price, "spoken_span": None, "llm_product_code": None,
                               "llm_confidence": None}]}

        await c.post("/api/transactions", json=sale("p001", 10, 60))   # rice: one big sale, ₹600
        for _ in range(3):
            await c.post("/api/transactions", json=sale("p002", 2, 10))  # biscuit: three small ones
        await c.post("/api/transactions", json=sale("p003", 1, 40))    # soap: no cost price

        a = (await c.get("/api/analytics", params={"days": 7})).json()
        assert a["totals"]["sales"] == 600 + 3 * 20 + 40
        assert a["totals"]["bills"] == 5
        assert a["top_revenue"][0]["name"] == "Rice"
        assert a["top_frequency"][0]["name"] == "Tiger Biscuit", "most bills, not most money"
        assert a["top_margin"][0]["name"] == "Tiger Biscuit", "67% beats rice's 20%"
        # profit only where the cost is known: rice 10 x 10 + biscuit 6 x 4, soap excluded
        assert a["totals"]["profit"] == 100 + 24
        assert 0 < a["totals"]["profit_coverage"] < 1
        assert len(a["daily"]) == 7 and a["daily"][-1]["sales"] == 700
        assert a["stock_value"]["missing_prices"] == 1


async def test_500_grams_of_a_kilo_product_is_half_a_kilo_not_500_kilos():
    """The bug that billed 500 g of Amul at ₹120/kg as ₹60,000 and took 500 kg off the shelf."""
    if not await _db_ready():
        pytest.skip("postgres not reachable on localhost:5433")
    handle = uuid.uuid4().hex[:8]
    async with _client() as c:
        await c.post("/api/auth/register", json=_registration(handle))
        await c.post("/api/products", json={"name": "Amul Butter", "unit": "Kg", "sell_price": 120,
                                            "cost_price": 100, "opening_stock": 25})
        line = {"item_index": None, "product_code": "p001", "qty": 500, "unit": "gm",
                "unit_price": 0.12, "spoken_span": None, "llm_product_code": None, "llm_confidence": None}
        bill = {"voice_session_id": None, "type": "sale", "payment_mode": "cash", "customer_name": None,
                "notes": None, "deleted_item_indexes": [], "llm_intent": None, "items": [line]}
        r = await c.post("/api/transactions", json=bill)
        assert r.status_code == 201, r.text
        assert float(r.json()["total_amount"]) == 60.0
        assert r.json()["items"][0]["unit"] == "g", "stored in one spelling"
        assert float((await c.get("/api/products")).json()[0]["stock_qty"]) == 24.5

        # buying 2000 g at ₹0.11 a gram sets the cost to ₹110 a KILO, the product's own unit
        buy = bill | {"type": "purchase", "items": [line | {"qty": 2000, "unit_price": 0.11, "sell_price": 130}]}
        assert (await c.post("/api/transactions", json=buy)).status_code == 201
        p = (await c.get("/api/products")).json()[0]
        assert float(p["cost_price"]) == 110 and float(p["sell_price"]) == 130
        assert float(p["stock_qty"]) == 26.5

        # a packet of something stocked in kilos has no honest weight: refused, with the reason
        r = await c.post("/api/transactions", json=bill | {"items": [line | {"unit": "packet", "qty": 1}]})
        assert r.status_code == 400 and "counted in Kg" in r.json()["detail"]
