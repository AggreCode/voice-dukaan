# voice-dukan

Voice-driven sales & inventory ledger for small shops and medicine stores in Odisha.
The shopkeeper taps record and dictates a whole bill in Odia, Hindi or English, mixed is fine:

> "ପାରାସିଟାମଲ ଦଶ ଗୋଟା, କ୍ରୋସିନ ଦୁଇଟା ପତା, ଓଆରଏସ ତିନି ପ୍ୟାକେଟ"

…and gets an editable review table with product, quantity, unit, price and confidence. Saving updates stock.

Or the customer hands over a paper list, the shopkeeper photographs it, and the same review table
comes back. Handwritten or printed, Odia, Hindi or English, and a word cut short ("ପାରା", "bisc") is
matched against the shop's own inventory.

The Scan tab asks one question first, **Selling** or **Buying**, and that is the only difference between
the two:

| | Selling to a customer | Buying from a wholesaler |
|---|---|---|
| Read from the photo | product, quantity, unit | product, quantity, unit **and rate** |
| Price used | the shop's own selling price | the rate on the bill |
| Why | the margin is the shopkeeper's, and a customer's list has no prices | the bill is the record of what was paid |

A priced table is read as a table: the column headings come back with the rows, so a trailing number is
known to be a rate and not a quantity. An `amount` or `total` column is never mistaken for a unit price.
The review screen totals `quantity × price per unit` over every line.

## How it works

Two ways in, one review screen. Both produce lines of text joined with `|`, and everything after that
is shared: the same catalog matching, the same guards, the same corrections and alias learning.

```
phone (PWA, camera)
  └─ POST /api/scan/sessions (1-3 photos, downscaled to 1600 px on the phone)
       ├─ Gemini 3.1 Flash-Lite reads the photo -> the lines exactly as written      ≈ ₹0.2 / list
       │    (no product matching here: reading faults and matching faults stay tellable apart)
       └─ the lines, joined with " | ", go into the same extractor as a dictated bill
            photos are read in memory and never written to disk (KEEP_IMAGES=false)

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
The photo reader is swappable the same way: `OCR_MODE=gemini` (default) or `mock`. A Sarvam Vision reader
belongs behind the same protocol once `eval/run_ocr_eval.py` has numbers on real shop photos.
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

- **Stock in by photo.** *Inventory → By photo*, or the Scan tab in stock-in mode: photograph the
  supplier bill or delivery challan and each line becomes stock coming in.

API: `POST /api/products/{id}/stock` (`qty` + `unit`, or `delta_qty`), `POST /api/products/{id}/stock/count`,
`GET /api/products/{id}/ledger`, and voice uploads accept `mode=sale|stock_in`.

## Accounts

A shop registers once: shop name, type, mobile number, WhatsApp number (the same by default),
GST number if it has one, address, then a username and a password. Sign in afterwards with the
username **or** the mobile number.

- Passwords are stored as salted **scrypt** hashes with their cost parameters attached, so the cost can
  be raised later without invalidating anybody's password. A wrong username costs the same time as a
  wrong password, so the endpoint cannot be used to discover who is registered.
- A session is a row in the database, reached by a random token in an `HttpOnly`, `SameSite=Lax`,
  `Secure` cookie. Only a peppered hash of the token is stored, so a leaked database yields no working
  sessions. Signing out revokes the row, and changing a password revokes every other device.
- Requests that change data must also carry an `X-VD-App` header, which a cross-site form cannot set.
- The cookie is strictly necessary to sign in, so it needs no consent banner under the GDPR or India's
  DPDP rules. What is offered instead is the choice that actually matters, "keep me signed in on this
  phone", which is the difference between a 30-day cookie and one that dies with the browser.

There is no way to reach a shop's data without signing in. `GET /api/shops`, which used to list every
shop on the service, and the `X-Shop-Id` header, which believed whatever shop id it was handed, are
both gone.

**Shops created before logins existed** have no username. Give them one:

```bash
cd backend
.venv/bin/python scripts/set_password.py --shop "Maa Tarini Medical" --username maa.tarini
```

## Keys you need

| Key | Where | Cost |
|---|---|---|
| `APP_SECRET` | generate: `python3 -c "import secrets;print(secrets.token_urlsafe(32))"` | free; signs login tokens |
| `SARVAM_API_KEY` | dashboard.sarvam.ai → API Keys | ₹100 free credit on signup |
| `GEMINI_API_KEY` | aistudio.google.com → Get API key | free tier, no card; used for both extraction and reading photos. Free-tier data may be used by Google, so test with demo data |
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
`GET /api/health` shows which keys are configured, which extractor, reader and models are active, and
whether `APP_SECRET` is set (`app_secret_set`). If it is false in production, logins break the next time
an AI key changes.

## Deploy

`DEPLOY.md` walks through free hosting: one Render web service (API and web app in a single container)
with a Neon Postgres. Both are free with no credit card. `render.yaml` is the blueprint Render reads.

Voice detection has three backends, chosen automatically: `silero` (best, needs torch, used locally),
`webrtc` (tiny, used in the production image), and `energy` (fallback). Force one with `VAD_BACKEND`.

## Repo layout
```
backend/app/audio        ffmpeg normalise, Silero VAD chunking
backend/app/stt          STTProvider protocol, Sarvam (primary), Google Chirp (optional shadow)
backend/app/vision       ImageReader protocol, reader prompt, Gemini reader, mock reader
backend/app/extraction   prompt (cheat sheets + rules), Gemini / Claude / mock extractors, guards
backend/app/services     catalog snapshot, pipeline, ledger (stock + corrections + learned aliases)
backend/app/api          FastAPI routers: shops, products, voice sessions, transactions
backend/alembic          migrations
backend/scripts          seed_catalog.py, export_sessions_to_eval.py
frontend/                React + Vite + Tailwind PWA (Speak, Scan, Review, Ledger, Inventory, Settings)
eval/                    STT + OCR + extraction eval harness, seed catalogs (medical, kirana)
infra/                   docker-compose, Dockerfiles, Caddyfile
```

## Tests
```bash
cd backend && DATABASE_URL=postgresql+asyncpg://vd:vd@localhost:5433/voicedukan .venv/bin/pytest -q
```

## Phase 2 (not built yet)
Once the LLM is cheap, speech-to-text is the largest cost. A self-hosted Indian-language speech model
(AI4Bharat IndicConformer) can replace Sarvam behind the same `STTProvider` interface when volume justifies a server.
