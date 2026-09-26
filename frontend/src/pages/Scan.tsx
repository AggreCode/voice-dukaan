import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useToast } from '../components/Toast';
import { auth } from '../lib/auth';
import { MAX_PHOTOS, PhotoError, PreparedPhoto, fmtBytes, preparePhoto, releasePhoto } from '../lib/imageCapture';
import { VoiceMode } from '../lib/types';
import { enqueueAndUploadScan, retryAll, usePendingCount } from '../lib/uploadQueue';
import { cx, uuid } from '../lib/utils';

type Phase = 'idle' | 'preparing' | 'ready' | 'uploading' | 'error';

/** Reading a photo is slower than transcribing speech, so the labels move slower than on Record. */
const STAGES: { at: number; label: string }[] = [
  { at: 0, label: 'Sending the photo…' },
  { at: 3500, label: 'Reading the list…' },
  { at: 9000, label: 'Matching your items…' },
];

const COPY: Record<VoiceMode, { headline: string; sub: string; cta: string }> = {
  sale: {
    headline: 'Photograph the list',
    sub: "Point at your customer's paper list. Odia, Hindi or English, printed or handwritten.",
    cta: 'Read the list',
  },
  stock_in: {
    headline: 'Photograph the supplier bill',
    sub: 'Point at the delivery challan or bill. Each line becomes stock coming in.',
    cta: 'Read the bill',
  },
};

function parseMode(v: string | null | undefined): VoiceMode | null {
  return v === 'stock_in' || v === 'sale' ? v : null;
}

