from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol


@dataclass
class STTWord:
    text: str
    start: float | None = None
    end: float | None = None
    confidence: float | None = None


@dataclass
class STTResult:
    provider: str
    model: str
    transcript: str
    language_code: str | None = None
    language_probability: float | None = None
    words: list[STTWord] = field(default_factory=list)
    latency_ms: int = 0
    raw: dict = field(default_factory=dict)
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.error is None


class STTProvider(Protocol):
    name: str

    async def transcribe(self, wav_path: Path, *, hints: list[str], language: str = "unknown") -> STTResult: ...
