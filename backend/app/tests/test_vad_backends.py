"""The production image has no torch, so the lightweight detectors must find the same speech runs."""
import numpy as np
import pytest

from app.audio import vad

SR = vad.SAMPLE_RATE


def _clip() -> np.ndarray:
    """1.2 s speech, 1.0 s silence, 1.2 s speech, at 16 kHz."""
    rng = np.random.default_rng(0)

    def speech(seconds: float) -> np.ndarray:
        t = np.arange(int(SR * seconds)) / SR
        voiced = 0.35 * np.sin(2 * np.pi * 150 * t) + 0.2 * np.sin(2 * np.pi * 320 * t)
        return (voiced * (0.6 + 0.4 * np.sin(2 * np.pi * 4 * t)) + 0.05 * rng.standard_normal(len(t))).astype("float32")

    return np.concatenate([speech(1.2), np.zeros(int(SR * 1.0), dtype="float32"), speech(1.2)])


@pytest.mark.parametrize("backend", ["webrtc", "energy"])
def test_finds_two_segments_split_by_the_pause(backend):
    segments = vad.detect_speech(_clip(), backend=backend, min_silence_ms=400, min_speech_ms=200, speech_pad_ms=100)
    assert len(segments) == 2, segments
    assert segments[0].start < 0.3 and 1.0 < segments[0].end < 1.6
    assert 2.0 < segments[1].start < 2.5 and segments[1].end > 3.2
    assert sum(s.end - s.start for s in segments) > 2.0


@pytest.mark.parametrize("backend", ["webrtc", "energy"])
def test_silence_yields_no_speech(backend):
    assert vad.detect_speech(np.zeros(SR * 2, dtype="float32"), backend=backend) == []


def test_short_blips_are_dropped():
    flags = [False] * 10 + [True] * 2 + [False] * 10  # 60 ms of speech
    assert vad._flags_to_segments(flags, 0.03, 0.66, min_speech_ms=200, min_silence_ms=400, speech_pad_ms=0) == []


def test_backend_auto_prefers_what_is_installed():
    assert vad.available_backend("auto") in {"silero", "webrtc", "energy"}
    assert vad.available_backend("webrtc") == "webrtc"
