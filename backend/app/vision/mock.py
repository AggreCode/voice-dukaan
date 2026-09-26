"""Zero-cost reader for tests and for EXTRACTOR/OCR dry runs: it invents nothing and calls nothing.

It reports one line per photo with the filename, which is enough to prove the plumbing (upload ->
session row -> extractor -> review screen) without a Gemini key or a single paisa of spend. Matching
accuracy cannot be judged from it; that is what eval/run_ocr_eval.py is for.
"""
from __future__ import annotations

import time

from app.vision.base import ImageBlob, ReadResult


class MockImageReader:
    name = "mock:no-ocr"
    model = "mock:no-ocr"

    def __init__(self, lines: list[str] | None = None):
        self.lines = lines

    async def read(self, images: list[ImageBlob], *, hints: list[str]) -> ReadResult:
        t0 = time.perf_counter()
        lines = self.lines if self.lines is not None else [f"unread photo {i + 1}" for i in range(len(images))]
        return ReadResult(self.name, self.model, list(lines), script="latin",
                          notes="Produced by MockImageReader (OCR_MODE=mock) -- no model was called.",
                          latency_ms=int((time.perf_counter() - t0) * 1000), raw={"images": len(images)})
