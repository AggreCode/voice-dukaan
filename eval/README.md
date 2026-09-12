# Eval harness

Accuracy is measured, not assumed. Two scripts, run from the repo root with the backend venv:

1. `run_stt_eval.py` — compares STT configs (Sarvam saaras v4/v3, modes, with/without keyterm hints,
   optional Google Chirp shadow) on recorded clips. Reports WER/CER (after `normalize_text.py`) and
   **product-name recall**, which matters more than WER for this product.
2. `run_extraction_eval.py` — feeds transcripts (golden reference, or those recorded by script 1) through
   the Claude extractor and scores item-level precision/recall/F1, product-only recall, intent accuracy,
   review burden, confidence calibration, latency and token usage. Use `--effort` to sweep low/medium/high.

## Recording clips
- Record on a real phone in the shop, 20–90 s each, 2–3 speakers.
- Cover: Odia-only, Hindi-only, code-mixed, noisy background, number-heavy bills, products not in the catalog,
  purchases ("mal aila"), and a stock query.
- Name files `<speaker>_<lang>_<n>.wav` (any format ffmpeg reads). Put a golden JSON with the same stem in
  `data/golden/` (see the example file).

## Growing the set from real usage
`backend/scripts/export_sessions_to_eval.py` turns saved voice sessions plus the shopkeeper's corrections
into new golden cases, so the eval set grows with the product.
