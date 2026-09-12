"""Silero VAD: trim silence and split a long recording into STT-sized chunks at natural pauses.

Sarvam's synchronous endpoint accepts <= 30 s per file, so chunks target 28 s with a hard split
at 29.5 s. Chunk boundaries always fall on silence (>= min_silence_ms) unless a single speech run
is longer than the hard limit, which is rare for dictated bills.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf
import structlog

log = structlog.get_logger(__name__)

SAMPLE_RATE = 16000

_model = None
_backend: str | None = None


def available_backend(preference: str = "auto") -> str:
    """silero is the most accurate but drags in torch (~800 MB); webrtc is tiny and ships in the
    512 MB production image; energy is the last resort so the pipeline never hard-fails."""
    global _backend
    if preference != "auto":
        return preference
    if _backend is None:
        try:
            import silero_vad  # noqa: F401
            import torch  # noqa: F401

            _backend = "silero"
        except ImportError:
            try:
                import webrtcvad  # noqa: F401

                _backend = "webrtc"
            except ImportError:
                _backend = "energy"
        log.info("vad_backend_selected", backend=_backend)
    return _backend


def load_model():
    global _model
    if _model is None:
        from silero_vad import load_silero_vad

        try:
            _model = load_silero_vad(onnx=True)
        except Exception:  # onnxruntime missing or incompatible -> torch fallback
            _model = load_silero_vad(onnx=False)
    return _model


@dataclass
class SpeechSegment:
    start: float  # seconds
    end: float


@dataclass
class Chunk:
    index: int
    start: float
    end: float
    path: Path | None = None

    @property
    def duration(self) -> float:
        return self.end - self.start


def read_wav(path: Path) -> np.ndarray:
    audio, sr = sf.read(str(path), dtype="float32", always_2d=False)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if sr != SAMPLE_RATE:
        raise ValueError(f"expected {SAMPLE_RATE} Hz wav, got {sr}")
    return audio


def detect_speech(
    audio: np.ndarray,
    *,
    threshold: float = 0.5,
    min_speech_ms: int = 200,
    min_silence_ms: int = 400,
    speech_pad_ms: int = 200,
    backend: str = "auto",
) -> list[SpeechSegment]:
    chosen = available_backend(backend)
    if chosen == "silero":
        return _detect_silero(audio, threshold=threshold, min_speech_ms=min_speech_ms,
                              min_silence_ms=min_silence_ms, speech_pad_ms=speech_pad_ms)
    flags, frame_s = (_flags_webrtc(audio) if chosen == "webrtc" else _flags_energy(audio, threshold))
    return _flags_to_segments(flags, frame_s, len(audio) / SAMPLE_RATE, min_speech_ms=min_speech_ms,
                              min_silence_ms=min_silence_ms, speech_pad_ms=speech_pad_ms)


def _detect_silero(audio, *, threshold, min_speech_ms, min_silence_ms, speech_pad_ms) -> list[SpeechSegment]:
    import torch
    from silero_vad import get_speech_timestamps

    model = load_model()
    tss = get_speech_timestamps(
        torch.from_numpy(audio),
        model,
        threshold=threshold,
        sampling_rate=SAMPLE_RATE,
        min_speech_duration_ms=min_speech_ms,
        min_silence_duration_ms=min_silence_ms,
        speech_pad_ms=speech_pad_ms,
        return_seconds=True,
    )
    return [SpeechSegment(float(t["start"]), float(t["end"])) for t in tss]


def _flags_webrtc(audio: np.ndarray, aggressiveness: int = 2, frame_ms: int = 30) -> tuple[list[bool], float]:
    import webrtcvad

    vad = webrtcvad.Vad(aggressiveness)
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    step = int(SAMPLE_RATE * frame_ms / 1000) * 2  # bytes per frame
    flags = [vad.is_speech(pcm[i:i + step], SAMPLE_RATE) for i in range(0, len(pcm) - step + 1, step)]
    return flags, frame_ms / 1000


def _flags_energy(audio: np.ndarray, threshold: float = 0.5, frame_ms: int = 30) -> tuple[list[bool], float]:
    """Loudness against the recording's own noise floor. Crude, but it never hard-fails."""
    step = int(SAMPLE_RATE * frame_ms / 1000)
    frames = [audio[i:i + step] for i in range(0, max(len(audio) - step + 1, 0), step)]
    if not frames:
        return [], frame_ms / 1000
    rms = np.array([float(np.sqrt(np.mean(f.astype("float64") ** 2))) for f in frames])
    floor = float(np.percentile(rms, 20))
    peak = float(rms.max())
    cutoff = max(floor * 3.0, floor + (peak - floor) * (0.3 + 0.4 * threshold), 1e-4)
    return [bool(v >= cutoff) for v in rms], frame_ms / 1000


