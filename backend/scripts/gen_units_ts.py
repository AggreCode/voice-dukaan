"""Regenerate frontend/src/lib/units.ts from app/services/units.py, the single source of unit truth.

    backend/.venv/bin/python backend/scripts/gen_units_ts.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.services import units  # noqa: E402

sizes = {k: [fam, float(v)] for k, (fam, v) in units._SIZES.items()}
syn = {k: list(v) for k, v in units._SYNONYMS.items()}
target = ROOT / "frontend" / "src" / "lib" / "units.ts"
text = target.read_text(encoding="utf-8")
head, _, rest = text.partition("const SIZES")
_, _, tail = rest.partition("\nconst LOOKUP")
target.write_text(
    head
    + f"const SIZES: Record<string, [string, number]> = {json.dumps(sizes, ensure_ascii=False)};\n"
    + f"const SYNONYMS: Record<string, string[]> = {json.dumps(syn, ensure_ascii=False)};\n"
    + "\nconst LOOKUP" + tail,
    encoding="utf-8",
)
print(f"wrote {target.relative_to(ROOT)}: {len(syn)} units")
