"""Inventory intake against the compose Postgres: opening stock in packs, add/remove, physical count,
manual stock-in bill, history, local names, CSV import. Skipped when the database is unreachable."""
from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.db import get_engine

pytestmark = pytest.mark.asyncio


async def _db_ready() -> bool:
    try:
        async with get_engine().connect() as conn:
            await conn.execute(text("select 1"))
        return True
    except Exception:  # noqa: BLE001
        return False


async def _client_and_shop(c: AsyncClient, kind: str = "medical") -> dict:
    r = await c.post("/api/shops", json={"name": f"t-inv-{uuid.uuid4().hex[:6]}", "type": kind})
    assert r.status_code == 200, r.text
    return {"X-Shop-Id": r.json()["shop"]["id"]}


async def test_register_and_update_stock():
    if not await _db_ready():
        pytest.skip("postgres not reachable")
    from app.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        h = await _client_and_shop(c)
        r = await c.post("/api/products", headers=h, json={
            "name": "Paracetamol 500mg", "brand": "Cipla", "pack_unit": "strip", "sub_unit": "piece", "pack_size": 10,
            "sell_price": 20, "cost_price": 15, "aliases": ["para", "ପାରାସିଟାମଲ"],
            "opening_stock": 5, "opening_stock_unit": "strip"})
        assert r.status_code == 201, r.text
        p = r.json()
        pid, code = p["id"], p["code"]
        assert p["local_name"] == "ପାରାସିଟାମଲ"  # derived from the Odia alias for an od-IN shop
        assert float(p["stock_qty"]) == 50 and float(p["cost_price"]) == 15

        r = await c.post(f"/api/products/{pid}/stock", headers=h, json={"qty": 2, "unit": "strip", "reason": "restock"})
        assert float(r.json()["stock_qty"]) == 70
        r = await c.post(f"/api/products/{pid}/stock", headers=h, json={"delta_qty": -3, "reason": "damage", "note": "wet"})
        assert float(r.json()["stock_qty"]) == 67
        assert (await c.post(f"/api/products/{pid}/stock", headers=h, json={"reason": "restock"})).status_code == 400
        assert (await c.post(f"/api/products/{pid}/stock", headers=h,
                             json={"qty": 1, "unit": "bottle", "reason": "restock"})).status_code == 400
        assert (await c.post(f"/api/products/{pid}/stock", headers=h,
                             json={"qty": 1, "unit": "strip", "reason": "gift"})).status_code == 400

        r = await c.post(f"/api/products/{pid}/stock/count", headers=h, json={"counted_qty": 6, "unit": "strip"})
        assert float(r.json()["stock_qty"]) == 60

        r = await c.post("/api/transactions", headers=h, json={
            "voice_session_id": None, "type": "purchase", "customer_name": "Sai Distributors", "payment_mode": "credit",
            "notes": None, "deleted_item_indexes": [], "llm_intent": None,
            "items": [{"item_index": None, "product_code": code, "qty": 3, "unit": "strip", "unit_price": 150,
                       "spoken_span": None, "llm_product_code": None, "llm_confidence": None}]})
        assert r.status_code == 201, r.text
        txn = r.json()
        assert float(txn["total_amount"]) == 450
        assert txn["items"][0]["product_local_name"] == "ପାରାସିଟାମଲ"
        assert txn["items"][0]["was_corrected"] is False

        ledger = (await c.get(f"/api/products/{pid}/ledger", headers=h)).json()
        assert [m["reason"] for m in ledger] == ["purchase", "count", "damage", "restock", "opening"]
        assert float(ledger[0]["balance_after"]) == 90 and ledger[0]["transaction_id"] == txn["id"]
        assert float(ledger[1]["delta_qty"]) == -7 and ledger[1]["transaction_id"] is None

        r = await c.patch(f"/api/products/{pid}", headers=h, json={"local_name": "ପାରା"})
        assert r.json()["local_name"] == "ପାରା"
        assert [x["code"] for x in (await c.get("/api/products", headers=h, params={"q": "ପାରା"})).json()] == [code]
        r = await c.patch(f"/api/products/{pid}", headers=h, json={"local_name": "  "})
        assert r.json()["local_name"] is None

        bad = await c.post("/api/voice/sessions", headers=h, data={"client_session_id": "x", "mode": "refund"},
                           files={"audio": ("a.wav", b"RIFF", "audio/wav")})
        assert bad.status_code == 400


async def test_csv_import_new_repeated_and_existing_products():
    if not await _db_ready():
        pytest.skip("postgres not reachable")
    from app.main import app

    csv_text = (
        "name,brand,pack_unit,sub_unit,pack_size,sell_price,cost_price,aliases,opening_stock,local_name\n"
        "Crocin 500,GSK,strip,piece,15,30,24,crocin;କ୍ରୋସିନ,30,\n"
        "Crocin 500,GSK,strip,piece,15,31,24,krocin,,\n"
        "ORS Electral,FDC,packet,packet,1,22,,ors,10,ଓଆରଏସ ପ୍ୟାକେଟ\n"
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        h = await _client_and_shop(c)
        r = await c.post("/api/products/import", headers=h, files={"file": ("stock.csv", csv_text.encode(), "text/csv")})
        assert r.status_code == 200, r.text
        assert r.json() == {"created": 2, "updated": 1}
        again = await c.post("/api/products/import", headers=h, files={"file": ("stock.csv", csv_text.encode(), "text/csv")})
        assert again.status_code == 200 and again.json() == {"created": 0, "updated": 3}
        prods = {p["name"]: p for p in (await c.get("/api/products", headers=h)).json()}
        assert prods["Crocin 500"]["local_name"] == "କ୍ରୋସିନ"
        assert prods["ORS Electral"]["local_name"] == "ଓଆରଏସ ପ୍ୟାକେଟ"
        assert sorted(prods["Crocin 500"]["aliases"]) == sorted(["crocin", "କ୍ରୋସିନ", "krocin"])
        assert float(prods["Crocin 500"]["sell_price"]) == 31
