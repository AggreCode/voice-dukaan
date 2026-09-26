"""Orchestration for both capture kinds, ending in the same persisted session row.

  voice: raw upload -> normalize -> VAD chunks -> STT (primary + shadow in parallel)
         -> transcript assembly -> extraction -> guards
  image: photos in memory -> image reader -> lines joined with " | " -> extraction -> guards

Everything after the text exists is shared, which is the point: one review screen, one set of guards,
one corrections and alias-learning path.
"""
from __future__ import annotations

import asyncio
import time
import uuid
from datetime import date
from pathlib import Path

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.audio import vad
from app.audio.normalize import NormalizeError, normalize_to_wav16k
from app.config import get_settings
from app.extraction.base import ExtractionOutcome, Extractor, ShopContext
from app.extraction.postprocess import apply_guards
from app.models import Shop, VoiceSession
from app.services import catalog as catalog_svc
from app.services.fuzzy import fill_unresolved
from app.services.shadow import run_shadow
from app.stt.base import STTResult
from app.stt.sarvam import SarvamSaarasProvider
from app.vision.base import ImageBlob, ImageReader

log = structlog.get_logger(__name__)


class _Timer:
    def __init__(self) -> None:
        self.marks: dict[str, int] = {}
        self._t = time.perf_counter()
        self._t0 = self._t

    def mark(self, name: str) -> None:
        now = time.perf_counter()
        self.marks[name] = int((now - self._t) * 1000)
        self._t = now

    def total(self) -> int:
        return int((time.perf_counter() - self._t0) * 1000)


def _join(results: list[STTResult]) -> str:
    return " | ".join(r.transcript for r in results if r.ok and r.transcript)


def _dominant_language(results: list[STTResult]) -> tuple[str | None, float | None]:
    best: dict[str, float] = {}
    for r in results:
        if r.ok and r.language_code:
            best[r.language_code] = best.get(r.language_code, 0.0) + (r.language_probability or 0.5)
    if not best:
        return None, None
    lang = max(best, key=best.get)
    probs = [r.language_probability for r in results if r.ok and r.language_code == lang and r.language_probability]
    return lang, (sum(probs) / len(probs) if probs else None)


