"""Reading quality: photo -> reader -> lines -> extractor -> items, scored against golden items.

Two numbers matter, and they are deliberately reported separately, because the two stages fail for
different reasons and only one of them is fixed by changing the reader:

  line recall     did the reader get the words off the paper at all
  product match   did the extractor land each line on the right catalog product

Golden JSON per photo (eval/data/golden_ocr/<photo>.json):
  {"lines": ["chini 2 kg", "para 10"],
   "golden": {"items": [{"product_name": "Sugar", "quantity": 2, "unit": "kg"}]}}
`lines` is what a human reads off the photo; product names are catalog names, so goldens survive a
reseed. A photo may be several pages: name them <photo>__1.jpg, <photo>__2.jpg and they are read as one.

Collect 20-30 real photos before trusting any of this: Odia handwriting, Hindi, English, a printed
supplier bill, a creased page, a shadow across it, quantities in a right-hand column, words cut short,
and items the shop does not stock.

Usage: backend/.venv/bin/python eval/run_ocr_eval.py --catalog eval/data/catalog_kirana.csv \
         --shop-type kirana [--photos eval/data/photos] [--limit 5]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import mimetypes
import sys
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "eval"))

from run_extraction_eval import snapshot_from_csv  # noqa: E402

from app.extraction.base import ShopContext  # noqa: E402
from app.extraction.gemini import GeminiExtractor  # noqa: E402
from app.extraction.postprocess import apply_guards  # noqa: E402
from app.vision.base import ImageBlob  # noqa: E402
from app.vision.gemini import GeminiVisionReader  # noqa: E402

DATA = ROOT / "eval" / "data"
RESULTS = ROOT / "eval" / "results"
SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"}


def normalize(s: str) -> str:
    """Compare lines the way a shopkeeper would read them: case and spacing do not count."""
    return " ".join(s.lower().split())


def group_pages(photo_dir: Path) -> dict[str, list[Path]]:
    """<stem>__1.jpg and <stem>__2.jpg are pages of one list."""
    groups: dict[str, list[Path]] = defaultdict(list)
    for p in sorted(photo_dir.iterdir()):
        if p.suffix.lower() in SUFFIXES:
            groups[p.stem.split("__")[0]].append(p)
    return dict(groups)


def line_scores(pred: list[str], gold: list[str]) -> tuple[int, int]:
    """How many golden lines the reader found, matching each golden line at most once."""
    left = [normalize(g) for g in gold]
    found = 0
    for line in pred:
        n = normalize(line)
        for j, g in enumerate(left):
            if g and (n == g or g in n or n in g):
                left[j] = ""
                found += 1
                break
    return found, len(gold)


def item_scores(items, snap, gold_items: list[dict]) -> tuple[int, int, int]:
    name_by_code = {c: p.name for c, p in snap.products.items()}
    gold = [(g["product_name"], float(g["quantity"]), g.get("unit")) for g in gold_items]
    used = [False] * len(gold)
    tp_product = tp_full = 0
    for it in items:
        name = name_by_code.get(it.product_id)
        for j, g in enumerate(gold):
            if used[j] or name != g[0]:
                continue
            used[j] = True
            tp_product += 1
            if abs(float(it.quantity) - g[1]) < 1e-6 and (g[2] is None or it.unit == g[2]):
                tp_full += 1
            break
    return tp_product, tp_full, len(gold)


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", required=True)
    ap.add_argument("--shop-type", default="kirana")
    ap.add_argument("--photos", default=str(DATA / "photos"))
    ap.add_argument("--golden", default=str(DATA / "golden_ocr"))
    ap.add_argument("--model", default=None, help="reader model, default GEMINI_VISION_MODEL")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    photo_dir, golden_dir = Path(args.photos), Path(args.golden)
    if not photo_dir.is_dir():
        raise SystemExit(f"no photos in {photo_dir}. See the docstring for what to collect.")

    snap = snapshot_from_csv(Path(args.catalog), args.shop_type)
    reader = GeminiVisionReader(model=args.model)
    extractor = GeminiExtractor()

    groups = group_pages(photo_dir)
    if args.limit:
        groups = dict(list(groups.items())[: args.limit])
    if not groups:
        raise SystemExit(f"no images found in {photo_dir}")

    rows: list[dict] = []
    for stem, pages in groups.items():
        blobs = [ImageBlob(data=p.read_bytes(), mime_type=mimetypes.guess_type(p.name)[0] or "image/jpeg",
                           filename=p.name) for p in pages]
        read = await reader.read(blobs, hints=snap.hints)
        row: dict = {"photo": stem, "pages": len(pages), "ok": read.ok, "error": read.error,
                     "ocr_ms": read.latency_ms, "lines": read.lines, "script": read.script,
                     "unclear": read.raw.get("unclear_lines") or []}
        gold_path = golden_dir / f"{stem}.json"
        gold = json.loads(gold_path.read_text(encoding="utf-8")) if gold_path.exists() else {}
        if gold.get("lines"):
            found, total = line_scores(read.lines, gold["lines"])
            row |= {"lines_found": found, "lines_total": total}

        if read.ok and read.lines:
            ctx = ShopContext(shop_type=args.shop_type, date_iso=date.today().isoformat(),
                              stt_provider=read.provider, input_source="written", reader=read.provider,
                              unclear_lines=list(read.raw.get("unclear_lines") or []))
            outcome = await extractor.extract(transcript=read.text, secondary_views={}, catalog=snap, shop_ctx=ctx)
            row["llm_ms"] = outcome.latency_ms
            if outcome.output is None:
                row["extract_error"] = outcome.error
            else:
                guarded = apply_guards(outcome.output, transcript=read.text, catalog=snap)
                row["items"] = [{"product_id": i.product_id, "name": i.product_name_guess, "qty": i.quantity,
                                 "unit": i.unit, "conf": i.confidence, "review": i.needs_review,
                                 "reason": i.reason, "span": i.spoken_span} for i in guarded.items]
                row["flagged"] = sum(1 for i in guarded.items if i.needs_review)
                if gold.get("golden", {}).get("items"):
                    tp_p, tp_f, n = item_scores(guarded.items, snap, gold["golden"]["items"])
                    row |= {"tp_product": tp_p, "tp_full": tp_f, "gold_items": n, "pred_items": len(guarded.items)}
        rows.append(row)
        print(f"{stem}: {len(row.get('lines', []))} lines read"
              + (f", {row['lines_found']}/{row['lines_total']} golden lines" if "lines_total" in row else "")
              + (f", {row['tp_product']}/{row['gold_items']} products" if "gold_items" in row else "")
              + (f", ERROR {row['error']}" if row.get("error") else ""))

    def total(key: str) -> int:
        return sum(int(r.get(key, 0)) for r in rows)

    summary = {
        "photos": len(rows),
        "read_failures": sum(1 for r in rows if not r["ok"]),
        "line_recall": round(total("lines_found") / total("lines_total"), 3) if total("lines_total") else None,
        "product_recall": round(total("tp_product") / total("gold_items"), 3) if total("gold_items") else None,
        "exact_item_recall": round(total("tp_full") / total("gold_items"), 3) if total("gold_items") else None,
        "flagged_per_photo": round(total("flagged") / len(rows), 2) if rows else None,
        "median_ocr_ms": sorted(r.get("ocr_ms", 0) for r in rows)[len(rows) // 2] if rows else None,
        "reader": reader.name, "reader_model": reader.model, "extractor_model": extractor.model,
    }
    print("\n" + json.dumps(summary, indent=2))
    RESULTS.mkdir(parents=True, exist_ok=True)
    out = RESULTS / f"ocr_{datetime.now():%Y%m%d_%H%M%S}.json"
    out.write_text(json.dumps({"summary": summary, "rows": rows}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nwrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    asyncio.run(main())
