"""ffmpeg normalisation: any browser container (webm/opus, mp4/aac, ogg) -> 16 kHz mono PCM16 wav."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path

import soundfile as sf


class NormalizeError(RuntimeError):
    pass


@dataclass
class AudioInfo:
    path: Path
    duration_s: float
    sample_rate: int


FFMPEG_FILTERS = "highpass=f=80,dynaudnorm=f=150:g=15"


async def normalize_to_wav16k(src: Path, dst: Path, timeout_s: float = 20.0) -> AudioInfo:
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(src),
        "-vn", "-ac", "1", "-ar", "16000", "-sample_fmt", "s16",
        "-af", FFMPEG_FILTERS,
        str(dst),
    ]
    proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        _, err = await asyncio.wait_for(proc.communicate(), timeout=timeout_s)
    except asyncio.TimeoutError as e:
        proc.kill()
        raise NormalizeError("ffmpeg timed out") from e
    if proc.returncode != 0:
        raise NormalizeError(f"ffmpeg failed: {err.decode(errors='ignore')[:500]}")
    info = sf.info(str(dst))
    return AudioInfo(path=dst, duration_s=float(info.duration), sample_rate=int(info.samplerate))
