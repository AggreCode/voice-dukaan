"""Turn the recorded frames (and the narration, if there is any) into a portrait MP4.

Frames arrive only when the screen changes, each with the moment it was drawn, so they become a
variable-rate sequence first and a steady 30 fps H.264 video second. Each narration clip is placed at
the instant its step started, which is why the voice lands on the screen it describes.
Output: out/mo-dokan-odia.mp4 (narrated) or out/mo-dokan-odia-captions.mp4 (silent), plus a cover
image for sharing.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

HERE = Path(__file__).parent
WORK = HERE / "work"
OUT = HERE / "out"


def ffmpeg() -> str:
    if os.environ.get("FFMPEG"):
        return os.environ["FFMPEG"]
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        found = shutil.which("ffmpeg")
        if not found:
            raise SystemExit("No ffmpeg: pip install imageio-ffmpeg, or set FFMPEG=/path/to/ffmpeg")
        return found


def run(*args: str) -> None:
    subprocess.run([ffmpeg(), "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def main() -> None:
    tl = json.loads((WORK / "timeline.json").read_text())
    timing = json.loads((WORK / "timing.json").read_text())
    frames = sorted(tl["frames"], key=lambda f: f["t"])
    t0, end = frames[0]["t"], tl["end"]

    listing = []
    for i, f in enumerate(frames):
        nxt = frames[i + 1]["t"] if i + 1 < len(frames) else end
        listing.append(f"file 'frames/{f['file']}'\nduration {max(0.001, nxt - f['t']):.4f}")
    listing.append(f"file 'frames/{frames[-1]['file']}'")  # the concat demuxer ignores the last duration otherwise
    (WORK / "frames.txt").write_text("\n".join(listing) + "\n")

    OUT.mkdir(exist_ok=True)
    silent = WORK / "video.mp4"
    run("-f", "concat", "-safe", "0", "-i", str(WORK / "frames.txt"),
        # Screen frames are full-range JPEGs. Video players and WhatsApp expect the TV range, and a
        # full-range file looks washed out on some phones, so convert explicitly and say so.
        "-vf", "fps=30,scale=1080:1920:flags=lanczos:in_range=pc:out_range=tv,format=yuv420p",
        "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
        "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-movflags", "+faststart", str(silent))

    clips = [(s, timing[s["id"]]["audio"]) for s in tl["steps"] if timing.get(s["id"], {}).get("audio")]
    if clips:
        target = OUT / "mo-dokan-odia.mp4"
        inputs, chains, labels = ["-i", str(silent)], [], []
        for k, (s, wav) in enumerate(clips, start=1):
            inputs += ["-i", wav]
            delay = max(0, int(round((s["t"] - t0) * 1000)) + 150)
            chains.append(f"[{k}:a]aresample=44100,adelay={delay}:all=1[a{k}]")
            labels.append(f"[a{k}]")
        graph = ";".join(chains) + f";{''.join(labels)}amix=inputs={len(labels)}:normalize=0:dropout_transition=0,alimiter=limit=0.95[aout]"
        run(*inputs, "-filter_complex", graph, "-map", "0:v", "-map", "[aout]",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", str(target))
    else:
        target = OUT / "mo-dokan-odia-captions.mp4"
        shutil.copyfile(silent, target)

    run("-ss", "1.2", "-i", str(target), "-frames:v", "1", "-q:v", "3", str(OUT / "cover.jpg"))
    secs = end - t0
    print(f"  {target.relative_to(HERE)}  ·  {int(secs // 60)}:{int(secs % 60):02d}  ·  "
          f"{target.stat().st_size / 1e6:.1f} MB  ·  1080x1920  ·  {'Odia voice' if clips else 'captions only'}")


if __name__ == "__main__":
    main()
