import { useNavigate } from 'react-router-dom';
import { auth } from '../lib/auth';
import { usePendingCount, retryAll } from '../lib/uploadQueue';
import { useToast } from '../components/Toast';
import { cx } from '../lib/utils';
import { useState } from 'react';

/**
 * The one screen a shopkeeper lands on, offering the three ways a bill can start.
 *
 * They were not equals before: speaking was the home screen, photographing was a tab, and typing was
 * not offered at all, only reachable by adding a line to a bill that had already been captured some
 * other way. A shop with a noisy counter, or a customer who hands over nothing, needs the third one
 * as much as the first. Choosing one leads to that screen, where selling or buying is chosen.
 */
export default function Home() {
  const nav = useNavigate();
  const toast = useToast();
  const pending = usePendingCount();
  const [retrying, setRetrying] = useState(false);

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

  return (
    <div className="mx-auto flex min-h-[calc(100vh-64px)] w-full max-w-md flex-col px-5 pb-6 pt-4">
      <header className="flex items-center justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold text-primary-dark">{auth.getShopName() ?? 'Mo Dokan'}</h1>
          <p className="text-xs text-slate-500">Start a bill</p>
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

      <div className="flex flex-1 flex-col justify-center gap-3 py-6">
        <Choice
          onClick={() => nav('/record')}
          title="Speak it"
          detail="Say the items and quantities. Odia, Hindi or English."
          tone="primary"
          icon={<MicIcon className="h-9 w-9" />}
        />
        <Choice
          onClick={() => nav('/scan')}
          title="Photograph a list"
          detail="A customer's paper list, or a wholesaler's bill."
          tone="primary"
          icon={<CameraIcon className="h-9 w-9" />}
        />
        <Choice
          onClick={() => nav('/manual')}
          title="Type it in"
          detail="A short bill, or a counter too noisy to speak at."
          tone="plain"
          icon={<KeyboardIcon className="h-9 w-9" />}
        />
      </div>
    </div>
  );
}

function Choice({
  onClick, title, detail, icon, tone,
}: {
  onClick: () => void;
  title: string;
  detail: string;
  icon: React.ReactNode;
  tone: 'primary' | 'plain';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'flex min-h-[104px] w-full items-center gap-4 rounded-2xl border px-4 text-left shadow-sm transition-colors',
        tone === 'primary'
          ? 'border-primary/30 bg-white active:bg-primary-light/40'
          : 'border-slate-200 bg-white active:bg-slate-50',
      )}
    >
      <span
        className={cx(
          'flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl',
          tone === 'primary' ? 'bg-primary text-white' : 'bg-slate-200 text-slate-700',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-lg font-bold text-slate-900">{title}</span>
        <span className="block text-sm leading-snug text-slate-500">{detail}</span>
      </span>
    </button>
  );
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
    </svg>
  );
}
function CameraIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.2a2 2 0 0 0 1.7-1l.5-.8a1 1 0 0 1 .85-.5h4.5a1 1 0 0 1 .85.5l.5.8a2 2 0 0 0 1.7 1h1.2A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-9z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}
function KeyboardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6.5 9.5h.01M10 9.5h.01M13.5 9.5h.01M17 9.5h.01M6.5 13h.01M10 13h.01M13.5 13h.01M17 13h.01M8.5 15.5h7" />
    </svg>
  );
}
