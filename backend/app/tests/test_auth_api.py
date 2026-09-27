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

    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test",
                       headers={"x-vd-app": "1"})


def _registration(handle: str) -> dict:
    return {"name": f"t-{handle}", "type": "kirana", "mobile": f"98765{handle[:5]}",
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

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test",
                           cookies={COOKIE_NAME: cookie}) as forged:
        assert (await forged.get("/api/products")).status_code == 200, "reading is unaffected"
        r = await forged.post("/api/products", json={"name": "Injected", "unit": "kg"})
        assert r.status_code == 403
