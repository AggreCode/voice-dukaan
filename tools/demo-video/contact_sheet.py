"""One picture of the finished video: a frame from late in each chosen step, tiled, to check by eye.

    python contact_sheet.py                      # a default set of steps
    python contact_sheet.py save_sale stock      # just these

Every bug this tool has caught so far was visible here and in no log: a number typed into the wrong
box, a microphone stuck on "Get ready", a confirmation scrolled off the top of the screen.
Writes work/check/sheet.png.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from assemble import ffmpeg

HERE = Path(__file__).parent
WORK = HERE / "work"
DEFAULT = ["register_red", "voice_say", "fill_yellow", "continue", "save_sale", "photo", "sell_price",
           "which_one", "save_buy", "stock_sheet", "report", "outro_go"]


def main(pick: list[str]) -> None:
    tl = json.loads((WORK / "timeline.json").read_text())
    video = next((HERE / "out").glob("mo-dokan-odia*.mp4"))
    t0 = min(f["t"] for f in tl["frames"])
    out = WORK / "check"
    out.mkdir(exist_ok=True)
    for old in out.glob("*.jpg"):
        old.unlink()
    for s in tl["steps"]:
        if s["id"] in pick:
            at = s["t"] - t0 + s["seconds"] * 0.9
            subprocess.run([ffmpeg(), "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{at:.2f}", "-i", str(video),
                            "-frames:v", "1", "-vf", "scale=360:-1", str(out / f"{pick.index(s['id']):02d}.jpg")], check=True)
    cols = 4
    rows = -(-len(pick) // cols)
    subprocess.run([ffmpeg(), "-hide_banner", "-loglevel", "error", "-y", "-pattern_type", "glob", "-i", str(out / "*.jpg"),
                    "-vf", f"tile={cols}x{rows}:padding=6:color=white", "-frames:v", "1", str(out / "sheet.png")], check=True)
    print(f"  {out / 'sheet.png'}")


if __name__ == "__main__":
    main(sys.argv[1:] or DEFAULT)
