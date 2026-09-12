FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libsndfile1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# CPU-only torch (silero-vad dependency); the default wheel pulls multi-GB CUDA libraries
RUN pip install --upgrade pip && pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
COPY backend/pyproject.toml /app/pyproject.toml
COPY backend/app/__init__.py /app/app/__init__.py
RUN pip install -e ".[google]"
COPY backend/ /app/
COPY eval/data /eval/data
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
