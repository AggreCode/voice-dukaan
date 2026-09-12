from app.audio.vad import SpeechSegment, plan_chunks


def test_merges_short_segments_under_target():
    segs = [SpeechSegment(0, 5), SpeechSegment(6, 12), SpeechSegment(13, 20)]
    chunks = plan_chunks(segs, target_s=28, hard_split_s=29.5)
    assert len(chunks) == 1
    assert (chunks[0].start, chunks[0].end) == (0, 20)


def test_splits_at_silence_when_exceeding_target():
    segs = [SpeechSegment(0, 15), SpeechSegment(16, 27), SpeechSegment(28, 40), SpeechSegment(41, 55)]
    chunks = plan_chunks(segs, target_s=28, hard_split_s=29.5)
    assert [(c.start, c.end) for c in chunks] == [(0, 27), (28, 55)]
    assert all(c.duration <= 28 for c in chunks)


def test_hard_splits_single_long_segment():
    chunks = plan_chunks([SpeechSegment(0, 70)], target_s=28, hard_split_s=29.5)
    assert all(c.duration <= 29.5 for c in chunks)
    assert chunks[-1].end == 70
    assert len(chunks) == 3


def test_empty():
    assert plan_chunks([]) == []
