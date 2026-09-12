# voice-dukan

Voice-driven sales & inventory ledger for small shops and medicine stores in Odisha.
The shopkeeper taps record and dictates a whole bill in Odia, Hindi or English, mixed is fine:

> "ପାରାସିଟାମଲ ଦଶ ଗୋଟା, କ୍ରୋସିନ ଦୁଇଟା ପତା, ଓଆରଏସ ତିନି ପ୍ୟାକେଟ"

…and gets an editable review table with product, quantity, unit, price and confidence. Saving updates stock.

## How it works

```
phone (PWA, MediaRecorder)
  └─ POST /api/voice/sessions (audio ≤ 90 s)
       ├─ ffmpeg → 16 kHz mono wav
       ├─ Silero VAD → drop silence, split at pauses into ≤ 28 s chunks
       ├─ Sarvam saaras:v4 per chunk (keyterms = top product names)           ₹30 / hour of speech
       ├─ Gemini 3.1 Flash-Lite maps each spoken span → catalog product,        free tier, or ≈ ₹0.2 / bill
       │    qty, unit, confidence (structured JSON; catalog in the system prompt)
       ├─ deterministic guards: span must be verbatim, ids must exist,
       │    quantity and price need a spoken number, low confidence → review
       └─ review table → POST /api/transactions → stock ledger + corrections → learned aliases
```

The extractor is swappable with one setting: `EXTRACTOR_MODE=gemini` (default), `claude`, or `mock` (no LLM, zero cost).
Every raw view (transcript, LLM JSON, corrections) is stored so accuracy can be replayed and measured (`eval/`).

## Inventory

- **Register products** with a name, a local-language name shown under it (for example ପାରାସିଟାମଲ), pack and loose units,
  selling and cost price, and opening stock in either unit. Leave the local name empty and it is taken from an alias
  written in the shop's language.
- **Stock in by voice.** Switch the record screen to *Stock in* and read out what arrived; the review screen saves it as a
  purchase and stock goes up.
- **Stock in by typing.** The *Stock in* page takes several products at once with cost per unit and supplier name.
- **Correct stock.** Add or remove stock with a reason, or enter a physical count and the difference is recorded.
- **History.** Every product keeps a movement list: opening, sales, purchases, counts, damage, expiry and voids.
- **CSV import** columns: `name, brand, category, pack_unit, sub_unit, pack_size, sell_price, cost_price, aliases`
  (separated by `;`), `opening_stock` (loose units), `local_name`. Only `name` is required; re-importing updates rows.

API: `POST /api/products/{id}/stock` (`qty` + `unit`, or `delta_qty`), `POST /api/products/{id}/stock/count`,
`GET /api/products/{id}/ledger`, and voice uploads accept `mode=sale|stock_in`.

## Keys you need

| Key | Where | Cost |
|---|---|---|
| `SARVAM_API_KEY` | dashboard.sarvam.ai → API Keys | ₹100 free credit on signup |
| `GEMINI_API_KEY` | aistudio.google.com → Get API key | free tier, no card; free-tier data may be used by Google, so test with demo data |
| `ANTHROPIC_API_KEY` | console.anthropic.com | optional; only for `EXTRACTOR_MODE=claude`, $5 minimum top-up |

## Run it locally (tested path)

Prerequisites: Docker, Python 3.10+, Node 18+, ffmpeg.

```bash
cd voice-dukan
cp .env.example .env                      # then fill SARVAM_API_KEY and GEMINI_API_KEY

# 1. database
cd infra && docker compose up -d db && cd ..

# 2. backend (first time: create venv, CPU-only torch keeps the install small)
cd backend
python3 -m venv .venv
.venv/bin/pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
.venv/bin/pip install -e ".[dev]"
export DATABASE_URL=postgresql+asyncpg://vd:vd@localhost:5433/voicedukan
.venv/bin/alembic upgrade head
.venv/bin/python scripts/seed_catalog.py --shop-name "Maa Tarini Medical" --type medical --csv ../eval/data/catalog_medical.csv
set -a; . ../.env; set +a
DATABASE_URL=$DATABASE_URL DATA_DIR=../data .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000

# 3. frontend (new terminal)
cd frontend && npm install && npm run dev -- --host
```

Open http://localhost:5173 on the laptop, pick the shop, and record.

### From a phone
Browsers only allow the microphone on HTTPS. The quickest way is a tunnel:

```bash
cloudflared tunnel --url http://localhost:5173      # or: ngrok http 5173
```

Open the printed `https://…` link on the phone. The Vite dev server forwards `/api` to the backend.

### Health check
`GET /api/health` shows which keys are configured and which extractor and model are active.

## Repo layout
```
backend/app/audio        ffmpeg normalise, Silero VAD chunking
backend/app/stt          STTProvider protocol, Sarvam (primary), Google Chirp (optional shadow)
backend/app/extraction   prompt (cheat sheets + rules), Gemini / Claude / mock extractors, guards
backend/app/services     catalog snapshot, pipeline, ledger (stock + corrections + learned aliases)
backend/app/api          FastAPI routers: shops, products, voice sessions, transactions
backend/alembic          migrations
backend/scripts          seed_catalog.py, export_sessions_to_eval.py
frontend/                React + Vite + Tailwind PWA (Record, Review, Ledger, Products, Settings)
eval/                    STT + extraction eval harness, seed catalogs (medical, kirana)
infra/                   docker-compose, Dockerfiles, Caddyfile
```

## Tests
```bash
cd backend && DATABASE_URL=postgresql+asyncpg://vd:vd@localhost:5433/voicedukan .venv/bin/pytest -q
```

## Phase 2 (not built yet)
Once the LLM is cheap, speech-to-text is the largest cost. A self-hosted Indian-language speech model
(AI4Bharat IndicConformer) can replace Sarvam behind the same `STTProvider` interface when volume justifies a server.
