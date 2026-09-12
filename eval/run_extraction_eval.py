"""Extraction quality: transcript -> Claude -> items, scored against golden items.

Golden JSON per clip (eval/data/golden/<clip>.json):
  {"reference_transcript": "...", "language": "od",
   "golden": {"intent": "sale", "items": [{"product_name": "Paracetamol 500mg", "quantity": 10, "unit": "piece"}]}}
Products are matched by catalog name (the CSV `name` column) so goldens are stable across shops.

Usage: backend/.venv/bin/python eval/run_extraction_eval.py --catalog eval/data/catalog_medical.csv \
          [--effort low|medium|high] [--use-reference] [--stt-results eval/results/stt_<ts>.json --config "saaras:v4:transcribe [hints]"]
--use-reference feeds the golden reference transcript (isolates extraction quality from ASR errors);
--stt-results replays transcripts recorded by run_stt_eval.py (end-to-end quality).
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import json
import sys
import uuid
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.extraction.base import ShopContext  # noqa: E402
from app.extraction.claude import ClaudeExtractor  # noqa: E402
from app.extraction.postprocess import apply_guards  # noqa: E402
from app.models import Shop  # noqa: E402
from app.services.catalog import CatalogProduct, CatalogSnapshot, build_hints, render_catalog  # noqa: E402

DATA = ROOT / "eval" / "data"
RESULTS = ROOT / "eval" / "results"


def snapshot_from_csv(csv_path: Path, shop_type: str) -> CatalogSnapshot:
    products: list[CatalogProduct] = []
    with open(csv_path, encoding="utf-8-sig") as f:
        for i, row in enumerate(csv.DictReader(f), start=1):
            aliases = [a.strip() for a in (row.get("aliases") or "").split(";") if a.strip()]
            products.append(CatalogProduct(
                id=uuid.uuid4(), code=f"p{i:03d}", name=row["name"], brand=row.get("brand") or "",
                category=row.get("category") or "general", unit=row.get("unit") or "piece",
                sell_price=Decimal(row.get("sell_price") or "0"), stock_qty=Decimal(0), aliases=aliases))
    shop = Shop(id=uuid.UUID(int=1), name="eval", type=shop_type, catalog_version=1)
    return CatalogSnapshot(shop_id=shop.id, version=1, products={p.code: p for p in products},
                           rendered=render_catalog(shop, products), hints=build_hints(products))


def score(pred_items: list, golden_items: list[dict], snap: CatalogSnapshot) -> dict:
    name_by_code = {c: p.name for c, p in snap.products.items()}
    pred = [(name_by_code.get(i.product_id), float(i.quantity), i.unit.value) for i in pred_items]
    gold = [(g["product_name"], float(g["quantity"]), g["unit"]) for g in golden_items]
    used = [False] * len(gold)
    tp_full = tp_prod = 0
    for p in pred:
        for j, g in enumerate(gold):
            if used[j] or p[0] != g[0]:
                continue
            used[j] = True
            tp_prod += 1
            if abs(p[1] - g[1]) < 1e-6 and p[2] == g[2]:
                tp_full += 1
            break
    return {"pred": len(pred), "gold": len(gold), "tp_full": tp_full, "tp_product": tp_prod,
            "flagged": sum(1 for i in pred_items if i.needs_review)}


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", required=True)
    ap.add_argument("--shop-type", default="medical")
    ap.add_argument("--effort", default=None)
    ap.add_argument("--use-reference", action="store_true")
    ap.add_argument("--stt-results", default=None)
    ap.add_argument("--config", default=None, help="config key inside --stt-results, e.g. 'saaras:v4:transcribe [hints]'")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    snap = snapshot_from_csv(Path(args.catalog), args.shop_type)
    extractor = ClaudeExtractor(effort=args.effort)
    transcripts: dict[str, str] = {}
    if args.stt_results:
        data = json.loads(Path(args.stt_results).read_text(encoding="utf-8"))
        for r in data["runs"]:
            key = f"{r['config']} [{r['hints']}]"
            if args.config is None or key == args.config:
                transcripts[Path(r["clip"]).stem] = r["transcript"]
    goldens = sorted((DATA / "golden").glob("*.json"))
    if args.limit:
        goldens = goldens[: args.limit]
    rows: list[dict] = []
    tot = {"pred": 0, "gold": 0, "tp_full": 0, "tp_product": 0, "flagged": 0, "intent_ok": 0, "n": 0,
           "latency": [], "in_tok": 0, "out_tok": 0, "cache_read": 0}
    calib: dict[str, list[int]] = {}
    for gp in goldens:
        g = json.loads(gp.read_text(encoding="utf-8"))
        transcript = g.get("reference_transcript") if args.use_reference else transcripts.get(gp.stem)
        if not transcript:
            print(f"skip {gp.name}: no transcript")
            continue
        ctx = ShopContext(shop_type=args.shop_type, date_iso=date.today().isoformat(),
                          detected_language=g.get("language"), stt_provider="eval")
        out = await extractor.extract(transcript=transcript, secondary_views={}, catalog=snap, shop_ctx=ctx)
        if out.output is None:
            print(f"{gp.name}: extraction failed: {out.error}")
            continue
        bill = apply_guards(out.output, transcript=transcript, catalog=snap)
        sc = score(bill.items, g["golden"]["items"], snap)
        sc["intent_ok"] = int(bill.intent.value == g["golden"].get("intent", "sale"))
        for i in bill.items:
            name = snap.products[i.product_id].name if i.product_id else None
            ok = any(name == x["product_name"] for x in g["golden"]["items"])
            bucket = "0.9+" if i.confidence >= 0.9 else "0.75-0.9" if i.confidence >= 0.75 else "<0.75"
            calib.setdefault(bucket, []).append(int(ok))
        for k in ("pred", "gold", "tp_full", "tp_product", "flagged", "intent_ok"):
            tot[k] += sc[k]
        tot["n"] += 1
        tot["latency"].append(out.latency_ms)
        tot["in_tok"] += out.usage.get("input_tokens") or 0
        tot["out_tok"] += out.usage.get("output_tokens") or 0
        tot["cache_read"] += out.usage.get("cache_read_input_tokens") or 0
        rows.append({"clip": gp.stem, "transcript": transcript, "output": bill.model_dump(mode="json"), "score": sc,
                     "latency_ms": out.latency_ms, "usage": out.usage, "request_id": out.request_id})
        print(f"{gp.stem:30} items {sc['tp_full']}/{sc['gold']} exact, {sc['tp_product']} product-only, "
              f"{sc['pred']} predicted, {sc['flagged']} flagged, {out.latency_ms} ms")

    if not tot["n"]:
        raise SystemExit("nothing evaluated")
    p = tot["tp_full"] / tot["pred"] if tot["pred"] else 0
    r = tot["tp_full"] / tot["gold"] if tot["gold"] else 0
    f1 = 2 * p * r / (p + r) if p + r else 0
    pr = tot["tp_product"] / tot["gold"] if tot["gold"] else 0
    lat = sorted(tot["latency"])[len(tot["latency"]) // 2]
    md = [
        f"# Extraction eval {datetime.now():%Y-%m-%d %H:%M}  model={extractor.model} effort={extractor.effort}",
        f"- clips: {tot['n']}  source: {'reference transcript' if args.use_reference else args.stt_results}",
        f"- item precision {p:.3f} / recall {r:.3f} / F1 {f1:.3f} (product+qty+unit exact)",
        f"- product-only recall {pr:.3f}",
        f"- intent accuracy {tot['intent_ok'] / tot['n']:.3f}",
        f"- review burden {tot['flagged'] / tot['pred'] if tot['pred'] else 0:.0%} of items flagged",
        f"- p50 latency {lat} ms; tokens in={tot['in_tok']} out={tot['out_tok']} cache_read={tot['cache_read']}",
        "- calibration: " + ", ".join(f"{b}: {sum(v) / len(v):.0%} correct (n={len(v)})" for b, v in sorted(calib.items())),
    ]
    text = "\n".join(md)
    print("\n" + text)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    (RESULTS / f"extraction_{ts}.json").write_text(json.dumps({"summary": md, "rows": rows}, ensure_ascii=False, indent=2),
                                                   encoding="utf-8")
    (RESULTS / f"extraction_{ts}.md").write_text(text + "\n", encoding="utf-8")
    print(f"\nwritten eval/results/extraction_{ts}.md")


if __name__ == "__main__":
    asyncio.run(main())
