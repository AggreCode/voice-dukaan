"""Sarvam AI Saaras speech-to-text adapter.

Uses httpx multipart directly (not the sarvamai SDK) because the SDK's transcribe() does not expose
the `keyterms` boosting field. Endpoint facts verified 2026-09-10:
  POST https://api.sarvam.ai/speech-to-text, header `api-subscription-key`,
  model saaras:v4, mode transcribe|translate|verbatim|translit|codemix,
  language_code od-IN|hi-IN|en-IN|...|unknown, <= 30 s audio per request,
  keyterms: JSON array of <= 50 strings (<= 64 chars) — saaras:v4 only.
"""
from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path

import httpx
import structlog

from app.stt.base import STTResult, STTWord

log = structlog.get_logger(__name__)

SARVAM_URL = "https://api.sarvam.ai/speech-to-text"
RETRY_STATUSES = {429, 500, 502, 503, 504}


class SarvamSaarasProvider:
    def __init__(
        self,
        api_key: str,
        *,
        model: str = "saaras:v4",
        mode: str = "transcribe",
        timeout_s: float = 30.0,
        max_retries: int = 3,
        client: httpx.AsyncClient | None = None,
    ):
        self.api_key = api_key
        self.model = model
        self.mode = mode
        self.max_retries = max_retries
        self.name = f"sarvam:{model}:{mode}"
        self._client = client or httpx.AsyncClient(timeout=timeout_s)

    async def aclose(self) -> None:
        await self._client.aclose()

    async def transcribe(self, wav_path: Path, *, hints: list[str], language: str = "unknown") -> STTResult:
        return await self._call(wav_path, hints=hints, language=language, mode=self.mode)

    async def translate(self, wav_path: Path, *, hints: list[str], language: str = "unknown") -> STTResult:
        """Indic speech -> English text, same endpoint with mode=translate (Saaras)."""
        return await self._call(wav_path, hints=hints, language=language, mode="translate")

    async def transcribe_mode(self, wav_path: Path, mode: str, *, hints: list[str], language: str = "unknown"):
        return await self._call(wav_path, hints=hints, language=language, mode=mode)

    async def _call(self, wav_path: Path, *, hints: list[str], language: str, mode: str) -> STTResult:
        data = {
            "model": self.model,
            "mode": mode,
            "language_code": language,
            "with_timestamps": "true",
        }
        terms = [h[:64] for h in hints if h][:50]
        if terms and self.model.startswith("saaras:v4"):
            data["keyterms"] = json.dumps(terms, ensure_ascii=False)
        audio = wav_path.read_bytes()
        t0 = time.perf_counter()
        last_err: str | None = None
        for attempt in range(self.max_retries):
            try:
                resp = await self._client.post(
                    SARVAM_URL,
                    headers={"api-subscription-key": self.api_key},
                    files={"file": (wav_path.name, audio, "audio/wav")},
                    data=data,
                )
            except httpx.HTTPError as e:
                last_err = f"network: {e}"
                await asyncio.sleep(0.5 * (2**attempt))
                continue
            if resp.status_code in RETRY_STATUSES:
                last_err = f"http {resp.status_code}: {resp.text[:200]}"
                retry_after = resp.headers.get("retry-after")
                await asyncio.sleep(float(retry_after) if retry_after else 0.5 * (2**attempt))
                continue
            if resp.status_code != 200:
                return STTResult(self.name, self.model, "", error=f"http {resp.status_code}: {resp.text[:300]}",
                                 latency_ms=int((time.perf_counter() - t0) * 1000))
            body = resp.json()
            return self._parse(body, mode, int((time.perf_counter() - t0) * 1000))
        return STTResult(self.name, self.model, "", error=last_err or "unknown",
                         latency_ms=int((time.perf_counter() - t0) * 1000))

    def _parse(self, body: dict, mode: str, latency_ms: int) -> STTResult:
        words: list[STTWord] = []
        ts = body.get("timestamps") or {}
        if ts and ts.get("words"):
            starts = ts.get("start_time_seconds") or []
            ends = ts.get("end_time_seconds") or []
            for i, w in enumerate(ts["words"]):
                words.append(STTWord(
                    text=w,
                    start=float(starts[i]) if i < len(starts) else None,
                    end=float(ends[i]) if i < len(ends) else None,
                ))
        return STTResult(
            provider=f"sarvam:{self.model}:{mode}",
            model=self.model,
            transcript=(body.get("transcript") or "").strip(),
            language_code=body.get("language_code"),
            language_probability=body.get("language_probability"),
            words=words,
            latency_ms=latency_ms,
            raw={k: v for k, v in body.items() if k != "timestamps"} | {"request_id": body.get("request_id")},
        )