export default function Scan() {
  const nav = useNavigate();
  const toast = useToast();
  const pending = usePendingCount();
  const [searchParams] = useSearchParams();
  const mode: VoiceMode = parseMode(searchParams.get('mode')) ?? 'sale';

  const [photos, setPhotos] = useState<PreparedPhoto[]>([]);
  const [selected, setSelected] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState(0);
  const [retrying, setRetrying] = useState(false);

  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  // Photos are object URLs; without this a page change leaks every preview.
  const photosRef = useRef<PreparedPhoto[]>([]);
  photosRef.current = photos;
  useEffect(() => () => photosRef.current.forEach(releasePhoto), []);

  const copy = COPY[mode];
  const room = MAX_PHOTOS - photos.length;

  const addFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setError(null);
      setPhase('preparing');
      const picked = Array.from(files).slice(0, Math.max(0, MAX_PHOTOS - photosRef.current.length));
      const done: PreparedPhoto[] = [];
      for (const f of picked) {
        try {
          done.push(await preparePhoto(f));
        } catch (e) {
          setError(e instanceof PhotoError ? e.message : 'That photo could not be used.');
        }
      }
      if (done.length) {
        setPhotos((prev) => {
          const next = [...prev, ...done];
          setSelected(next.length - 1);
          return next;
        });
      }
      setPhase((p) => (p === 'preparing' ? (done.length || photosRef.current.length ? 'ready' : 'idle') : p));
      if (files.length > picked.length) {
        toast.show(`${MAX_PHOTOS} photos at a time. Read these first, then scan the rest.`);
      }
    },
    [toast],
  );

  const removeAt = (i: number) => {
    setPhotos((prev) => {
      releasePhoto(prev[i]);
      const next = prev.filter((_, n) => n !== i);
      setSelected((s) => Math.max(0, Math.min(s, next.length - 1)));
      if (next.length === 0) setPhase('idle');
      return next;
    });
  };

  const send = async () => {
    if (!photos.length) return;
    setPhase('uploading');
    setStage(0);
    const clientSessionId = uuid();
    try {
      const session = await enqueueAndUploadScan({ clientSessionId, photos: photos.map((p) => p.blob), mode });
      photos.forEach(releasePhoto);
      setPhotos([]);
      nav(`/review/${session.session_id}`);
    } catch (e) {
      setPhase('ready');
      const msg = e instanceof Error ? e.message : 'Upload failed';
      toast.error(`Saved on the phone — will retry. (${msg})`);
    }
  };

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

  const onRetry = async () => {
    setRetrying(true);
    try {
      const r = await retryAll();
      if (r.uploaded.length) {
        toast.success(`Uploaded ${r.uploaded.length} capture(s)`);
        if (r.uploaded.length === 1) nav(`/review/${r.uploaded[0].session_id}`);
      } else if (r.failed.length) {
        toast.error(`Still failing: ${r.failed[0].error}`);
      }
    } finally {
      setRetrying(false);
    }
  };

  const busy = phase === 'uploading' || phase === 'preparing';

  return (
    <div className="mx-auto flex min-h-[calc(100vh-64px)] w-full max-w-md flex-col px-5 pb-6 pt-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-primary-dark">{auth.getShopName() ?? 'Voice Dukan'}</h1>
          <p className="text-xs text-slate-500">{mode === 'stock_in' ? 'Scan · stock in' : 'Scan a list'}</p>
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
          <button type="button" onClick={() => nav('/scan', { replace: true })} className="min-h-[44px] px-2 font-semibold underline">
            Bill a sale instead
          </button>
        </div>
      )}

      <h2 className="mt-4 text-center text-xl font-bold text-slate-800">{copy.headline}</h2>
      <p className="mx-auto mt-1 max-w-[19rem] text-center text-sm text-slate-500">{copy.sub}</p>

      {/* hidden pickers: one opens the camera, one the gallery */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          void addFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void addFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {photos.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center py-6">
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            disabled={busy}
            className="flex h-[230px] w-full flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-primary/40 bg-white text-primary shadow-sm active:bg-primary-light/40 disabled:opacity-60"
          >
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-white shadow-lg">
              <CameraIcon className="h-10 w-10" />
            </span>
            <span className="text-base font-bold">{phase === 'preparing' ? 'Preparing…' : 'Take a photo'}</span>
            <span className="text-xs text-slate-500">Up to {MAX_PHOTOS} pages</span>
          </button>
          <button
            type="button"
            onClick={() => galleryRef.current?.click()}
            disabled={busy}
            className="mt-3 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 disabled:opacity-60"
          >
            <GalleryIcon className="h-5 w-5" />
            Choose from gallery
          </button>
          <Tips />
        </div>
      ) : (
        <div className="flex flex-1 flex-col py-4">
          <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-900">
            <img
              src={photos[Math.min(selected, photos.length - 1)]?.previewUrl}
              alt={`Page ${selected + 1}`}
              className="max-h-[46vh] w-full object-contain"
            />
            <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">
              Page {Math.min(selected, photos.length - 1) + 1} of {photos.length}
            </span>
          </div>

          <div className="mt-3 flex items-center gap-2 overflow-x-auto">
            {photos.map((p, i) => (
              <div key={p.previewUrl} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setSelected(i)}
                  className={cx(
                    'block h-16 w-16 overflow-hidden rounded-xl border-2',
                    i === selected ? 'border-primary' : 'border-slate-200',
                  )}
                >
                  <img src={p.previewUrl} alt="" className="h-full w-full object-cover" />
                </button>
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  aria-label={`Remove page ${i + 1}`}
                  disabled={busy}
                  className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-white shadow disabled:opacity-60"
                >
                  ×
                </button>
              </div>
            ))}
            {room > 0 && (
              <button
                type="button"
                onClick={() => cameraRef.current?.click()}
                disabled={busy}
                className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl border-2 border-dashed border-primary/50 text-[11px] font-semibold text-primary disabled:opacity-60"
              >
                <span className="text-lg leading-none">+</span>
                page
              </button>
            )}
          </div>

          <p className="mt-2 text-center text-xs text-slate-500">
            {photos.length} photo{photos.length === 1 ? '' : 's'} · {fmtBytes(photos.reduce((s, p) => s + p.bytes, 0))} to upload
          </p>

          {phase === 'uploading' ? (
            <div className="mt-4 text-center">
              <div className="text-lg font-semibold text-primary-dark">{STAGES[stage].label}</div>
              <div className="mx-auto mt-2 flex w-44 gap-1">
                {STAGES.map((_, i) => (
                  <span key={i} className={cx('h-1.5 flex-1 rounded', i <= stage ? 'bg-primary' : 'bg-slate-200')} />
                ))}
              </div>
              <div className="mt-1 text-xs text-slate-500">Usually 5–20 seconds</div>
            </div>
          ) : (
            <button
              type="button"
              onClick={send}
              disabled={busy}
              className="mt-4 min-h-[56px] w-full rounded-2xl bg-primary text-lg font-bold text-white shadow-lg active:bg-primary-dark disabled:opacity-60"
            >
              {phase === 'preparing' ? 'Preparing…' : copy.cta}
            </button>
          )}
        </div>
      )}

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}

function Tips() {
  return (
    <ul className="mt-5 w-full space-y-1.5 rounded-xl bg-white p-3 text-xs text-slate-600 shadow-sm">
      <li className="flex gap-2"><Dot />Lay the paper flat and fill the frame with it.</li>
      <li className="flex gap-2"><Dot />Keep your shadow off the page.</li>
      <li className="flex gap-2"><Dot />A long list can go across {MAX_PHOTOS} photos.</li>
      <li className="flex gap-2"><Dot />No paper list? Speak it instead, on the Record tab.</li>
    </ul>
  );
}

function Dot() {
  return <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />;
}

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.2a2 2 0 0 0 1.7-1l.5-.8a1 1 0 0 1 .85-.5h4.5a1 1 0 0 1 .85.5l.5.8a2 2 0 0 0 1.7 1h1.2A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-9z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

function GalleryIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9" r="1.5" />
      <path d="M21 16l-5-5-4.5 5-2-2L3 19" />
    </svg>
  );
}
