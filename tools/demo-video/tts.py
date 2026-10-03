"""Odia narration for the demo video, one clip per step, from Sarvam's Bulbul text-to-speech.

    SARVAM_API_KEY=... python tts.py            # writes work/audio/<step>.wav and work/timing.json
    python tts.py                               # no key: estimated timings only, so a captioned video still renders

Bulbul v3 speaks Odia (od-IN) and copes with the English button names mixed in ("Save", "Continue").
Each step's clip length becomes that step's minimum time on screen, so the recorder holds every
screen exactly as long as its sentence takes to say.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
import wave
from pathlib import Path

HERE = Path(__file__).parent
WORK = HERE / "work"
AUDIO = WORK / "audio"
URL = "https://api.sarvam.ai/text-to-speech"
RATE = 22050


def estimate(text: str) -> float:
    # Measured Odia speech at a gentle pace runs at roughly 11 characters a second.
    return round(len(text) / 11 + 0.6, 2)


def synth(text: str, key: str, voice: str, pace: float) -> bytes:
    body = {"text": text, "speaker": voice, "model": "bulbul:v3", "pace": pace, "speech_sample_rate": RATE}
    # The language field has been named both ways in Sarvam's docs; try the current name, then the older.
    for lang_field in ("target_language_code", "language_code"):
        req = urllib.request.Request(
            URL, data=json.dumps(body | {lang_field: "od-IN"}).encode(),
            headers={"api-subscription-key": key, "Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return base64.b64decode(json.loads(r.read())["audios"][0])
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")[:300]
            if e.code in (400, 422) and lang_field == "target_language_code":
                continue
            raise SystemExit(f"Sarvam TTS failed ({e.code}): {detail}") from e
    raise SystemExit("Sarvam TTS rejected both language field names")


def fingerprint(text: str, voice: str, pace: float) -> str:
    """What a clip was made from. Same line, voice and speed: the clip on disk is still right."""
    return hashlib.sha256(f"{voice}|{pace}|{text}".encode()).hexdigest()[:16]


def wav_seconds(data: bytes) -> float:
    with wave.open(io.BytesIO(data)) as w:
        return w.getnframes() / w.getframerate()


def main() -> None:
    script = json.loads((HERE / "narration.or.json").read_text(encoding="utf-8"))
    key = os.environ.get("SARVAM_API_KEY", "").strip()
    voice, pace = script.get("voice", "ritu"), float(script.get("pace", 1.0))
    WORK.mkdir(exist_ok=True)
    AUDIO.mkdir(parents=True, exist_ok=True)
    # Re-rendering after an app change should not pay for, or wait on, lines that did not change.
    cache_file = AUDIO / "cache.json"
    cache = json.loads(cache_file.read_text()) if cache_file.exists() else {}
    timing: dict[str, dict] = {}
    reused = voiced = missing = 0
    for step in script["steps"]:
        out = AUDIO / f"{step['id']}.wav"
        fp = fingerprint(step["or"], voice, pace)
        if out.exists() and cache.get(step["id"]) == fp:
            reused += 1
        elif key:
            out.write_bytes(synth(step["or"], key, voice, pace))
            cache[step["id"]] = fp
            voiced += 1
            print(f"  voiced  {step['id']}")
            time.sleep(0.2)
        else:
            timing[step["id"]] = {"seconds": estimate(step["or"]), "audio": None}
            missing += 1
            continue
        timing[step["id"]] = {"seconds": round(wav_seconds(out.read_bytes()), 2), "audio": str(out)}
    cache_file.write_text(json.dumps(cache, indent=1))
    print(f"  voice: {reused} reused, {voiced} newly voiced, {missing} without a voice"
          + ("" if not missing else " (set SARVAM_API_KEY to voice them)"), file=sys.stderr if missing else sys.stdout)
    (WORK / "timing.json").write_text(json.dumps(timing, indent=2), encoding="utf-8")
    total = sum(t["seconds"] for t in timing.values())
    print(f"  narration: {total:.0f}s across {len(timing)} steps")


if __name__ == "__main__":
    main()
