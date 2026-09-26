"""Structured output the reader stage must return. Separate from BillExtraction on purpose: reading a
photo and matching products against a catalog are different jobs with different failure modes, and
this schema must be free to change without invalidating the frozen extraction grammar."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class ScanRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lines: list[str]
    """One entry per item on the paper, as written, in reading order."""
    unclear_lines: list[str]
    """Entries from `lines` the reader is unsure about, so the review screen can flag them."""
    script: str
    """odia | devanagari | latin | mixed"""
    notes: str
    """Anything on the page that is not an item: a total, struck-out items, "no list in this photo"."""
