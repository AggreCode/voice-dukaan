import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import TopBar from '../components/TopBar';
import { MicIcon } from '../components/Icons';
import { useToast } from '../components/Toast';
import { registerCapture } from '../lib/captureDraft';
import { afterCue, startCue, stopCue } from '../lib/haptics';
import { useLocal } from '../lib/labels';
import { ActiveRecording, RecorderError, recordingSupport, startRecording } from '../lib/recorder';
import { SIDE, THEME } from '../lib/theme';
import { VoiceMode } from '../lib/types';
import { enqueueAndUpload } from '../lib/uploadQueue';
import { cx, fmtElapsed, uuid } from '../lib/utils';

const WARN_MS = 75_000;
const MAX_MS = 90_000;

type Phase = 'idle' | 'starting' | 'recording' | 'uploading' | 'error';
const STAGES = ['Sending…', 'Listening to it…', 'Finding your items…'];
const STAGE_AT = [0, 2500, 7000];

const COPY: Record<VoiceMode, { headline: string; example: string }> = {
  sale: { headline: 'Speak the bill', example: '“Basmati do kilo, marigold teen packet, tiger biscuit”' },
  stock_in: { headline: 'Speak what arrived', example: '“Basmati pachas kilo, cost sattar, bechne ka assi”' },
};

/**
 * Speaking a bill, with the confirmation people already know from Google's microphone: a buzz and a
 * rising chime when it starts listening, a falling one when it stops, and rings that grow with the
 * voice so the shopkeeper can SEE it hearing them. The chime finishes before the microphone opens so
 * it is never recorded as part of the bill.
 */
