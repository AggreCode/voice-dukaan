import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { auth } from '../lib/auth';
import { cx } from '../lib/utils';
import { usePendingCount } from '../lib/uploadQueue';

export default function Settings({ onSwitchShop }: { onSwitchShop: () => void }) {
  const [debug, setDebug] = useState(auth.isDebug());
  const pending = usePendingCount();
  useEffect(() => auth.setDebug(debug), [debug]);

  const me = useQuery({ queryKey: ['shops', 'me'], queryFn: api.shops.me, retry: 1 });
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 30_000, retry: 1 });

  const shopName = me.data?.name ?? auth.getShopName() ?? '—';
  const shopType = me.data?.type ?? auth.getShopType() ?? '—';

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-6 pt-4">
      <h1 className="mb-4 text-lg font-bold text-primary-dark">Settings</h1>

      <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Shop</p>
        <p className="mt-1 text-lg font-semibold">{shopName}</p>
        <p className="text-sm text-slate-500">
          {shopType}
          {me.data ? ` · ${me.data.default_language} · catalog v${me.data.catalog_version}` : ''}
        </p>
        <p className="mt-1 break-all text-[11px] text-slate-400">id {auth.getShopId()}</p>
        {me.isError && <p className="mt-1 text-xs text-red-600">Could not load shop: {(me.error as Error).message}</p>}
      </section>

      <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Health check</p>
          <button type="button" onClick={() => health.refetch()} className="min-h-[36px] rounded-lg border border-slate-300 px-3 text-xs font-medium">
            Refresh
          </button>
        </div>
        {health.isLoading && <p className="mt-2 text-sm text-slate-500">Checking…</p>}
        {health.isError && (
          <p className="mt-2 text-sm text-red-600">
            <Dot ok={false} /> API unreachable: {(health.error as Error).message}
          </p>
        )}
        {health.data && (
          <ul className="mt-2 space-y-1.5 text-sm">
            <li><Dot ok={health.data.ok} /> API ok</li>
            <li><Dot ok={health.data.db} /> Database</li>
            <li><Dot ok={health.data.sarvam_configured} /> Sarvam (speech) {health.data.sarvam_model && <span className="text-slate-400">· {health.data.sarvam_model}</span>}</li>
            <li><Dot ok={health.data.anthropic_configured} /> Anthropic (understanding) {health.data.claude_model && <span className="text-slate-400">· {health.data.claude_model}</span>}</li>
            <li><Dot ok={health.data.google_shadow} neutral /> Google shadow transcription {health.data.google_shadow ? 'on' : 'off'}</li>
          </ul>
        )}
      </section>

      <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
        <label className="flex min-h-[44px] items-center justify-between">
          <span>
            <span className="font-medium">Debug mode</span>
            <span className="block text-xs text-slate-500">Show secondary transcripts & latencies on review</span>
          </span>
          <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} className="h-6 w-6 accent-primary" />
        </label>
        <p className="mt-2 text-xs text-slate-500">Pending uploads: {pending}</p>
      </section>

      <section className="space-y-2">
        <a
          href="/docs"
          target="_blank"
          rel="noreferrer"
          className="flex min-h-[48px] items-center justify-center rounded-xl border border-slate-300 bg-white font-medium text-slate-700"
        >
          API docs (/docs) ↗
        </a>
        <button
          type="button"
          onClick={() => {
            if (window.confirm('Switch shop? This clears the saved shop on this device.')) {
              auth.clear();
              onSwitchShop();
            }
          }}
          className="min-h-[48px] w-full rounded-xl border border-red-300 bg-red-50 font-semibold text-red-700"
        >
          Switch shop
        </button>
      </section>
      <p className="mt-6 text-center text-[11px] text-slate-400">Voice Dukan · v{__APP_VERSION__}</p>
    </div>
  );
}

function Dot({ ok, neutral }: { ok: boolean; neutral?: boolean }) {
  return (
    <span
      className={cx('mr-2 inline-block h-3 w-3 rounded-full align-middle', ok ? 'bg-emerald-500' : neutral ? 'bg-slate-300' : 'bg-red-500')}
    />
  );
}
