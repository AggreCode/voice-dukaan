import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ActiveRecording, RecorderError, recordingSupport, startRecording } from '../lib/recorder';
import { enqueueAndUpload, retryAll, usePendingCount } from '../lib/uploadQueue';
import { cx, fmtElapsed, uuid } from '../lib/utils';
import { useToast } from '../components/Toast';
import { auth } from '../lib/auth';

import { VoiceMode } from '../lib/types';

const WARN_MS = 75_000;
const MAX_MS = 90_000;

type Phase = 'idle' | 'starting' | 'recording' | 'uploading' | 'error';
const STAGES: { at: number; label: string }[] = [
  { at: 0, label: 'Uploading…' },
  { at: 2500, label: 'Transcribing…' },
  { at: 7000, label: 'Understanding…' },
];

const COPY: Record<VoiceMode, { headline: string; example: string; hint: string }> = {
  sale: { headline: 'Speak the bill', example: 'Paracetamol dasa gota, Crocin dui patta', hint: 'Speak items, qty and price' },
  stock_in: { headline: 'Speak the stock you received', example: 'Paracetamol 10 strips, ORS 5 packets', hint: 'Speak items, qty and cost' },
};

function parseMode(v: string | null | undefined): VoiceMode | null {
  return v === 'stock_in' || v === 'sale' ? v : null;
}

