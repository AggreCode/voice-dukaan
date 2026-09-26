# Eval harness

Accuracy is measured, not assumed. Two scripts, run from the repo root with the backend venv:

1. `run_stt_eval.py` — compares STT configs (Sarvam saaras v4/v3, modes, with/without keyterm hints,
   optional Google Chirp shadow) on recorded clips. Reports WER/CER (after `normalize_text.py`) and
   **product-name recall**, which matters more than WER for this product.
2. `run_extraction_eval.py` — feeds transcripts (golden reference, or those recorded by script 1) through
   the Claude extractor and scores item-level precision/recall/F1, product-only recall, intent accuracy,
   review burden, confidence calibration, latency and token usage. Use `--effort` to sweep low/medium/high.

3. `run_ocr_eval.py` — feeds photographed lists through the reader and then the extractor, and reports
   **line recall** (did the reader get the words off the paper) separately from **product match rate**
   (did the extractor land each line on the right catalog product). Keeping them apart is the point: a
   bad number in the first is a reader problem, in the second a matching problem. Use it to decide
   whether Sarvam Vision should replace Gemini as the default reader.

## Photos for the OCR eval
- 20–30 real customer lists photographed at the counter, on the phone the shop actually uses.
- Cover: Odia handwriting, Hindi, English, a printed supplier bill, a creased or folded page, a shadow
  across the paper, quantities in a right-hand column, words cut short ("para", "bisc"), struck-out
  items, and items the shop does not stock.
- Put them in `data/photos/`. Several pages of one list are `<name>__1.jpg`, `<name>__2.jpg`.
- Golden JSON with the same stem in `data/golden_ocr/`, holding both the lines a human reads off the
  photo and the items they mean.

## Recording clips
- Record on a real phone in the shop, 20–90 s each, 2–3 speakers.
- Cover: Odia-only, Hindi-only, code-mixed, noisy background, number-heavy bills, products not in the catalog,
  purchases ("mal aila"), and a stock query.
- Name files `<speaker>_<lang>_<n>.wav` (any format ffmpeg reads). Put a golden JSON with the same stem in
  `data/golden/` (see the example file).

## Growing the set from real usage
`backend/scripts/export_sessions_to_eval.py` turns saved voice sessions plus the shopkeeper's corrections
into new golden cases, so the eval set grows with the product.
