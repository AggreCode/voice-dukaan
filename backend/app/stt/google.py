"""Google Cloud Speech-to-Text v2 shadow adapter.

Odia (or-IN) is supported only by chirp_2 in asia-southeast1 (GA, word confidence, adaptation) and
chirp_3 in eu (preview). Sync Recognize accepts <= 60 s / 10 MB. Runs in shadow mode only: results
are logged for WER comparison and never block the user path. Requires the optional
`google-cloud-speech` extra and GOOGLE_APPLICATION_CREDENTIALS.
"""
from __future__ import annotations

import asyncio
import time
from pathlib import Path

import structlog

from app.stt.base import STTResult, STTWord

log = structlog.get_logger(__name__)


class GoogleChirpProvider:
    def __init__(self, project_id: str, *, region: str = "asia-southeast1", model: str = "chirp_2",
                 language_codes: list[str] | None = None, boost: float = 10.0):
        self.project_id = project_id
        self.region = region
        self.model = model
        self.language_codes = language_codes or ["or-IN"]
        self.boost = boost
        self.name = f"google:{model}@{region}"
        self._client = None

    def _get_client(self):
        if self._client is None:
            from google.api_core.client_options import ClientOptions
            from google.cloud.speech_v2 import SpeechClient

            endpoint = "speech.googleapis.com" if self.region == "global" else f"{self.region}-speech.googleapis.com"
            self._client = SpeechClient(client_options=ClientOptions(api_endpoint=endpoint))
        return self._client

    async def transcribe(self, wav_path: Path, *, hints: list[str], language: str = "unknown") -> STTResult:
        t0 = time.perf_counter()
        try:
            return await asyncio.to_thread(self._recognize, wav_path, hints, t0)
        except Exception as e:  # shadow: never raise
            log.warning("google_shadow_failed", provider=self.name, error=str(e))
            return STTResult(self.name, self.model, "", error=str(e)[:300],
                             latency_ms=int((time.perf_counter() - t0) * 1000))

    def _recognize(self, wav_path: Path, hints: list[str], t0: float) -> STTResult:
        from google.cloud.speech_v2.types import cloud_speech

        client = self._get_client()
        features = cloud_speech.RecognitionFeatures(enable_automatic_punctuation=True)
        if self.model == "chirp_2":
            features.enable_word_confidence = True
        config = cloud_speech.RecognitionConfig(
            auto_decoding_config=cloud_speech.AutoDetectDecodingConfig(),
            language_codes=self.language_codes,
            model=self.model,
            features=features,
        )
        phrases = [cloud_speech.PhraseSet.Phrase(value=h[:100], boost=self.boost) for h in hints if h][:1000]
        if phrases:
            config.adaptation = cloud_speech.SpeechAdaptation(
                phrase_sets=[cloud_speech.SpeechAdaptation.AdaptationPhraseSet(
                    inline_phrase_set=cloud_speech.PhraseSet(phrases=phrases))]
            )
        request = cloud_speech.RecognizeRequest(
            recognizer=f"projects/{self.project_id}/locations/{self.region}/recognizers/_",
            config=config,
            content=wav_path.read_bytes(),
        )
        response = client.recognize(request=request)
        texts: list[str] = []
        words: list[STTWord] = []
        for result in response.results:
            if not result.alternatives:
                continue
            alt = result.alternatives[0]
            texts.append(alt.transcript)
            for w in alt.words:
                words.append(STTWord(
                    text=w.word,
                    start=w.start_offset.total_seconds() if w.start_offset else None,
                    end=w.end_offset.total_seconds() if w.end_offset else None,
                    confidence=float(w.confidence) if w.confidence else None,
                ))
        return STTResult(
            provider=self.name, model=self.model, transcript=" ".join(t.strip() for t in texts).strip(),
            language_code=self.language_codes[0], words=words,
            latency_ms=int((time.perf_counter() - t0) * 1000),
            raw={"result_count": len(response.results)},
        )
