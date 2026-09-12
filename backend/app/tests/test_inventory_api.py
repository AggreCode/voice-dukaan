"""Inventory intake against the compose Postgres: a product has exactly one unit (no pack/sub-unit
conversion), quick add, add/remove stock, physical count, manual stock-in bill, history, local
names, CSV import, and the autocomplete glossary. Skipped when the database is unreachable."""
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


async def test_quick_add_uses_one_unit_no_conversion():
    if not await _db_ready():
        pytest.skip("postgres not reachable")
    from app.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        h = await _client_and_shop(c)
        # the 3-field quick add: name, unit, quantity (opening_stock) -- everything else optional
        r = await c.post("/api/products", headers=h, json={"name": "Rice Basmati", "unit": "kg", "opening_stock": 50})
        assert r.status_code == 201, r.text
        p = r.json()
        assert p["unit"] == "kg" and float(p["stock_qty"]) == 50 and float(p["sell_price"]) == 0

        # a wholesaler-style unit is accepted as-is, never reinterpreted
        r = await c.post("/api/products", headers=h, json={"name": "Cooking Oil Carton", "unit": "carton",
                                                            "sell_price": 1200, "opening_stock": 10})
        assert r.status_code == 201, r.text
        assert r.json()["unit"] == "carton" and float(r.json()["stock_qty"]) == 10


async def test_register_and_update_stock():
    if not await _db_ready():
        pytest.skip("postgres not reachable")
    from app.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        h = await _client_and_shop(c)
        r = await c.post("/api/products", headers=h, json={
            "name": "Paracetamol 500mg", "brand": "Cipla", "unit": "strip",
            "sell_price": 20, "cost_price": 15, "aliases": ["para", "ପାରାସିଟାମଲ"], "opening_stock": 50})
        assert r.status_code == 201, r.text
        p = r.json()
        pid, code = p["id"], p["code"]
        assert p["local_name"] == "ପାରାସିଟାମଲ"  # derived from the Odia alias for an od-IN shop
        assert float(p["stock_qty"]) == 50 and float(p["cost_price"]) == 15

        # add/remove: a single signed delta_qty in the product's own unit, no unit field to get wrong
        r = await c.post(f"/api/products/{pid}/stock", headers=h, json={"delta_qty": 2, "reason": "restock"})
        assert float(r.json()["stock_qty"]) == 52
        r = await c.post(f"/api/products/{pid}/stock", headers=h, json={"delta_qty": -3, "reason": "damage", "note": "wet"})
        assert float(r.json()["stock_qty"]) == 49
        assert (await c.post(f"/api/products/{pid}/stock", headers=h, json={"delta_qty": 0, "reason": "restock"})).status_code == 400
        assert (await c.post(f"/api/products/{pid}/stock", headers=h,
                             json={"delta_qty": 1, "reason": "gift"})).status_code == 400

        r = await c.post(f"/api/products/{pid}/stock/count", headers=h, json={"counted_qty": 60})
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
        assert float(ledger[0]["balance_after"]) == 63 and ledger[0]["transaction_id"] == txn["id"]
        assert float(ledger[1]["delta_qty"]) == 11 and ledger[1]["transaction_id"] is None

        r = await c.patch(f"/api/products/{pid}", headers=h, json={"local_name": "ପାରା"})
        assert r.json()["local_name"] == "ପାରା"
        assert [x["code"] for x in (await c.get("/api/products", headers=h, params={"q": "ପାରା"})).json()] == [code]
        r = await c.patch(f"/api/products/{pid}", headers=h, json={"local_name": "  "})
        assert r.json()["local_name"] is None

        # unit is free text: patching to a different word is accepted verbatim, no validation against an enum
        r = await c.patch(f"/api/products/{pid}", headers=h, json={"unit": "box"})
        assert r.json()["unit"] == "box"

        bad = await c.post("/api/voice/sessions", headers=h, data={"client_session_id": "x", "mode": "refund"},
                           files={"audio": ("a.wav", b"RIFF", "audio/wav")})
        assert bad.status_code == 400


async def test_csv_import_new_repeated_and_existing_products():
    if not await _db_ready():
        pytest.skip("postgres not reachable")
    from app.main import app

    csv_text = (
        "name,brand,unit,sell_price,cost_price,aliases,opening_stock,local_name\n"
        "Crocin 500,GSK,strip,30,24,crocin;କ୍ରୋସିନ,30,\n"
        "Crocin 500,GSK,strip,31,24,krocin,,\n"
        "ORS Electral,FDC,packet,22,,ors,10,ଓଆରଏସ ପ୍ୟାକେଟ\n"
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
        assert prods["Crocin 500"]["unit"] == "strip"
        assert prods["ORS Electral"]["local_name"] == "ଓଆରଏସ ପ୍ୟାକେଟ"
        assert sorted(prods["Crocin 500"]["aliases"]) == sorted(["crocin", "କ୍ରୋସିନ", "krocin"])
        assert float(prods["Crocin 500"]["sell_price"]) == 31


async def test_glossary_suggests_by_shop_type_but_never_constrains_input():
    """The glossary is a typing aid only. It must never be confused with a shop's real inventory:
    it does not touch the products table, and any name a shopkeeper types is still accepted."""
    if not await _db_ready():
        pytest.skip("postgres not reachable")
    from app.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        h_med = await _client_and_shop(c, kind="medical")
        h_kir = await _client_and_shop(c, kind="kirana")

        med = (await c.get("/api/glossary", headers=h_med, params={"q": "paracetamol"})).json()
        assert any("paracetamol" in name.casefold() for name in med), med
        assert len(med) >= 1

        kir = (await c.get("/api/glossary", headers=h_kir, params={"q": "rice"})).json()
        assert any("rice" in name.casefold() for name in kir), kir

        # medical and kirana suggestion pools are meaningfully different
        med_all = set((await c.get("/api/glossary", headers=h_med, params={"limit": 50})).json())
        kir_all = set((await c.get("/api/glossary", headers=h_kir, params={"limit": 50})).json())
        assert med_all and kir_all and med_all != kir_all

        # a name that is NOT on any glossary is still accepted as a real product -- the list never constrains input
        r = await c.post("/api/products", headers=h_med,
                         json={"name": "Grandma's Secret Herbal Mix", "unit": "jar", "opening_stock": 4})
        assert r.status_code == 201, r.text
        assert r.json()["name"] == "Grandma's Secret Herbal Mix"
        # and it does NOT leak into the glossary or any other shop
        assert "Grandma's Secret Herbal Mix" not in med_all
