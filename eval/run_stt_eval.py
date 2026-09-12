"""STT provider comparison on recorded clips.

Layout:
  eval/data/utterances/<clip>.wav          any format ffmpeg reads; normalised to 16 kHz mono first
  eval/data/golden/<clip>.json             {"reference_transcript": "...", "golden": {...}, "language": "od|hi|mixed"}
Usage (from repo root, with backend venv):
  backend/.venv/bin/python eval/run_stt_eval.py --catalog eval/data/catalog_medical.csv \
      --configs saaras:v4:transcribe saaras:v4:codemix saaras:v3:transcribe --hints --no-hints
Reports WER / CER (jiwer) and product-name recall per config, per language, to eval/results/stt_<ts>.{json,md}.
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import json
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "eval"))

import jiwer  # noqa: E402
from normalize_text import normalize  # noqa: E402

from app.audio import vad  # noqa: E402
from app.audio.normalize import normalize_to_wav16k  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.stt.sarvam import SarvamSaarasProvider  # noqa: E402

DATA = ROOT / "eval" / "data"
RESULTS = ROOT / "eval" / "results"


def load_catalog_terms(csv_path: Path) -> tuple[list[str], dict[str, list[str]]]:
    hints: list[str] = []
    names: dict[str, list[str]] = {}
    with open(csv_path, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            aliases = [a.strip() for a in (row.get("aliases") or "").split(";") if a.strip()]
            names[row["name"]] = [row["name"], row.get("brand") or "", *aliases]
            hints.append(row["name"])
    return hints[:50], names


def product_recall(transcript: str, golden_items: list[dict], names: dict[str, list[str]]) -> tuple[int, int]:
    """How many golden products have at least one name/alias present in the transcript."""
    t = normalize(transcript)
    hit = 0
    for it in golden_items:
        variants = names.get(it.get("product_name", ""), []) + it.get("spoken_variants", [])
        if any(normalize(v) and normalize(v) in t for v in variants):
            hit += 1
    return hit, len(golden_items)


async def transcribe_clip(provider, wav: Path, hints: list[str], work: Path, mode: str):
    norm = work / (wav.stem + ".16k.wav")
    if not norm.exists():
        await normalize_to_wav16k(wav, norm)
    audio = vad.read_wav(norm)
    segs = vad.detect_speech(audio)
    chunks = vad.write_chunks(audio, vad.plan_chunks(segs), work / wav.stem)
    t0 = time.perf_counter()
    results = await asyncio.gather(*[provider.transcribe_mode(c.path, mode, hints=hints) for c in chunks])
    text = " | ".join(r.transcript for r in results if r.ok)
    errs = [r.error for r in results if not r.ok]
    return text, int((time.perf_counter() - t0) * 1000), errs, results


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", required=True)
    ap.add_argument("--configs", nargs="+", default=["saaras:v4:transcribe"], help="model:mode e.g. saaras:v4:codemix")
    ap.add_argument("--hints", action="store_true", help="run with keyterm hints")
    ap.add_argument("--no-hints", action="store_true", help="run without hints")
    ap.add_argument("--google", action="store_true", help="also run Google shadow providers from settings")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    if not args.hints and not args.no_hints:
        args.hints = True

    s = get_settings()
    hints, names = load_catalog_terms(Path(args.catalog))
    clips = sorted(p for p in (DATA / "utterances").glob("*") if p.suffix.lower() in {".wav", ".mp3", ".m4a", ".webm", ".ogg"})
    if args.limit:
        clips = clips[: args.limit]
    if not clips:
        raise SystemExit("no clips in eval/data/utterances")
    work = RESULTS / "_work"
    work.mkdir(parents=True, exist_ok=True)

    runs: list[dict] = []
    variants: list[tuple[str, list[str]]] = []
    if args.hints:
        variants.append(("hints", hints))
    if args.no_hints:
        variants.append(("nohints", []))

    providers = []
    for cfg in args.configs:
        parts = cfg.split(":")
        model, mode = ":".join(parts[:2]), (parts[2] if len(parts) > 2 else "transcribe")
        providers.append((f"{model}:{mode}", SarvamSaarasProvider(s.SARVAM_API_KEY, model=model, mode=mode), mode))
    google_providers = []
    if args.google:
        from app.stt.google import GoogleChirpProvider
        for model, region in s.google_shadow_models:
            google_providers.append(GoogleChirpProvider(s.GOOGLE_PROJECT_ID, region=region, model=model))

    for clip in clips:
        gold_path = DATA / "golden" / (clip.stem + ".json")
        gold = json.loads(gold_path.read_text(encoding="utf-8")) if gold_path.exists() else {}
        ref = normalize(gold.get("reference_transcript", ""))
        for label, h in variants:
            for name, prov, mode in providers:
                text, ms, errs, _ = await transcribe_clip(prov, clip, h, work, mode)
                hyp = normalize(text)
                rec = {"clip": clip.name, "config": name, "hints": label, "language": gold.get("language", "?"),
                       "transcript": text, "latency_ms": ms, "errors": errs}
                if ref:
                    rec["wer"] = jiwer.wer(ref, hyp) if hyp else 1.0
                    rec["cer"] = jiwer.cer(ref, hyp) if hyp else 1.0
                if gold.get("golden", {}).get("items"):
                    hit, tot = product_recall(text, gold["golden"]["items"], names)
                    rec["product_hits"], rec["product_total"] = hit, tot
                runs.append(rec)
                print(f"{clip.name:30} {name:28} {label:8} wer={rec.get('wer', '-')!s:6.6} {ms:5}ms  {text[:60]}")
            for gp in google_providers:
                norm = work / (clip.stem + ".16k.wav")
                r = await gp.transcribe(norm, hints=h)
                hyp = normalize(r.transcript)
                rec = {"clip": clip.name, "config": gp.name, "hints": label, "language": gold.get("language", "?"),
                       "transcript": r.transcript, "latency_ms": r.latency_ms, "errors": [r.error] if r.error else []}
                if ref:
                    rec["wer"] = jiwer.wer(ref, hyp) if hyp else 1.0
                    rec["cer"] = jiwer.cer(ref, hyp) if hyp else 1.0
                if gold.get("golden", {}).get("items"):
                    hit, tot = product_recall(r.transcript, gold["golden"]["items"], names)
                    rec["product_hits"], rec["product_total"] = hit, tot
                runs.append(rec)
                print(f"{clip.name:30} {gp.name:28} {label:8} wer={rec.get('wer', '-')!s:6.6} {r.latency_ms:5}ms")

    # aggregate
    summary: dict[str, dict] = {}
    for r in runs:
        key = f"{r['config']} [{r['hints']}]"
        agg = summary.setdefault(key, {"n": 0, "wer": [], "cer": [], "hits": 0, "total": 0, "latency": [],
                                       "by_lang": {}})
        agg["n"] += 1
        if "wer" in r:
            agg["wer"].append(r["wer"])
            agg["cer"].append(r["cer"])
            bl = agg["by_lang"].setdefault(r["language"], [])
            bl.append(r["wer"])
        agg["hits"] += r.get("product_hits", 0)
        agg["total"] += r.get("product_total", 0)
        agg["latency"].append(r["latency_ms"])
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    lines = ["| config | clips | WER | CER | product recall | p50 latency | WER by language |", "|---|---|---|---|---|---|---|"]
    for k, a in summary.items():
        wer = sum(a["wer"]) / len(a["wer"]) if a["wer"] else float("nan")
        cer = sum(a["cer"]) / len(a["cer"]) if a["cer"] else float("nan")
        rec = f"{a['hits']}/{a['total']} ({a['hits'] / a['total']:.0%})" if a["total"] else "-"
        lat = sorted(a["latency"])[len(a["latency"]) // 2]
        bl = ", ".join(f"{lang}={sum(v) / len(v):.2f}" for lang, v in a["by_lang"].items())
        lines.append(f"| {k} | {a['n']} | {wer:.3f} | {cer:.3f} | {rec} | {lat} ms | {bl} |")
    md = "\n".join(lines)
    print("\n" + md)
    (RESULTS / f"stt_{ts}.json").write_text(json.dumps({"runs": runs, "summary": summary}, ensure_ascii=False,
                                                       indent=2, default=list), encoding="utf-8")
    (RESULTS / f"stt_{ts}.md").write_text(md + "\n", encoding="utf-8")
    print(f"\nwritten eval/results/stt_{ts}.md")


if __name__ == "__main__":
    asyncio.run(main())
