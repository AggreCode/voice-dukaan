import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { AdminShopRow } from '../lib/types';
import { cx, fmtDateTime, fmtMoney } from '../lib/utils';

/**
 * The console for whoever runs the service.
 *
 * Read-only by design: there is nothing here that writes to a shop, so support can answer questions
 * about a ledger without being able to change what it says. The server refuses this to any account
 * without the admin role, with a 404 rather than a 403, so the console does not announce itself.
 */
export default function Admin() {
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const overview = useQuery({ queryKey: ['admin', 'shops'], queryFn: api.admin.shops, staleTime: 30_000 });

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = overview.data?.rows ?? [];
    if (!needle) return all;
    return all.filter((r) =>
      [r.name, r.owner, r.owner_username, r.mobile, r.gst_number, r.address, r.type]
        .some((v) => (v ?? '').toLowerCase().includes(needle)),
    );
  }, [overview.data, q]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-8 pt-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-primary-dark">All shops</h1>
          <p className="text-xs text-slate-500">Service administration · read only</p>
        </div>
        <Link to="/settings" className="min-h-[44px] rounded-lg px-2 py-2 text-sm font-medium text-primary">
          ← Settings
        </Link>
      </header>

      {overview.isLoading && <p className="py-10 text-center text-slate-500">Loading…</p>}
      {overview.isError && (
        <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
          {(overview.error as Error).message}
          <button type="button" onClick={() => overview.refetch()} className="ml-2 underline">Retry</button>
        </div>
      )}

      {overview.data && (
        <>
          <div className="mb-3 grid grid-cols-4 gap-2">
            <Stat label="Shops" value={overview.data.shops} />
            <Stat label="Users" value={overview.data.users} />
            <Stat label="Products" value={overview.data.products} />
            <Stat label="Bills" value={overview.data.bills} />
          </div>

          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by shop, owner, mobile or GST"
            className="mb-3 min-h-[48px] w-full rounded-xl border border-slate-300 px-3 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
          />

          {rows.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No shops match that.</p>}

          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(r.id)}
                  className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm active:bg-slate-50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-900">{r.name}</p>
                      <p className="truncate text-xs text-slate-500">
                        {r.type}
                        {r.owner_username && ` · ${r.owner_username}`}
                        {r.mobile && ` · ${r.mobile}`}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-bold text-slate-900">{fmtMoney(r.sales_total)}</p>
                      <p className="text-[11px] text-slate-500">{r.bills} bill{r.bills === 1 ? '' : 's'}</p>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-slate-600">
                    <Chip>{r.products} products</Chip>
                    <Chip>{r.captures} captures</Chip>
                    <Chip>{r.users} user{r.users === 1 ? '' : 's'}</Chip>
                    {r.gst_number && <Chip>GST {r.gst_number}</Chip>}
                    <Chip tone={r.last_activity_at ? 'ok' : 'idle'}>
                      {r.last_activity_at ? `Last bill ${fmtDateTime(r.last_activity_at)}` : 'No bills yet'}
                    </Chip>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {openId && <ShopSheet id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-white p-2 text-center shadow-sm">
      <div className="text-xl font-bold text-slate-900">{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

function Chip({ children, tone = 'plain' }: { children: React.ReactNode; tone?: 'plain' | 'ok' | 'idle' }) {
  return (
    <span
      className={cx(
        'rounded-full px-2 py-0.5',
        tone === 'ok' ? 'bg-emerald-50 text-emerald-700' : tone === 'idle' ? 'bg-slate-100 text-slate-500' : 'bg-slate-100',
      )}
    >
      {children}
    </span>
  );
}

function ShopSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const detail = useQuery({ queryKey: ['admin', 'shop', id], queryFn: () => api.admin.shop(id) });
  const shop: AdminShopRow | undefined = detail.data?.shop;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="flex max-h-[88dvh] w-full max-w-2xl flex-col rounded-t-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-2 rounded-t-2xl border-b border-slate-100 bg-white px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{shop?.name ?? 'Shop'}</h2>
            {shop && <p className="truncate text-xs text-slate-500">{shop.address ?? 'No address given'}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-2xl leading-none text-slate-600"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {detail.isLoading && <p className="py-8 text-center text-slate-500">Loading…</p>}
          {detail.isError && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{(detail.error as Error).message}</p>}

          {detail.data && shop && (
            <>
              <section className="grid grid-cols-2 gap-2 text-sm">
                <Field label="Mobile" value={shop.mobile} />
                <Field label="WhatsApp" value={shop.whatsapp} />
                <Field label="GST" value={shop.gst_number} />
                <Field label="Registered" value={fmtDateTime(shop.created_at)} />
                <Field label="Sales" value={fmtMoney(shop.sales_total)} />
                <Field label="Purchases" value={fmtMoney(shop.purchases_total)} />
              </section>

              <section>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Users</h3>
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {detail.data.users.map((u) => (
                    <li key={u.id} className="flex items-center justify-between gap-3 p-2.5 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{u.display_name}</p>
                        <p className="truncate text-xs text-slate-500">
                          {u.username ?? 'no username'} · {u.role}
                          {u.mobile && ` · ${u.mobile}`}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-slate-500">
                        {u.last_login_at ? fmtDateTime(u.last_login_at) : 'never signed in'}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              {detail.data.low_stock.length > 0 && (
                <section>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Low stock</h3>
                  <p className="text-sm text-amber-800">{detail.data.low_stock.join(', ')}</p>
                </section>
              )}

              <section>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Recent bills</h3>
                {detail.data.recent_bills.length === 0 && <p className="text-sm text-slate-400">None yet.</p>}
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {detail.data.recent_bills.map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-3 p-2.5 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {b.type === 'purchase' ? 'Stock in' : 'Sale'}
                          {b.customer_name && ` · ${b.customer_name}`}
                          {b.status === 'voided' && <span className="ml-1 text-red-600">(voided)</span>}
                        </p>
                        <p className="text-xs text-slate-500">
                          {fmtDateTime(b.created_at)} · {b.items} item{b.items === 1 ? '' : 's'} · {b.payment_mode}
                        </p>
                      </div>
                      <span className="shrink-0 font-semibold">{fmtMoney(b.total_amount)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}

          <button
            type="button"
            onClick={onClose}
            className="mb-[max(env(safe-area-inset-bottom),8px)] min-h-[52px] w-full rounded-xl border border-slate-300 font-semibold text-slate-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-lg bg-slate-50 p-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="truncate font-medium text-slate-800">{value || '—'}</div>
    </div>
  );
}
