"""A believable shop for the demo video: kirana stock, a week of sales, and two captures to walk through.

Run against a FRESH database (make_video.sh starts one). Prints nothing secret; writes the two session
ids the recorder opens to work/sessions.json.
"""
from __future__ import annotations

import asyncio
import json
import os
import random
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parents[1] / "backend"))
BASE = os.environ.get("DEMO_BASE", "http://localhost:8765")
USER, PASSWORD = "maatarini", "demo-pass-123"

# name, unit, sell, cost, opening stock, low-stock threshold, local name
PRODUCTS = [
    ("Basmati Rice", "kg", 95, 78, 60, 10, "ବାସମତୀ ଚାଉଳ"),
    ("Marie Gold Biscuit", "packet", 30, 24, 70, 10, None),
    ("Tiger Biscuit", "packet", 10, 7, 160, 20, None),
    ("Good Day Biscuit", "packet", 25, 20, 14, 12, None),
    ("Sugar", "kg", 46, 40, 90, 15, "ଚିନି"),
    ("Toor Dal", "kg", 140, 118, 40, 8, "ହରଡ଼ ଡାଲି"),
    ("Mustard Oil", "litre", 165, 142, 30, 5, "ସୋରିଷ ତେଲ"),
    ("Maggi Noodles", "packet", 14, 11, 120, 20, None),
    ("Tata Salt", "packet", 28, 22, 30, 12, "ଲୁଣ"),
    ("Surf Excel", "packet", 120, 104, 25, 4, None),
    ("Red Label Tea", "packet", 135, 115, 26, 8, "ଚା"),
    ("Parle G", "packet", 10, 8, 150, 20, None),
]


