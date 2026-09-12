# One image = API + built web app in a single container. Deploy target: Render's free web service
# (or any Docker host - Koyeb, Fly.io, Railway - that reads $PORT). Hugging Face Spaces is NOT used:
# its free tier only covers static sites; a Docker Space with compute needs a paid PRO plan.
FROM node:20-alpine AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    DATA_DIR=/data FRONTEND_DIST=/app/static HOME=/app VAD_BACKEND=webrtc
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libsndfile1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# No torch in this image: voice detection uses webrtcvad so it fits a 512 MB free instance
COPY backend/pyproject.toml /app/pyproject.toml
COPY backend/app/__init__.py /app/app/__init__.py
RUN pip install --upgrade pip && pip install -e .
COPY backend/ /app/
COPY --from=web /web/dist /app/static
# Hugging Face Spaces runs as uid 1000 and expects a writable home
RUN mkdir -p /data /app/.cache && chmod -R 777 /data /app/.cache
EXPOSE 7860
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-7860} --proxy-headers --forwarded-allow-ips '*'"]
