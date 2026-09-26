"""ImageReader: the photo-to-text stage, kept behind a protocol exactly like STTProvider.

A photographed list and a dictated bill reach the extractor the same way: as lines of text joined
with " | ". That means the frozen extraction schema, the prompt cache, the verbatim-span guard and
the whole review screen are shared, and a second reader (Sarvam Vision, a self-hosted model) can be
dropped in later without touching anything downstream.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

LINE_JOIN = " | "


@dataclass
class ImageBlob:
    """One uploaded photo, held in memory only. Photos are never written to disk (KEEP_IMAGES)."""

    data: bytes
    mime_type: str
    filename: str = "photo.jpg"


@dataclass
class ReadResult:
    provider: str
    model: str
    lines: list[str]
    columns: list[str] = field(default_factory=list)  # table headings in order, empty when not a table
    script: str | None = None  # odia | devanagari | latin | mixed, as reported by the reader
    notes: str = ""
    latency_ms: int = 0
    raw: dict = field(default_factory=dict)
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.error is None

    @property
    def text(self) -> str:
        """The lines as one transcript, using the same chunk marker the voice path uses, so the
        extractor's rule "an item never spans a | marker" keeps one written line to one item."""
        return LINE_JOIN.join(line.strip() for line in self.lines if line.strip())


class ImageReader(Protocol):
    name: str
    model: str

    async def read(self, images: list[ImageBlob], *, hints: list[str]) -> ReadResult: ...
