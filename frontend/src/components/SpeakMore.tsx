import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { afterCue, startCue, stopCue } from '../lib/haptics';
import { ActiveRecording, RecorderError, recordingSupport, startRecording } from '../lib/recorder';
import { THEME } from '../lib/theme';
import { VoiceMode, VoiceSessionOut } from '../lib/types';
import { cx, fmtElapsed, uuid } from '../lib/utils';
import { MicIcon } from './Icons';

const MAX_MS = 60_000;
type Phase = 'idle' | 'starting' | 'recording' | 'reading' | 'error';

/**
 * Speaking more items into a bill that is already open.
 *
 * A customer remembers "and one Maggi" after the list is read out; the shopkeeper should not have to
 * switch to typing for that. This records, reads it the same way the first recording was read, and
 * hands the new lines back to be added under the ones already there. Nothing on the open bill changes.
 */
export default function SpeakMore({
  mode, onItems, onClose,
}: {
  mode: VoiceMode;
  onItems: (session: VoiceSessionOut) => void;
  onClose: () => void;
}) {
  const theme = THEME[mode];
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const rec = useRef<ActiveRecording | null>(null);
  const timer = useRef<number>(0);
  const support = recordingSupport();

  useEffect(() => () => {
    window.clearInterval(timer.current);
    rec.current?.cancel();
  }, []);

  const stop = async () => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    window.clearInterval(timer.current);
    stopCue();
    setPhase('reading');
    try {
      const result = await r.stop();
      if (result.durationMs < 700 || result.blob.size < 1000) {
        setPhase('idle');
        setError('That was too short. Tap the mic, then speak.');
        return;
      }
      const session = await api.voice.upload({
        audio: result.blob, clientSessionId: uuid(), durationMs: result.durationMs, mimeType: result.mimeType, mode,
      });
      const found = session.extraction?.items.length ?? 0;
      if (session.status === 'extracted' && found > 0) {
        onItems(session);
        return;
      }
      setPhase('error');
      setError(session.status === 'no_speech' ? 'Nothing was heard. Hold the phone closer and try again.'
        : found === 0 ? 'No items were heard in that. Try saying the item names.'
          : session.error || 'That could not be understood. Try again.');
    } catch (e) {
      setPhase('error');
      setError(e instanceof ApiError && e.status === 0 ? 'No internet. Type the items instead, or try again.'
        : (e as Error).message);
    }
  };

  const start = async () => {
    setError(null);
    setPhase('starting');
    startCue();
    await afterCue();
    try {
      const r = await startRecording({ onLevel: setLevel, onError: (e) => setError(e.message) });
      rec.current = r;
      setElapsed(0);
      setPhase('recording');
      timer.current = window.setInterval(() => {
        const ms = Date.now() - r.startedAt;
        setElapsed(ms);
        if (ms >= MAX_MS) void stop();
      }, 200);
    } catch (e) {
      setPhase('error');
      setError(e instanceof RecorderError ? e.message : (e as Error).message);
    }
  };

  const recording = phase === 'recording';
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={phase === 'reading' ? undefined : onClose}>
      <div className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-[max(env(safe-area-inset-bottom),20px)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-extrabold text-slate-900">Speak more items</h2>
          <button type="button" onClick={onClose} disabled={phase === 'reading'}
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-3xl leading-none text-slate-600 disabled:opacity-40"
                  aria-label="Close">×</button>
        </div>
        <p className="text-sm text-slate-500">They will be added below the items already on this bill.</p>

        {!support.ok ? (
          <p className="mt-4 rounded-2xl bg-red-50 p-4 font-semibold text-red-800">{support.error.message}</p>
        ) : (
          <div className="flex flex-col items-center py-6">
            <div className="relative flex h-[200px] w-[200px] items-center justify-center">
              {recording && (
                <span aria-hidden className={cx('absolute h-[150px] w-[150px] rounded-full opacity-25 transition-transform duration-100', theme.dot)}
                      style={{ transform: `scale(${1 + level * 0.6})` }} />
              )}
              <button
                type="button"
                onClick={() => (recording ? void stop() : phase === 'idle' || phase === 'error' ? void start() : undefined)}
                disabled={phase === 'starting' || phase === 'reading'}
                aria-label={recording ? 'Stop' : 'Start speaking'}
                className={cx('relative flex h-[150px] w-[150px] flex-col items-center justify-center rounded-full shadow-xl active:scale-95',
                  recording ? 'bg-red-600 text-white' : theme.gradient)}
              >
                {phase === 'reading' ? (
                  <span className="h-12 w-12 animate-spin rounded-full border-[5px] border-white/30 border-t-white" />
                ) : recording ? (
                  <span className="h-12 w-12 rounded-xl bg-white" />
                ) : (
                  <MicIcon className="h-16 w-16" />
                )}
                <span className="mt-1.5 text-base font-extrabold">
                  {phase === 'reading' ? 'Reading…' : recording ? 'Tap to stop' : phase === 'starting' ? 'Get ready…' : 'Tap & speak'}
                </span>
              </button>
            </div>
            <p className="mt-2 min-h-[28px] text-center text-base font-semibold text-slate-700">
              {recording ? <>● Listening… <span className="font-mono">{fmtElapsed(elapsed)}</span></>
                : phase === 'reading' ? 'Finding your items…' : 'Say just the names, or with quantity.'}
            </p>
            {error && <p className="mt-2 rounded-xl bg-red-50 px-4 py-2 text-center font-semibold text-red-800">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
