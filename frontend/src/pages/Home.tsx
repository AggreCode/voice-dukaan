import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import BigChoice from '../components/BigChoice';
import { BagIcon, ChartIcon, TruckIcon } from '../components/Icons';
import UnfinishedBills from '../components/UnfinishedBills';
import { api } from '../lib/api';
import { auth } from '../lib/auth';
import { useLocal } from '../lib/labels';
import { usePendingCount, retryAll } from '../lib/uploadQueue';
import { useToast } from '../components/Toast';
import { fmtMoney } from '../lib/utils';
import { useState } from 'react';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * The first thing a shopkeeper sees, and the only decision on it: is this a sale or a purchase?
 *
 * Sell is on top because it happens fifty times a day and buying happens once a week. Today's takings
 * sit above both, because "how much have I sold today" is the question every shopkeeper asks first,
 * and an app that answers it unprompted earns a second look. Anything left half-done is shown before
 * everything else, so a bill interrupted by a customer is never lost.
 */
export default function Home() {
  const nav = useNavigate();
  const word = useLocal();
  const toast = useToast();
  const pending = usePendingCount();
  const [retrying, setRetrying] = useState(false);
  const today = useQuery({ queryKey: ['analytics', 1], queryFn: () => api.analytics(1), staleTime: 30_000 });

  const onRetry = async () => {
    setRetrying(true);
    try {
      const r = await retryAll();
      if (r.uploaded.length) toast.success(`Sent ${r.uploaded.length} waiting bill(s)`);
      else if (r.failed.length) toast.error(`Still could not send: ${r.failed[0].error}`);
    } finally {
      setRetrying(false);
    }
  };

  const low = today.data?.low_stock.length ?? 0;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 pb-28 pt-[max(env(safe-area-inset-top),16px)]">
      <header className="mb-4">
        <p className="text-base font-semibold text-slate-500">
          {greeting()}
          {word('hello') && <span className="ml-1.5">· {word('hello')}</span>} 🙏
        </p>
        <h1 className="truncate text-3xl font-extrabold tracking-tight text-slate-900">{auth.getShopName() ?? 'Mo Dokan'}</h1>
      </header>

      <button
        type="button"
        onClick={() => nav('/report')}
        className="mb-4 flex items-center gap-4 rounded-3xl bg-slate-900 p-4 text-left text-white shadow-lg active:scale-[0.99]"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white/70">Sold today</p>
          <p className="text-4xl font-extrabold tabular-nums">
            {today.data ? fmtMoney(today.data.totals.sales) : <span className="text-white/40">₹ …</span>}
          </p>
          <p className="text-sm text-white/70">
            {today.data
              ? `${today.data.totals.bills} bill${today.data.totals.bills === 1 ? '' : 's'}` +
                (today.data.totals.profit > 0 ? ` · about ${fmtMoney(today.data.totals.profit)} earned` : '')
              : 'Counting…'}
          </p>
        </div>
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/10">
          <ChartIcon className="h-8 w-8" />
        </span>
      </button>

      {pending > 0 && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="mb-4 flex min-h-[56px] items-center gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 px-4 text-left font-bold text-amber-900"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500 text-white">{pending}</span>
          <span className="flex-1">{retrying ? 'Sending…' : 'Waiting for internet — tap to send now'}</span>
        </button>
      )}

      <UnfinishedBills />

      <div className="space-y-4">
        <BigChoice
          size="xl"
          tone="sale"
          onClick={() => nav('/sell')}
          icon={<BagIcon className="h-11 w-11" />}
          title="Sell"
          local={word('sell')}
          detail="Make a bill for a customer"
        />
        <BigChoice
          size="xl"
          tone="stock_in"
          onClick={() => nav('/buy')}
          icon={<TruckIcon className="h-11 w-11" />}
          title="Buy"
          local={word('buy')}
          detail="Stock arrived from the wholesaler"
        />
      </div>

      {low > 0 && (
        <button
          type="button"
          onClick={() => nav('/stock?filter=low')}
          className="mt-4 flex min-h-[56px] items-center justify-between rounded-2xl border-2 border-amber-200 bg-white px-4 font-bold text-amber-800"
        >
          <span>⚠ {low} item{low === 1 ? '' : 's'} running low</span>
          <span className="text-sm text-amber-600">See →</span>
        </button>
      )}
    </div>
  );
}
