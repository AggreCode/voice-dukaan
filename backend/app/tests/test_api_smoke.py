"""End-to-end API smoke test against the compose Postgres (localhost:5433) with STT and Claude mocked.
Skipped when the database is unreachable. Exercises: shop create -> products -> voice session
(normalize + VAD + mocked STT + mocked extraction + guards) -> save bill -> stock + corrections + alias learning."""
from __future__ import annotations

import os
import subprocess
import uuid
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://vd:vd@localhost:5433/voicedukan")
os.environ["DATA_DIR"] = os.environ.get("PYTEST_DATA_DIR") or str(Path(__import__("tempfile").mkdtemp(prefix="vd-test-")))

from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.db import get_engine  # noqa: E402
from app.extraction.base import ExtractionOutcome  # noqa: E402
from app.schemas.extraction import Alternative, BillExtraction, ExtractedItem, Intent, Unit  # noqa: E402
from app.stt.base import STTResult  # noqa: E402

pytestmark = pytest.mark.asyncio


async def _db_ready() -> bool:
    try:
        async with get_engine().connect() as conn:
            await conn.execute(text("select 1"))
        return True
    except Exception:  # noqa: BLE001
        return False


def _speech_wav(path: Path, text: str = "paracetamol dasa gota, crocin dui patta") -> None:
    """Real (synthetic) speech so Silero VAD detects it; skips the test if espeak-ng is missing."""
    if subprocess.run(["which", "espeak-ng"], capture_output=True).returncode != 0:
        pytest.skip("espeak-ng missing (needed to synthesize test speech)")
    subprocess.run(["espeak-ng", "-v", "hi", "-s", "140", "-w", str(path), text], check=True, capture_output=True)


class FakeSarvam:
    name = "sarvam:fake"
    model = "fake"

    def __init__(self, transcript: str):
        self.transcript = transcript
        self.calls = 0

    async def transcribe(self, wav_path, *, hints, language="unknown"):
        self.calls += 1
        assert wav_path.exists() and hints, "hints must come from the catalog"
        return STTResult("sarvam:fake", "fake", self.transcript, language_code="od-IN", language_probability=0.93,
                         raw={"request_id": "r1"})

    async def translate(self, wav_path, *, hints, language="unknown"):
        return STTResult("sarvam:fake:translate", "fake", "paracetamol ten pieces crocin two strips",
                         language_code="en-IN")


class FakeExtractor:
    def __init__(self, bill: BillExtraction):
        self.bill = bill
        self.last_request = None

    async def extract(self, *, transcript, secondary_views, catalog, shop_ctx):
        self.last_request = {"transcript": transcript, "views": secondary_views, "catalog": catalog.rendered}
        return ExtractionOutcome(self.bill.model_copy(deep=True), request_id="req_test", model="fake",
                                 stop_reason="end_turn", latency_ms=5, usage={"input_tokens": 10, "output_tokens": 5,
                                                                              "cache_read_input_tokens": 0})