def _flags_to_segments(flags: list[bool], frame_s: float, total_s: float, *, min_speech_ms: int,
                       min_silence_ms: int, speech_pad_ms: int) -> list[SpeechSegment]:
    """Merge per-frame speech flags into segments, bridging short gaps and dropping short blips."""
    runs: list[list[float]] = []
    start: float | None = None
    for i, flag in enumerate(flags):
        if flag and start is None:
            start = i * frame_s
        elif not flag and start is not None:
            runs.append([start, i * frame_s])
            start = None
    if start is not None:
        runs.append([start, len(flags) * frame_s])

    merged: list[list[float]] = []
    for run in runs:
        if merged and run[0] - merged[-1][1] < min_silence_ms / 1000:
            merged[-1][1] = run[1]
        else:
            merged.append(run)

    pad = speech_pad_ms / 1000
    out: list[SpeechSegment] = []
    for a, b in merged:
        if (b - a) * 1000 < min_speech_ms:
            continue
        out.append(SpeechSegment(max(0.0, a - pad), min(total_s, b + pad)))
    return out


def plan_chunks(
    segments: list[SpeechSegment],
    *,
    target_s: float = 28.0,
    hard_split_s: float = 29.5,
) -> list[Chunk]:
    """Greedy merge of consecutive speech segments into chunks whose span (first start -> last end)
    stays <= target_s. A single segment longer than hard_split_s is cut into hard_split_s pieces."""
    pieces: list[SpeechSegment] = []
    for seg in segments:
        s = seg.start
        while seg.end - s > hard_split_s:
            pieces.append(SpeechSegment(s, s + hard_split_s))
            s += hard_split_s
        pieces.append(SpeechSegment(s, seg.end))

    chunks: list[Chunk] = []
    cur_start: float | None = None
    cur_end: float | None = None
    for p in pieces:
        if cur_start is None:
            cur_start, cur_end = p.start, p.end
            continue
        if p.end - cur_start <= target_s:
            cur_end = p.end
        else:
            chunks.append(Chunk(len(chunks), cur_start, cur_end))
            cur_start, cur_end = p.start, p.end
    if cur_start is not None:
        chunks.append(Chunk(len(chunks), cur_start, cur_end))
    return chunks


def write_chunks(audio: np.ndarray, chunks: list[Chunk], out_dir: Path) -> list[Chunk]:
    out_dir.mkdir(parents=True, exist_ok=True)
    for c in chunks:
        a, b = int(c.start * SAMPLE_RATE), int(c.end * SAMPLE_RATE)
        c.path = out_dir / f"{c.index:02d}.wav"
        sf.write(str(c.path), audio[a:b], SAMPLE_RATE, subtype="PCM_16")
    return chunks


def write_trimmed(audio: np.ndarray, segments: list[SpeechSegment], path: Path, gap_ms: int = 150) -> float:
    """All speech concatenated with a short gap; used by the eval for whole-bill WER."""
    gap = np.zeros(int(SAMPLE_RATE * gap_ms / 1000), dtype="float32")
    parts: list[np.ndarray] = []
    for s in segments:
        parts.append(audio[int(s.start * SAMPLE_RATE): int(s.end * SAMPLE_RATE)])
        parts.append(gap)
    out = np.concatenate(parts) if parts else np.zeros(0, dtype="float32")
    sf.write(str(path), out, SAMPLE_RATE, subtype="PCM_16")
    return float(len(out) / SAMPLE_RATE)