async def main() -> None:
    async with httpx.AsyncClient(base_url=BASE, headers={"x-vd-app": "1"}, timeout=30) as c:
        r = await c.post("/api/auth/register", json={
            "name": "Maa Tarini Stores", "type": "kirana", "default_language": "or-IN", "mobile": "9876500011",
            "address": "Unit 4 Market, Bhubaneswar", "owner_name": "Ramesh Sahu",
            "username": USER, "password": PASSWORD})
        assert r.status_code == 201, r.text
        # The session cookie is Secure; a script on plain http://localhost will not keep it by itself.
        c.headers["cookie"] = "vd_session=" + r.headers["set-cookie"].split("vd_session=", 1)[1].split(";", 1)[0]

        for name, unit, sell, cost, stock, low, local in PRODUCTS:
            body = {"name": name, "unit": unit, "sell_price": sell, "cost_price": cost,
                    "opening_stock": stock, "low_stock_threshold": low}
            if local:
                body["local_name"] = local
            assert (await c.post("/api/products", json=body)).status_code == 201
        prods = {p["name"]: p for p in (await c.get("/api/products")).json()}

        random.seed(11)
        weights = {"Tiger Biscuit": 9, "Maggi Noodles": 7, "Parle G": 6, "Sugar": 5, "Basmati Rice": 4,
                   "Marie Gold Biscuit": 4, "Tata Salt": 3, "Toor Dal": 3, "Mustard Oil": 2,
                   "Red Label Tea": 2, "Surf Excel": 1, "Good Day Biscuit": 1}
        names, w = list(weights), list(weights.values())
        by_day: dict[int, list[str]] = {}
        for day in range(6, -1, -1):
            for _ in range(random.randint(5, 9) if day else 7):
                lines = []
                for name in set(random.choices(names, weights=w, k=random.randint(1, 4))):
                    p = prods[name]
                    lines.append({"item_index": None, "product_code": p["code"], "qty": random.choice([1, 1, 2, 2, 3]),
                                  "unit": p["unit"], "unit_price": float(p["sell_price"]), "spoken_span": None,
                                  "llm_product_code": None, "llm_confidence": None})
                r = await c.post("/api/transactions", json={
                    "voice_session_id": None, "type": "sale", "payment_mode": random.choice(["cash", "cash", "upi"]),
                    "customer_name": None, "notes": None, "deleted_item_indexes": [], "llm_intent": None,
                    "items": lines})
                assert r.status_code == 201, r.text
                by_day.setdefault(day, []).append(r.json()["id"])
        code = {n: p["code"] for n, p in prods.items()}

    from sqlalchemy import select, update

    from app.db import get_sessionmaker
    from app.models import Shop, Transaction, VoiceSession

    def item(span, pid, guess, conf=0.93, alts=(), reason="no_quantity", qty=None, unit="", price=None):
        return {"spoken_span": span, "product_id": pid, "product_name_guess": guess, "quantity": qty,
                "unit": unit, "unit_price": price,
                "alternatives": [{"product_id": a, "confidence": 0.6} for a in alts],
                "confidence": conf, "needs_review": True, "reason": reason}

    async with get_sessionmaker()() as db:
        now = datetime.now(timezone.utc)
        for day, ids in by_day.items():
            for i, tid in enumerate(ids):
                when = now - timedelta(days=day, hours=i + 1) if day else now - timedelta(minutes=30 * (i + 1))
                await db.execute(update(Transaction).where(Transaction.id == uuid.UUID(tid)).values(created_at=when))
        shop = (await db.execute(select(Shop).where(Shop.name == "Maa Tarini Stores"))).scalars().first()

        # What the speech engine and the model return for "basmati, marigold biscuit aau tiger biscuit":
        # three products, no quantities, because none were said.
        sale = VoiceSession(
            shop_id=shop.id, client_session_id=str(uuid.uuid4()), status="extracted", input_kind="voice",
            input_mode="sale", sarvam_transcript="basmati, marigold biscuit aau tiger biscuit",
            llm_output_json={"intent": "sale", "customer_name": None, "payment_mode": None, "notes": "",
                             "transcript_language": "mixed", "items": [
                                 item("basmati", code["Basmati Rice"], "Basmati Rice"),
                                 item("marigold biscuit", code["Marie Gold Biscuit"], "Marie Gold Biscuit"),
                                 item("tiger biscuit", code["Tiger Biscuit"], "Tiger Biscuit")]})
        # What the photo reader and the model return for the wholesaler's bill drawn in record.mjs.
        lines = ["Sugar | 25 | kg | 39", "Moong Dal | 10 | kg | 105", "Biscuit | 48 | pkt | 7"]
        buy = VoiceSession(
            shop_id=shop.id, client_session_id=str(uuid.uuid4()), status="extracted", input_kind="image",
            input_mode="stock_in", image_count=1, ocr_text=" | ".join(lines),
            ocr_meta={"reader": "gemini:vision", "lines": lines, "columns": ["product", "qty", "unit", "rate"],
                      "columns_inferred": False, "unclear_lines": [], "notes": ""},
            llm_output_json={"intent": "purchase", "customer_name": None, "payment_mode": None, "notes": "",
                             "transcript_language": "en", "items": [
                                 item(lines[0], code["Sugar"], "Sugar", conf=0.97, reason="", qty=25, unit="kg", price=39),
                                 item(lines[1], None, "Moong Dal", conf=0.4, reason="not_in_catalog", qty=10, unit="kg", price=105),
                                 item(lines[2], code["Tiger Biscuit"], "Tiger Biscuit", conf=0.6,
                                      alts=(code["Marie Gold Biscuit"], code["Good Day Biscuit"], code["Parle G"]),
                                      reason="ambiguous_category", qty=48, unit="packet", price=7)]})
        db.add_all([sale, buy])
        await db.commit()
        (HERE / "work").mkdir(exist_ok=True)
        (HERE / "work" / "sessions.json").write_text(json.dumps(
            {"sale": str(sale.id), "buy": str(buy.id), "user": USER, "password": PASSWORD}))
        print(f"  seeded: {len(PRODUCTS)} products, {sum(len(v) for v in by_day.values())} bills, 2 captures")


if __name__ == "__main__":
    asyncio.run(main())
