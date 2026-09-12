from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # database
    DATABASE_URL: str = "postgresql+asyncpg://vd:vd@localhost:5433/voicedukan"

    # Sarvam (primary STT)
    SARVAM_API_KEY: str = ""
    SARVAM_MODEL: str = "saaras:v4"
    SARVAM_MODE: str = "transcribe"
    SARVAM_TRANSLATE_VIEW: bool = False  # extra call doubles STT cost; enable only if the eval shows it helps
    SARVAM_LANGUAGE: str = "unknown"
    SARVAM_MAX_CONCURRENCY: int = 4
    # Boosting product names biased Sarvam badly: "battery" came back as "biscuit" because three
    # biscuit products were in the list. Measured 12 Sep 2026 by replaying the same audio.
    # off = send none (default) | aliases = send spoken aliases | names = old behaviour
    STT_KEYTERMS: str = "off"

    # Anthropic (extraction)
    ANTHROPIC_API_KEY: str = ""
    CLAUDE_MODEL: str = "claude-opus-5"
    CLAUDE_EFFORT: str = "medium"
    CLAUDE_MAX_TOKENS: int = 8000
    # Gemini (extraction, cost-first default)
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-3.1-flash-lite"
    GEMINI_THINKING_LEVEL: str = "minimal"  # minimal | low | medium | high

    # which extractor runs: "gemini" (cheap, default), "claude" (needs ANTHROPIC_API_KEY), or "mock" (zero-cost stub:
    # every item comes back unresolved and needs_review=True, for testing recording/STT/review/save).
    EXTRACTOR_MODE: str = "gemini"

    # Google shadow
    GOOGLE_SHADOW_ENABLED: bool = False
    GOOGLE_PROJECT_ID: str = ""
    GOOGLE_SHADOW_MODELS: str = "chirp_2:asia-southeast1"
    GOOGLE_SHADOW_TO_LLM: bool = False

    # app
    DATA_DIR: Path = Path("./data")
    FRONTEND_DIST: Path = Path("./static")  # built React app served by this service in production
    MAX_RECORDING_SECONDS: int = 90
    MAX_UPLOAD_BYTES: int = 15 * 1024 * 1024
    CORS_ORIGINS: str = "http://localhost:5173"
    LOG_LEVEL: str = "INFO"

    # VAD / chunking
    VAD_BACKEND: str = "auto"  # auto | silero (needs torch) | webrtc | energy
    VAD_THRESHOLD: float = 0.5
    VAD_MIN_SPEECH_MS: int = 200
    VAD_MIN_SILENCE_MS: int = 400
    VAD_SPEECH_PAD_MS: int = 200
    CHUNK_TARGET_SECONDS: float = 28.0
    CHUNK_HARD_SPLIT_SECONDS: float = 29.5
    MIN_SPEECH_SECONDS: float = 0.5

    # extraction guards
    REVIEW_CONFIDENCE_FLOOR: float = 0.75
    LOW_LANGUAGE_PROBABILITY: float = 0.4

    @field_validator("DATABASE_URL")
    @classmethod
    def _normalise_db_url(cls, v: str) -> str:
        """Accept a connection string pasted straight from Neon, Supabase or Render.

        Adds the async driver, turns `sslmode` into asyncpg's `ssl`, and drops parameters asyncpg
        rejects (Neon appends `channel_binding=require`, which would crash on the first connection).
        """
        url = v.strip()
        if url.startswith("postgres://"):
            url = "postgresql://" + url[len("postgres://"):]
        if url.startswith("postgresql://"):
            url = "postgresql+asyncpg://" + url[len("postgresql://"):]
        base, sep, query = url.partition("?")
        if not sep:
            return url
        ssl_value = None
        for part in query.split("&"):
            key, _, value = part.partition("=")
            if key in ("ssl", "sslmode") and value:
                ssl_value = "require" if value in ("require", "verify-ca", "verify-full", "true", "1") else value
        return f"{base}?ssl={ssl_value}" if ssl_value else base

    @field_validator("CLAUDE_EFFORT")
    @classmethod
    def _effort(cls, v: str) -> str:
        if v not in {"low", "medium", "high", "xhigh", "max"}:
            raise ValueError("CLAUDE_EFFORT must be low|medium|high|xhigh|max")
        return v

    @field_validator("STT_KEYTERMS")
    @classmethod
    def _keyterms(cls, v: str) -> str:
        if v not in {"off", "aliases", "names"}:
            raise ValueError("STT_KEYTERMS must be off|aliases|names")
        return v

    @field_validator("EXTRACTOR_MODE")
    @classmethod
    def _extractor_mode(cls, v: str) -> str:
        if v not in {"gemini", "claude", "mock"}:
            raise ValueError("EXTRACTOR_MODE must be gemini|claude|mock")
        return v

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def google_shadow_models(self) -> list[tuple[str, str]]:
        out: list[tuple[str, str]] = []
        for part in self.GOOGLE_SHADOW_MODELS.split(","):
            part = part.strip()
            if not part:
                continue
            model, _, region = part.partition(":")
            out.append((model, region or "asia-southeast1"))
        return out


@lru_cache
def get_settings() -> Settings:
    return Settings()