export default function Record({ mode }: { mode: VoiceMode }) {
  const nav = useNavigate();
  const toast = useToast();
  const word = useLocal();
  const theme = THEME[mode];
  const side = SIDE[mode];
  const copy = COPY[mode];

  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState(0);

  const recRef = useRef<ActiveRecording | null>(null);
  const timerRef = useRef<number>(0);
  const stoppingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);

  const support = recordingSupport();

  const clearTimer = () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = 0;
  };

  const reset = () => {
    setPhase('idle');
    setElapsed(0);
    setLevel(0);
  };

  const stop = useCallback(async () => {
    const rec = recRef.current;
    if (!rec || stoppingRef.current) return;
    stoppingRef.current = true;
    clearTimer();
    stopCue();
    setPhase('uploading');
    setStage(0);
    let result;
    try {
      result = await rec.stop();
    } catch (e) {
      setError((e as Error).message);
      setPhase('error');
      recRef.current = null;
      stoppingRef.current = false;
      return;
    }
    recRef.current = null;
    stoppingRef.current = false;

    if (result.durationMs < 700 || result.blob.size < 1000) {
      reset();
      toast.show('That was too short. Tap the mic, then speak.');
      return;
    }

    try {
      const session = await enqueueAndUpload({
        clientSessionId: uuid(),
        blob: result.blob,
        mimeType: result.mimeType,
        durationMs: result.durationMs,
        mode,
      });
      registerCapture(session, mode, 'voice');
      // Only take them to the bill if they are still waiting for it. Otherwise it is on Home.
      if (mounted.current) nav(`/review/${session.session_id}`);
      else toast.success('Your spoken bill is ready on Home.');
    } catch (e) {
      if (mounted.current) reset();
      toast.error(`No internet? It is saved and will send by itself. (${e instanceof Error ? e.message : 'upload failed'})`);
    }
  }, [mode, nav, toast]);

  const start = useCallback(async () => {
    setError(null);
    setPhase('starting');
    startCue();
    await afterCue();
    try {
      const rec = await startRecording({ onLevel: (l) => setLevel(l), onError: (e) => setError(e.message) });
      recRef.current = rec;
      setElapsed(0);
      setPhase('recording');
      timerRef.current = window.setInterval(() => {
        const ms = Date.now() - rec.startedAt;
        setElapsed(ms);
        if (ms >= MAX_MS) void stop();
      }, 200);
    } catch (e) {
      setError(e instanceof RecorderError ? e.message : (e as Error).message);
      setPhase('error');
    }
  }, [stop]);

  useEffect(() => {
    if (phase !== 'uploading') return;
    const t0 = Date.now();
    const id = window.setInterval(() => {
      const ms = Date.now() - t0;
      setStage(STAGE_AT.reduce((s, at, i) => (ms >= at ? i : s), 0));
    }, 300);
    return () => window.clearInterval(id);
  }, [phase]);

  useEffect(() => () => {
    clearTimer();
    recRef.current?.cancel();
  }, []);

  const onTap = () => {
    if (phase === 'idle' || phase === 'error') void start();
    else if (phase === 'recording') void stop();
  };

  const recording = phase === 'recording';
  const warn = elapsed >= WARN_MS;
  const bars = [0.55, 0.85, 1, 0.85, 0.55];

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col px-4 pb-24">
      <TopBar title={copy.headline} subtitle={word('speak')} back={`/${side}`} mode={mode} />

      {!support.ok && (
        <div className="rounded-2xl bg-red-50 p-4 font-semibold text-red-800">{support.error.message}</div>
      )}

      <div className="flex flex-1 flex-col items-center justify-center py-4">
        <div className="relative flex h-[300px] w-[300px] items-center justify-center">
          {/* three rings that breathe with the voice, Google style */}
          {[1.0, 0.75, 0.5].map((weight, i) => (
            <span
              key={i}
              aria-hidden
              className={cx(
                'absolute inset-0 m-auto rounded-full transition-transform duration-100',
                recording ? (warn ? 'bg-amber-400' : theme.dot) : 'bg-transparent',
              )}
              style={{
                width: 200,
                height: 200,
                opacity: recording ? 0.12 + i * 0.06 : 0,
                transform: `scale(${recording ? 1 + level * weight * 0.55 + i * 0.08 : 1})`,
              }}
            />
          ))}
          {recording && <span aria-hidden className={cx('absolute h-[220px] w-[220px] animate-ping rounded-full opacity-20', theme.dot)} />}

          <button
            type="button"
            onClick={onTap}
            disabled={!support.ok || phase === 'starting' || phase === 'uploading'}
            aria-label={recording ? 'Stop' : 'Start speaking'}
            className={cx(
              'relative flex h-[200px] w-[200px] flex-col items-center justify-center rounded-full shadow-2xl transition-transform focus:outline-none active:scale-95 disabled:opacity-80',
              recording ? (warn ? 'bg-amber-500 text-white' : 'bg-red-600 text-white') : cx(theme.gradient),
            )}
          >
            {phase === 'uploading' ? (
              <span className="h-16 w-16 animate-spin rounded-full border-[6px] border-white/30 border-t-white" />
            ) : recording ? (
              <span className="flex h-16 items-end gap-1.5">
                {bars.map((b, i) => (
                  <span
                    key={i}
                    className="w-3 rounded-full bg-white transition-all duration-100"
                    style={{ height: `${Math.max(14, Math.min(64, 14 + level * 120 * b))}px` }}
                  />
                ))}
              </span>
            ) : (
              <MicIcon className="h-24 w-24" />
            )}
            <span className="mt-2 text-lg font-extrabold">
              {phase === 'uploading' ? 'Reading…' : recording ? 'Tap to stop' : phase === 'starting' ? 'Get ready…' : 'Tap & speak'}
            </span>
          </button>
        </div>

        <div className="mt-2 min-h-[96px] w-full text-center">
          {recording && (
            <>
              <p className={cx('text-xl font-extrabold', warn ? 'text-amber-600' : 'text-red-600')}>● Listening… speak now</p>
              <p className="font-mono text-3xl font-bold tabular-nums text-slate-800">{fmtElapsed(elapsed)}</p>
              {warn && <p className="text-sm font-semibold text-amber-700">Stopping at {MAX_MS / 1000} seconds — finish up.</p>}
            </>
          )}
          {phase === 'uploading' && (
            <>
              <p className={cx('text-xl font-extrabold', theme.text)}>{STAGES[stage]}</p>
              <div className="mx-auto mt-2 flex w-48 gap-1.5">
                {STAGES.map((_, i) => (
                  <span key={i} className={cx('h-2 flex-1 rounded-full', i <= stage ? theme.dot : 'bg-slate-200')} />
                ))}
              </div>
              <p className="mt-1 text-sm text-slate-500">Takes about 10 seconds. You can serve a customer meanwhile.</p>
            </>
          )}
          {(phase === 'idle' || phase === 'starting') && (
            <>
              <p className="text-base font-semibold text-slate-700">Say it like you tell your helper:</p>
              <p className={cx('mt-1 text-lg font-bold', theme.textDark)}>{copy.example}</p>
            </>
          )}
          {phase === 'error' && error && (
            <p className="rounded-2xl bg-red-50 px-4 py-3 font-semibold text-red-800">{error}</p>
          )}
        </div>
      </div>

      <p className={cx('rounded-2xl p-3 text-sm font-semibold', theme.soft, theme.textDark)}>
        💡 Names alone are fine. Quantity and price can be filled in on the next screen.
      </p>
    </div>
  );
}