async def process_session(
    session: AsyncSession,
    vs: VoiceSession,
    *,
    primary: SarvamSaarasProvider,
    extractor: Extractor,
) -> VoiceSession:
    s = get_settings()
    timer = _Timer()
    base = Path(vs.audio_path).parent

    try:
        # 1. normalize
        wav = base / "norm16k.wav"
        info = await normalize_to_wav16k(Path(vs.audio_path), wav)
        timer.mark("normalize_ms")
        vs.duration_ms = int(info.duration_s * 1000)

        # 2. VAD + chunk plan
        audio = vad.read_wav(wav)
        segments = await asyncio.to_thread(
            vad.detect_speech, audio,
            threshold=s.VAD_THRESHOLD, min_speech_ms=s.VAD_MIN_SPEECH_MS,
            min_silence_ms=s.VAD_MIN_SILENCE_MS, speech_pad_ms=s.VAD_SPEECH_PAD_MS,
            backend=s.VAD_BACKEND,
        )
        speech_s = sum(seg.end - seg.start for seg in segments)
        vs.speech_ms = int(speech_s * 1000)
        chunks = vad.plan_chunks(segments, target_s=s.CHUNK_TARGET_SECONDS, hard_split_s=s.CHUNK_HARD_SPLIT_SECONDS)
        vad.write_chunks(audio, chunks, base / "chunks")
        vad.write_trimmed(audio, segments, base / "trimmed.wav")
        vs.chunks_json = [{"index": c.index, "start": c.start, "end": c.end} for c in chunks]
        timer.mark("vad_ms")
        if speech_s < s.MIN_SPEECH_SECONDS or not chunks:
            vs.status = "no_speech"
            vs.latencies = timer.marks | {"total_ms": timer.total()}
            return vs

        # 3. STT: primary per chunk (+ translate view) and shadow in parallel
        shop = await session.get(Shop, vs.shop_id)
        snap = await catalog_svc.load_snapshot(session, vs.shop_id)
        hints = snap.hints if s.STT_KEYTERMS != "off" else []
        sem = asyncio.Semaphore(s.SARVAM_MAX_CONCURRENCY)

        async def _primary(c: vad.Chunk) -> STTResult:
            async with sem:
                return await primary.transcribe(c.path, hints=hints, language=s.SARVAM_LANGUAGE)

        async def _translate(c: vad.Chunk) -> STTResult:
            async with sem:
                return await primary.translate(c.path, hints=hints, language=s.SARVAM_LANGUAGE)

        tasks = [asyncio.gather(*[_primary(c) for c in chunks])]
        if s.SARVAM_TRANSLATE_VIEW:
            tasks.append(asyncio.gather(*[_translate(c) for c in chunks]))
        shadow_task = asyncio.create_task(run_shadow(chunks, hints))
        results = await asyncio.gather(*tasks)
        primary_results: list[STTResult] = list(results[0])
        translate_results: list[STTResult] = list(results[1]) if s.SARVAM_TRANSLATE_VIEW else []
        timer.mark("stt_ms")

        errors = [r.error for r in primary_results if not r.ok]
        if len(errors) == len(primary_results):
            raise RuntimeError(f"primary STT failed on every chunk: {errors[0]}")

        transcript = _join(primary_results)
        lang, prob = _dominant_language(primary_results)
        vs.sarvam_transcript = transcript
        vs.sarvam_meta = {
            "provider": primary.name,
            "language_code": lang,
            "language_probability": prob,
            "chunks": [{
                "index": i, "transcript": r.transcript, "language_code": r.language_code,
                "language_probability": r.language_probability, "latency_ms": r.latency_ms,
                "request_id": r.raw.get("request_id"), "error": r.error,
            } for i, r in enumerate(primary_results)],
            "chunk_errors": errors,
        }
        secondary: dict[str, str] = {}
        if translate_results:
            vs.saaras_translation = _join(translate_results)
            if vs.saaras_translation:
                secondary["english"] = vs.saaras_translation

        # 4. extraction
        ctx = ShopContext(
            shop_type=shop.type if shop else "general",
            date_iso=date.today().isoformat(),
            detected_language=lang, language_probability=prob, stt_provider=primary.name,
            input_mode=vs.input_mode or "sale",
        )
        # shadow may finish before the LLM; include only when explicitly enabled
        if s.GOOGLE_SHADOW_TO_LLM:
            shadow_results = await shadow_task
            _store_shadow(vs, shadow_results)
            if vs.google_transcript:
                secondary["shadow"] = vs.google_transcript

        outcome: ExtractionOutcome = await extractor.extract(
            transcript=transcript, secondary_views=secondary, catalog=snap, shop_ctx=ctx)
        timer.mark("llm_ms")
        vs.llm_request_id = outcome.request_id
        vs.llm_model = outcome.model
        vs.token_usage = outcome.usage
        if outcome.output is None:
            vs.status = "needs_manual"
            vs.error = outcome.error
        else:
            guarded = apply_guards(outcome.output, transcript=transcript, catalog=snap,
                                   confidence_floor=s.REVIEW_CONFIDENCE_FLOOR)
            vs.llm_output_json = guarded.model_dump(mode="json")
            vs.status = "extracted"

        if not s.GOOGLE_SHADOW_TO_LLM:
            # don't hold the user response for the shadow; it writes back on its own
            shadow_task.add_done_callback(lambda t: _schedule_shadow_store(vs.id, t))
    except NormalizeError as e:
        vs.status = "failed"
        vs.error = f"normalize: {e}"
    except Exception as e:  # noqa: BLE001
        log.exception("pipeline_failed", session_id=str(vs.id))
        vs.status = "failed"
        vs.error = str(e)[:500]
    finally:
        vs.latencies = timer.marks | {"total_ms": timer.total()}
    return vs