async def test_full_flow(tmp_path, monkeypatch):
    if not await _db_ready():
        pytest.skip("postgres not reachable on localhost:5433")
    if subprocess.run(["which", "ffmpeg"], capture_output=True).returncode != 0:
        pytest.skip("ffmpeg missing")
    s = get_settings()
    s.SARVAM_API_KEY = "test"
    s.SARVAM_TRANSLATE_VIEW = True
    s.GOOGLE_SHADOW_ENABLED = False

    from app.api import voice as voice_api
    from app.main import app

    transcript = "paracetamol dasa gota crocin dui patta"
    bill = BillExtraction(
        intent=Intent.sale, customer_name=None, payment_mode=None, notes="", transcript_language="mixed",
        items=[
            ExtractedItem(spoken_span="paracetamol dasa gota", product_id="p001", product_name_guess="Paracetamol",
                          quantity=10, unit=Unit.piece, unit_raw="gota", unit_price=None, alternatives=[],
                          confidence=0.96, needs_review=False, reason=""),
            ExtractedItem(spoken_span="crocin dui patta", product_id="p002", product_name_guess="Crocin",
                          quantity=2, unit=Unit.strip, unit_raw="patta", unit_price=None,
                          alternatives=[Alternative(product_id="p001", confidence=0.2)],
                          confidence=0.7, needs_review=False, reason=""),
        ])
    fake_stt = FakeSarvam(transcript)
    fake_llm = FakeExtractor(bill)
    monkeypatch.setattr(voice_api, "primary_provider", lambda: fake_stt)
    monkeypatch.setattr(voice_api, "get_extractor", lambda: fake_llm)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post("/api/shops", json={"name": f"t-{uuid.uuid4().hex[:6]}", "type": "medical"})
        assert r.status_code == 200, r.text
        shop_id = r.json()["shop"]["id"]
        h = {"X-Shop-Id": shop_id}

        for name, pack in [("Paracetamol 500mg", 10), ("Crocin 500", 15)]:
            r = await c.post("/api/products", headers=h, json={
                "name": name, "brand": "X", "pack_unit": "strip", "sub_unit": "piece", "pack_size": pack,
                "sell_price": 20, "aliases": ["alias1"], "opening_stock": 100})
            assert r.status_code == 201, r.text
        prods = {p["code"]: p for p in (await c.get("/api/products", headers=h)).json()}
        assert set(prods) == {"p001", "p002"}
        assert float(prods["p001"]["stock_qty"]) == 100

        wav = tmp_path / "bill.wav"
        _speech_wav(wav)
        csid = str(uuid.uuid4())
        with open(wav, "rb") as f:
            r = await c.post("/api/voice/sessions", headers=h, data={"client_session_id": csid, "duration_ms": 3000,
                                                                     "mime_type": "audio/wav"},
                             files={"audio": ("bill.wav", f, "audio/wav")})
        assert r.status_code == 200, r.text
        vs = r.json()
        assert vs["status"] == "extracted", vs
        assert vs["transcript"].startswith("paracetamol")
        assert vs["secondary_views"]["english"]
        assert {p["code"] for p in vs["review_products"]} == {"p001", "p002"}
        items = vs["extraction"]["items"]
        assert items[0]["needs_review"] is False
        assert items[1]["needs_review"] is True and items[1]["reason"] == "low_confidence"  # floor 0.75
        assert "p001|Paracetamol 500mg|X|alias1|strip|piece|10|20|general" in fake_llm.last_request["catalog"]
        assert vs["latencies"]["total_ms"] >= 0

        # idempotent retry returns the same session
        with open(wav, "rb") as f:
            r2 = await c.post("/api/voice/sessions", headers=h, data={"client_session_id": csid},
                              files={"audio": ("bill.wav", f, "audio/wav")})
        assert r2.json()["session_id"] == vs["session_id"]
        assert fake_stt.calls >= 1

        # save: user corrects item 2 from p002 -> p001 (alias learning) and keeps item 1
        r = await c.post("/api/transactions", headers=h, json={
            "voice_session_id": vs["session_id"], "type": "sale", "payment_mode": "cash", "customer_name": None,
            "notes": None, "deleted_item_indexes": [], "llm_intent": "sale",
            "items": [
                {"item_index": 0, "product_code": "p001", "qty": 10, "unit": "piece", "unit_price": 2,
                 "spoken_span": "paracetamol dasa gota", "llm_product_code": "p001", "llm_confidence": 0.96},
                {"item_index": 1, "product_code": "p001", "qty": 2, "unit": "strip", "unit_price": 20,
                 "spoken_span": "crocin dui patta", "llm_product_code": "p002", "llm_confidence": 0.7},
            ]})
        assert r.status_code == 201, r.text
        txn = r.json()
        assert float(txn["total_amount"]) == 60.0
        assert txn["items"][0]["was_corrected"] is False
        assert txn["items"][1]["was_corrected"] is True

        prods = {p["code"]: p for p in (await c.get("/api/products", headers=h)).json()}
        assert float(prods["p001"]["stock_qty"]) == 100 - 10 - 2 * 10  # 10 pieces + 2 strips of 10
        assert float(prods["p002"]["stock_qty"]) == 100
        assert "crocin dui patta" in prods["p001"]["aliases"]  # learned alias

        me = (await c.get("/api/shops/me", headers=h)).json()
        assert me["catalog_version"] >= 4  # bumped by 2 product creates + alias learning

        # ledger + void restores stock
        r = await c.post(f"/api/transactions/{txn['id']}/void", headers=h)
        assert r.json()["status"] == "voided"
        prods = {p["code"]: p for p in (await c.get("/api/products", headers=h)).json()}
        assert float(prods["p001"]["stock_qty"]) == 100

        health = (await c.get("/api/health")).json()
        assert health["db"] is True


async def test_no_speech_short_circuit(tmp_path, monkeypatch):
    if not await _db_ready():
        pytest.skip("postgres not reachable")
    from app.api import voice as voice_api
    from app.main import app

    s = get_settings()
    s.SARVAM_API_KEY = "test"
    fake = FakeSarvam("should not be called")
    monkeypatch.setattr(voice_api, "primary_provider", lambda: fake)
    monkeypatch.setattr(voice_api, "get_extractor", lambda: FakeExtractor(BillExtraction(
        intent=Intent.unknown, items=[], customer_name=None, payment_mode=None, notes="", transcript_language="od")))
    wav = tmp_path / "silence.wav"
    sf.write(str(wav), np.zeros(16000 * 2, dtype="float32"), 16000)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        shop_id = (await c.post("/api/shops", json={"name": "silent", "type": "kirana"})).json()["shop"]["id"]
        with open(wav, "rb") as f:
            r = await c.post("/api/voice/sessions", headers={"X-Shop-Id": shop_id},
                             data={"client_session_id": str(uuid.uuid4()), "mode": "stock_in"},
                             files={"audio": ("s.wav", f, "audio/wav")})
    assert r.status_code == 200 and r.json()["status"] == "no_speech", r.text
    assert r.json()["mode"] == "stock_in"
    assert fake.calls == 0
