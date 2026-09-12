"""Export saved voice sessions (with the shopkeeper's final corrections as golden) into eval/data.

Usage (from backend/): python scripts/export_sessions_to_eval.py --shop-id <uuid> [--since 2026-09-01]
Copies norm16k.wav to eval/data/utterances/<session>.wav and writes eval/data/golden/<session>.json.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.db import get_sessionmaker  # noqa: E402
from app.models import Product, VoiceSession  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--shop-id", required=True)
    ap.add_argument("--since", default=None)
    args = ap.parse_args()
    out_audio = ROOT / "eval" / "data" / "utterances"
    out_gold = ROOT / "eval" / "data" / "golden"
    out_audio.mkdir(parents=True, exist_ok=True)
    out_gold.mkdir(parents=True, exist_ok=True)

    async with get_sessionmaker()() as session:
        stmt = select(VoiceSession).where(VoiceSession.shop_id == args.shop_id, VoiceSession.status == "saved")
        if args.since:
            stmt = stmt.where(VoiceSession.created_at >= datetime.fromisoformat(args.since))
        sessions = (await session.execute(stmt)).scalars().all()
        products = {p.code: p for p in (await session.execute(
            select(Product).where(Product.shop_id == args.shop_id))).scalars().all()}
        n = 0
        for vs in sessions:
            if not vs.final_json or not vs.audio_path:
                continue
            wav = Path(vs.audio_path).parent / "norm16k.wav"
            if not wav.exists():
                continue
            stem = f"real_{vs.id}"
            shutil.copy(wav, out_audio / f"{stem}.wav")
            items = [{
                "product_name": products[i["product_code"]].name if i["product_code"] in products else i["product_code"],
                "quantity": float(i["qty"]), "unit": i["unit"], "spoken_variants": [i["spoken_span"]] if i.get("spoken_span") else [],
            } for i in vs.final_json.get("items", [])]
            gold = {
                "language": (vs.sarvam_meta or {}).get("language_code"),
                "reference_transcript": vs.sarvam_transcript or "",
                "_note": "reference_transcript is the ASR output, not a human transcript; edit it by ear if you need WER.",
                "golden": {"intent": vs.final_json.get("type", "sale"), "items": items},
            }
            (out_gold / f"{stem}.json").write_text(json.dumps(gold, ensure_ascii=False, indent=2), encoding="utf-8")
            n += 1
        print(f"exported {n} sessions")


if __name__ == "__main__":
    asyncio.run(main())
