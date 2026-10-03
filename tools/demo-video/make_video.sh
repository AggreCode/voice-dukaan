#!/usr/bin/env bash
# Render the Odia teaching video from the real app. See README.md.
#
#   ./make_video.sh                          captions only (no voice)
#   SARVAM_API_KEY=sk_... ./make_video.sh    with Odia narration
set -euo pipefail
cd "$(dirname "$0")"
HERE=$(pwd)
ROOT=$(cd ../.. && pwd)
PORT=${DEMO_PORT:-8765}
DB=$(mktemp -d /tmp/mo-dokan-demo-db.XXXXXX)
export DEMO_BASE="http://localhost:$PORT"
PY="$ROOT/backend/.venv/bin/python"

cleanup() {
  pkill -f "uvicorn app.main:app --port $PORT" 2>/dev/null || true
  pkill -f "$DB" 2>/dev/null || true
  rm -rf "$DB"
}
trap cleanup EXIT

echo "1/6 narration"
"$PY" tts.py

echo "2/6 tools"
[ -d node_modules/playwright ] || npm install --silent
npx playwright install chromium >/dev/null
"$PY" -c "import imageio_ffmpeg" 2>/dev/null || "$ROOT/backend/.venv/bin/pip" install -q imageio-ffmpeg

echo "3/6 app"
(cd "$ROOT/frontend" && npm run build >/dev/null)
mkdir -p work
(cd "$ROOT/backend" && EXTRACTOR_MODE=mock OCR_MODE=mock FRONTEND_DIST=../frontend/dist DATA_DIR="$HERE/work/data" \
   GEMINI_API_KEY=unused SARVAM_API_KEY=unused "$PY" scripts/devdb.py --data-dir "$DB" \
   uvicorn app.main:app --port "$PORT" > "$HERE/work/server.log" 2>&1) &
for _ in $(seq 1 60); do curl -sf "$DEMO_BASE/api/health" >/dev/null && break; sleep 1; done
curl -sf "$DEMO_BASE/api/health" >/dev/null || { echo "server did not start; see work/server.log"; exit 1; }

echo "4/6 demo shop"
(cd "$ROOT/backend" && DATABASE_URL="postgresql+asyncpg://postgres@/voicedukan" PGHOST="$DB" PGUSER=postgres \
   APP_SECRET=dev-only-secret "$PY" "$HERE/seed_demo.py")

echo "5/6 filming"
node record.mjs

echo "6/6 video"
"$PY" assemble.py