export default function Record() {
  const nav = useNavigate();
  const toast = useToast();
  const pending = usePendingCount();
  const [searchParams] = useSearchParams();
  // Sales are the default. Stock-in is reached from Inventory, so this screen needs no switch.
  const mode: VoiceMode = parseMode(searchParams.get('mode')) ?? 'sale';
  /** Mode captured when the current recording started. */
  const recModeRef = useRef<VoiceMode>(mode);

  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState(0);
  const [retrying, setRetrying] = useState(false);

  const recRef = useRef<ActiveRecording | null>(null);
  const timerRef = useRef<number>(0);
  const stoppingRef = useRef(false);

  const support = recordingSupport();

  const clearTimer = () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = 0;
  };

  const stop = useCallback(async () => {
    const rec = recRef.current;
    if (!rec || stoppingRef.current) return;
    stoppingRef.current = true;
    clearTimer();
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
      setPhase('idle');
      setElapsed(0);
      setLevel(0);
      toast.show('Too short. Tap the mic and speak.');
      return;
    }

    const clientSessionId = uuid();
    try {
      const session = await enqueueAndUpload({
        clientSessionId,
        blob: result.blob,
        mimeType: result.mimeType,
        durationMs: result.durationMs,
        mode: recModeRef.current,
      });
      nav(`/review/${session.session_id}`, { replace: false });
    } catch (e) {
      setPhase('idle');
      setElapsed(0);
      setLevel(0);
      const msg = e instanceof Error ? e.message : 'Upload failed';
      toast.error(`Saved offline — will retry. (${msg})`);
    }
  }, [nav, toast]);

  const start = useCallback(async () => {
    setError(null);
    recModeRef.current = mode;
    setPhase('starting');
    try {
      const rec = await startRecording({
        onLevel: (l) => setLevel(l),
        onError: (e) => {
          setError(e.message);
        },
      });
      recRef.current = rec;
      setElapsed(0);
      setPhase('recording');
      timerRef.current = window.setInterval(() => {
        const ms = Date.now() - rec.startedAt;
        setElapsed(ms);
        if (ms >= MAX_MS) void stop();
      }, 200);
    } catch (e) {
      const msg = e instanceof RecorderError ? e.message : (e as Error).message;
      setError(msg);
      setPhase('error');
    }
  }, [stop, mode]);

  // Staged progress labels while the upload is in flight.
  useEffect(() => {
    if (phase !== 'uploading') return;
    const t0 = Date.now();
    const id = window.setInterval(() => {
      const ms = Date.now() - t0;
      let s = 0;
      STAGES.forEach((st, i) => {
        if (ms >= st.at) s = i;
      });
      setStage(s);
    }, 300);
    return () => window.clearInterval(id);
  }, [phase]);

  useEffect(
    () => () => {
      clearTimer();
      recRef.current?.cancel();
    },
    [],
  );

  const onTap = () => {
    if (phase === 'idle' || phase === 'error') void start();
    else if (phase === 'recording') void stop();
  };

  const onRetry = async () => {
    setRetrying(true);
    try {
      const r = await retryAll();
      if (r.uploaded.length) {
        toast.success(`Uploaded ${r.uploaded.length} recording(s)`);
        if (r.uploaded.length === 1) nav(`/review/${r.uploaded[0].session_id}`);
      } else if (r.failed.length) {
        toast.error(`Still failing: ${r.failed[0].error}`);
      }
    } finally {
      setRetrying(false);
    }
  };

  const warn = elapsed >= WARN_MS;
  const recording = phase === 'recording';
  const ringScale = 1 + level * 0.35;
  const copy = COPY[mode];

  return (
    <div className="mx-auto flex min-h-[calc(100vh-64px)] w-full max-w-md flex-col px-5 pb-6 pt-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-primary-dark">{auth.getShopName() ?? 'Voice Dukan'}</h1>
          <p className="text-xs text-slate-500">Record</p>
        </div>
        {pending > 0 && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="flex min-h-[44px] items-center gap-2 rounded-full bg-amber-100 px-3 text-xs font-semibold text-amber-800 disabled:opacity-60"
          >
            <span className="rounded-full bg-amber-500 px-1.5 text-white">{pending}</span>
            pending · {retrying ? 'retrying…' : 'Retry'}
          </button>
        )}
      </header>

      {mode === 'stock_in' && (
        <div className="mt-3 flex items-center justify-between rounded-xl bg-primary/10 px-3 py-2 text-sm text-primary-dark">
          <span className="font-semibold">Adding stock</span>
          <button type="button" onClick={() => nav('/', { replace: true })} className="min-h-[44px] px-2 font-semibold underline">
            Bill a sale instead
          </button>
        </div>
      )}
      <h2 className="mt-4 text-center text-xl font-bold text-slate-800">{copy.headline}</h2>

      {!support.ok && (
        <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{support.error.message}</div>
      )}

      <div className="flex flex-1 flex-col items-center justify-center py-8">
        <div className="relative flex items-center justify-center">
          {/* level ring */}
          <div
            aria-hidden
            className={cx(
              'absolute rounded-full transition-transform duration-75',
              recording ? (warn ? 'bg-amber-300/40' : 'bg-primary/20') : 'bg-transparent',
            )}
            style={{ width: 260, height: 260, transform: `scale(${recording ? ringScale : 1})` }}
          />
          <div
            aria-hidden
            className={cx('absolute rounded-full', recording ? (warn ? 'bg-amber-300/30' : 'bg-primary/10') : 'bg-transparent')}
            style={{ width: 260, height: 260, transform: `scale(${recording ? 1 + level * 0.7 : 1})`, transition: 'transform 120ms' }}
          />
          <button
            type="button"
            onClick={onTap}
            disabled={!support.ok || phase === 'starting' || phase === 'uploading'}
            aria-label={recording ? 'Stop recording' : 'Start recording'}
            className={cx(
              'relative flex h-[220px] w-[220px] flex-col items-center justify-center rounded-full text-white shadow-xl transition-colors focus:outline-none focus:ring-4 focus:ring-primary/40 disabled:opacity-70',
              recording ? (warn ? 'bg-amber-500' : 'bg-red-600') : 'bg-primary active:bg-primary-dark',
            )}
          >
            {phase === 'uploading' ? (
              <Spinner />
            ) : recording ? (
              <span className="h-16 w-16 rounded-lg bg-white" />
            ) : (
              <MicBig />
            )}
            <span className="mt-3 text-base font-semibold">
              {phase === 'uploading' ? 'Working…' : recording ? 'Stop' : phase === 'starting' ? 'Starting…' : 'Tap to record'}
            </span>
          </button>
        </div>

        <div className="mt-8 h-16 text-center">
          {recording && (
            <>
              <div className={cx('font-mono text-4xl font-bold tabular-nums', warn ? 'text-amber-600' : 'text-slate-800')}>{fmtElapsed(elapsed)}</div>
              <div className="text-xs text-slate-500">{warn ? `Stopping at ${MAX_MS / 1000}s. Finish soon.` : copy.hint}</div>
            </>
          )}
          {phase === 'uploading' && (
            <div>
              <div className="text-lg font-semibold text-primary-dark">{STAGES[stage].label}</div>
              <div className="mx-auto mt-2 flex w-40 gap-1">
                {STAGES.map((_, i) => (
                  <span key={i} className={cx('h-1.5 flex-1 rounded', i <= stage ? 'bg-primary' : 'bg-slate-200')} />
                ))}
              </div>
              <div className="mt-1 text-xs text-slate-500">This takes 5–20 seconds</div>
            </div>
          )}
          {phase === 'idle' && (
            <p className="px-6 text-sm text-slate-500">
              e.g. “{copy.example}”
            </p>
          )}
          {phase === 'error' && error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </div>
      </div>
    </div>
  );
}

function MicBig() {
  return (
    <svg className="h-20 w-20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
    </svg>
  );
}
function Spinner() {
  return <span className="h-16 w-16 animate-spin rounded-full border-4 border-white/40 border-t-white" />;
}
