"""POST /api/scan/sessions against the compose Postgres, with the reader stubbed.

Skipped when the database is unreachable, like test_api_smoke.py. Run it with:
  cd infra && docker compose up -d db
  cd ../backend && DATABASE_URL=postgresql+asyncpg://vd:vd@localhost:5433/voicedukan .venv/bin/pytest -q
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://vd:vd@localhost:5433/voicedukan")
os.environ["DATA_DIR"] = os.environ.get("PYTEST_DATA_DIR") or str(
    Path(__import__("tempfile").mkdtemp(prefix="vd-scan-test-")))

from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.db import get_engine  # noqa: E402
from app.extraction.base import ExtractionOutcome  # noqa: E402
from app.schemas.extraction import BillExtraction, ExtractedItem, Intent  # noqa: E402
from app.vision.base import ReadResult  # noqa: E402

pytestmark = pytest.mark.asyncio

JPEG = b"\xff\xd8\xff\xe0" + b"0" * 64  # not decoded anywhere: the reader is stubbed


async def _db_ready() -> bool:
    try:
        async with get_engine().connect() as conn:
            await conn.execute(text("select 1"))
        return True
    except Exception:  # noqa: BLE001
        return False


class StubReader:
    name = "stub:reader"
    model = "stub"

    def __init__(self):
        self.images_seen = 0
        self.hints: list[str] = []

    async def read(self, images, *, hints):
        self.images_seen = len(images)
        self.hints = hints
        return ReadResult(self.name, self.model, ["chini 2 kg", "para 10 patta"], script="mixed",
                          raw={"unclear_lines": ["para 10 patta"]})


class StubExtractor:
    async def extract(self, *, transcript, secondary_views, catalog, shop_ctx):
        self.ctx = shop_ctx
        bill = BillExtraction(
            intent=Intent.sale, customer_name=None, payment_mode=None, notes="", transcript_language="mixed",
            items=[
                ExtractedItem(spoken_span="chini 2 kg", product_id="p001", product_name_guess="Sugar",
                              quantity=2, unit="kg", unit_price=None, alternatives=[], confidence=0.95,
                              needs_review=False, reason=""),
                ExtractedItem(spoken_span="para 10 patta", product_id=None, product_name_guess="para",
                              quantity=10, unit="patta", unit_price=None, alternatives=[], confidence=0.4,
                              needs_review=True, reason="not_in_catalog"),
            ])
        return ExtractionOutcome(bill, request_id="req_scan", model="stub", stop_reason="end_turn",
                                 latency_ms=3, usage={"input_tokens": 9, "output_tokens": 4})


async def test_scan_upload_reads_matches_and_stores_no_photo(monkeypatch):
    if not await _db_ready():
        pytest.skip("postgres not reachable on localhost:5433")
    s = get_settings()
    s.GEMINI_API_KEY = "test"
    s.EXTRACTOR_MODE = "gemini"
    s.KEEP_IMAGES = False

    from app.api import scan as scan_api
    from app.main import app

    reader = StubReader()
    monkeypatch.setattr(scan_api, "get_reader", lambda: reader)
    monkeypatch.setattr(scan_api, "get_extractor", lambda: StubExtractor())

    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test",
                           headers={"x-vd-app": "1"}) as c:
        handle = uuid.uuid4().hex[:8]
        r = await c.post("/api/auth/register", json={
            "name": f"t-{handle}", "type": "kirana", "mobile": "9876543211",
            "username": f"u{handle}", "password": "a-good-password"})
        assert r.status_code == 201, r.text
        h: dict[str, str] = {}
        for name, unit in (("Sugar", "kg"), ("Paracetamol 500mg", "strip")):
            r = await c.post("/api/products", headers=h, json={"name": name, "unit": unit, "sell_price": 20,
                                                               "aliases": ["chini" if unit == "kg" else "para"],
                                                               "opening_stock": 50})
            assert r.status_code == 201, r.text

        csid = str(uuid.uuid4())
        files = [("images", ("page1.jpg", JPEG, "image/jpeg")), ("images", ("page2.jpg", JPEG, "image/jpeg"))]
        r = await c.post("/api/scan/sessions", headers=h, data={"client_session_id": csid, "mode": "sale"},
                         files=files)
        assert r.status_code == 200, r.text
        out = r.json()

        assert out["status"] == "extracted"
        assert out["input_kind"] == "image" and out["image_count"] == 2
        assert reader.images_seen == 2
        assert out["transcript"] == "chini 2 kg | para 10 patta"
        assert out["ocr_lines"] == ["chini 2 kg", "para 10 patta"]
        assert out["ocr_unclear_lines"] == ["para 10 patta"]
        assert out["reader"] == "stub:reader"
        assert {p["code"] for p in out["review_products"]} >= {"p001"}

        items = out["extraction"]["items"]
        assert items[0]["product_id"] == "p001"
        # the line the model gave up on is filled in by the spelling backstop, still flagged
        assert items[1]["product_id"] == "p002"
        assert items[1]["needs_review"] is True and "fuzzy_matched" in items[1]["reason"]
        assert items[1]["confidence"] <= 0.7

        # nothing about the customer's list is left on disk
        assert not (Path(s.DATA_DIR) / "scan").exists()

        # idempotent retry: the same client id returns the same session without reading again
        r2 = await c.post("/api/scan/sessions", headers=h, data={"client_session_id": csid},
                          files=[("images", ("page1.jpg", JPEG, "image/jpeg"))])
        assert r2.json()["session_id"] == out["session_id"]
        assert reader.images_seen == 2

        # the same session is readable from either endpoint, since it is one table
        assert (await c.get(f"/api/scan/sessions/{out['session_id']}", headers=h)).status_code == 200
        assert (await c.get(f"/api/voice/sessions/{out['session_id']}", headers=h)).status_code == 200

        # rejections, before anything is read
        r = await c.post("/api/scan/sessions", headers=h, data={"client_session_id": str(uuid.uuid4())},
                         files=[("images", ("x.pdf", b"%PDF-1.4", "application/pdf"))])
        assert r.status_code == 415
        r = await c.post("/api/scan/sessions", headers=h, data={"client_session_id": str(uuid.uuid4())},
                         files=[("images", (f"p{i}.jpg", JPEG, "image/jpeg")) for i in range(4)])
        assert r.status_code == 413
