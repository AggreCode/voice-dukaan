from __future__ import annotations

import logging
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.api import glossary, products, shops, transactions, voice
from app.config import get_settings
from app.db import get_engine


def _configure_logging(level: str) -> None:
    logging.basicConfig(level=getattr(logging, level.upper(), logging.INFO), format="%(message)s")
    structlog.configure(
        processors=[structlog.processors.add_log_level, structlog.processors.TimeStamper(fmt="iso"),
                    structlog.processors.KeyValueRenderer(key_order=["event"])],
        logger_factory=structlog.stdlib.LoggerFactory(),
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    _configure_logging(s.LOG_LEVEL)
    s.DATA_DIR.mkdir(parents=True, exist_ok=True)
    try:
        from app.audio.vad import available_backend, load_model

        if available_backend(s.VAD_BACKEND) == "silero":
            load_model()  # warm the torch model once; the light backends need no warmup
    except Exception as e:  # noqa: BLE001
        structlog.get_logger().warning("vad_model_load_failed", error=str(e))
    yield
    await get_engine().dispose()


app = FastAPI(title="voice-dukan", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=get_settings().cors_origins, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])
app.include_router(shops.router)
app.include_router(glossary.router)
app.include_router(products.router)
app.include_router(voice.router)
app.include_router(transactions.router)


def _mount_frontend(app: FastAPI) -> None:
    """Serve the built React app from the same service, so one container is the whole product.
    In local development Vite serves the UI instead and this directory simply does not exist."""
    dist = get_settings().FRONTEND_DIST
    if not (dist / "index.html").exists():
        return
    for sub in ("assets", "icons"):
        if (dist / sub).is_dir():
            app.mount(f"/{sub}", StaticFiles(directory=dist / sub), name=sub)

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        if path.startswith(("api/", "docs", "openapi.json", "redoc")):
            raise HTTPException(404, "not found")
        candidate = (dist / path).resolve()
        if path and candidate.is_file() and dist.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(dist / "index.html")  # client-side routes


@app.get("/api/health")
async def health():
    s = get_settings()
    db_ok = False
    try:
        async with get_engine().connect() as conn:
            await conn.execute(text("select 1"))
        db_ok = True
    except Exception:  # noqa: BLE001
        pass
    return {
        "ok": db_ok,
        "db": db_ok,
        "sarvam_configured": bool(s.SARVAM_API_KEY),
        "anthropic_configured": bool(s.ANTHROPIC_API_KEY),
        "gemini_configured": bool(s.GEMINI_API_KEY),
        "extractor_mode": s.EXTRACTOR_MODE,
        "extractor_model": {"gemini": s.GEMINI_MODEL, "claude": s.CLAUDE_MODEL, "mock": "none"}[s.EXTRACTOR_MODE],
        "google_shadow": s.GOOGLE_SHADOW_ENABLED,
        "claude_model": s.CLAUDE_MODEL,
        "sarvam_model": s.SARVAM_MODEL,
    }


_mount_frontend(app)