async def process_image_session(
    session: AsyncSession,
    vs: VoiceSession,
    *,
    images: list[ImageBlob],
    reader: ImageReader,
    extractor: Extractor,
) -> VoiceSession:
    """Read a photographed list and extract it. The photos stay in memory: nothing is written to disk,
    so a customer's handwritten list leaves no copy behind once this returns."""
    s = get_settings()
    timer = _Timer()
    try:
        shop = await session.get(Shop, vs.shop_id)
        snap = await catalog_svc.load_snapshot(session, vs.shop_id)

        read = await reader.read(images, hints=snap.hints)
        timer.mark("ocr_ms")
        vs.ocr_meta = {
            "reader": read.provider, "model": read.model, "script": read.script, "notes": read.notes,
            "lines": read.lines, "unclear_lines": read.raw.get("unclear_lines") or [],
            "latency_ms": read.latency_ms, "request_id": read.raw.get("request_id"),
            "usage": read.raw.get("usage"), "error": read.error,
        }
        if not read.ok:
            vs.status, vs.error = "failed", f"read: {read.error}"
            return vs
        vs.ocr_text = read.text
        if not read.lines:
            # A photo with no list in it. Distinct from a failure: the shopkeeper just points the
            # camera again, and the reader's own words explain what it saw.
            vs.status = "no_text"
            vs.error = read.notes or "no list found in the photo"
            return vs

        ctx = ShopContext(
            shop_type=shop.type if shop else "general",
            date_iso=date.today().isoformat(),
            detected_language=read.script, language_probability=None, stt_provider=read.provider,
            input_mode=vs.input_mode or "sale", input_source="written", reader=read.provider,
            unclear_lines=list(read.raw.get("unclear_lines") or []),
        )
        outcome: ExtractionOutcome = await extractor.extract(
            transcript=read.text, secondary_views={}, catalog=snap, shop_ctx=ctx)
        timer.mark("llm_ms")
        vs.llm_request_id = outcome.request_id
        vs.llm_model = outcome.model
        vs.token_usage = outcome.usage
        if outcome.output is None:
            vs.status = "needs_manual"
            vs.error = outcome.error
        else:
            guarded = apply_guards(outcome.output, transcript=read.text, catalog=snap,
                                   confidence_floor=s.REVIEW_CONFIDENCE_FLOOR)
            if s.FUZZY_FILL:
                # Written input only for now. Speech would benefit too, but it needs its own eval run
                # before a phonetic fallback is allowed near the voice path's measured accuracy.
                guarded = fill_unresolved(guarded, snap, min_score=s.FUZZY_MIN_SCORE,
                                          min_gap=s.FUZZY_MIN_GAP)
            vs.llm_output_json = guarded.model_dump(mode="json")
            vs.status = "extracted"
    except Exception as e:  # noqa: BLE001
        log.exception("scan_pipeline_failed", session_id=str(vs.id))
        vs.status = "failed"
        vs.error = str(e)[:500]
    finally:
        vs.latencies = timer.marks | {"total_ms": timer.total()}
    return vs


def _store_shadow(vs: VoiceSession, shadow_results: dict[str, list[STTResult]]) -> None:
    if not shadow_results:
        return
    first = next(iter(shadow_results))
    vs.google_transcript = _join(shadow_results[first])
    vs.google_meta = {
        name: [{"index": i, "transcript": r.transcript, "latency_ms": r.latency_ms, "error": r.error,
                "words": [{"w": w.text, "c": w.confidence} for w in r.words]} for i, r in enumerate(results)]
        for name, results in shadow_results.items()
    }


def _schedule_shadow_store(session_id: uuid.UUID, task: asyncio.Task) -> None:
    try:
        results = task.result()
    except Exception as e:  # noqa: BLE001
        log.warning("shadow_task_failed", error=str(e))
        return
    if not results:
        return
    asyncio.create_task(_persist_shadow(session_id, results))


async def _persist_shadow(session_id: uuid.UUID, results: dict[str, list[STTResult]]) -> None:
    from app.db import get_sessionmaker

    async with get_sessionmaker()() as session:
        vs = await session.get(VoiceSession, session_id)
        if vs is None:
            return
        _store_shadow(vs, results)
        await session.commit()
