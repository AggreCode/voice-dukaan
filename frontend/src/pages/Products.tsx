import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import TopBar from '../components/TopBar';
import { api, ApiError } from '../lib/api';
import { COMMON_UNITS, LOCAL_NAME_HELP, LOCAL_NAME_PLACEHOLDER, STOCK_ADJUST_REASONS, movementReasonLabel } from '../lib/constants';
import { round2 } from '../lib/reviewModel';
import { formatSignedQty, formatStock } from '../lib/stock';
import { ProductOut, ProductPatch, StockAdjustReason, numOrNull } from '../lib/types';
import { cx, fmtDateTime, fmtMoney } from '../lib/utils';
import { useToast } from '../components/Toast';
import { AddProductInline } from '../components/AddProductInline';

const field = 'min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30';
const sectionTitle = 'text-xs font-semibold uppercase tracking-wide text-slate-500';
const bigField = 'mt-1 min-h-[56px] w-full rounded-xl border border-slate-300 bg-white px-3 text-2xl font-bold tabular-nums text-slate-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30';

function isLow(p: ProductOut): boolean {
  return p.stock_qty <= p.low_stock_threshold;
}

function LowBadge() {
  return <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-800">Low stock</span>;
}


type Filter = 'all' | 'low' | 'noprice';
type SortKey = 'name' | 'qty' | 'margin';

function marginOf(p: ProductOut): { amount: number; pct: number } | null {
  if (!(p.sell_price > 0) || p.cost_price === null || !(p.cost_price > 0)) return null;
  return { amount: round2(p.sell_price - p.cost_price), pct: ((p.sell_price - p.cost_price) / p.cost_price) * 100 };
}

/**
 * My stock, as a table: product, quantity, unit, selling price, cost price, margin.
 *
 * A table because that is what a stock register looks like on paper, and every shopkeeper has kept
 * one. The product column stays put while the numbers scroll on a narrow phone, a missing price shows
 * as a red "Set" in its own cell rather than as a zero, and tapping any row opens that product with its
 * prices first.
 */
export default function Products() {
  const [params] = useSearchParams();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filter, setFilter] = useState<Filter>(params.get('filter') === 'low' ? 'low' : 'all');
  const [sort, setSort] = useState<SortKey>('name');
  const [editing, setEditing] = useState<ProductOut | null>(null);
  const [adding, setAdding] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const fromBuy = params.get('from') === 'buy';

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const products = useQuery({
    queryKey: ['products', debounced],
    queryFn: () => api.products.list(debounced || undefined),
  });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['products'] });
    void qc.invalidateQueries({ queryKey: ['analytics'] });
  };

  const all = (products.data ?? []).filter((p) => p.is_active);
  const lowCount = all.filter(isLow).length;
  const noPriceCount = all.filter((p) => !(p.sell_price > 0) || p.cost_price === null || !(p.cost_price > 0)).length;
  const shown = all
    .filter((p) => (filter === 'low' ? isLow(p) : filter === 'noprice' ? !(p.sell_price > 0) || !(Number(p.cost_price) > 0) : true))
    .sort((a, b) => {
      if (sort === 'qty') return a.stock_qty - b.stock_qty;
      if (sort === 'margin') return (marginOf(b)?.pct ?? -1e9) - (marginOf(a)?.pct ?? -1e9);
      return a.name.localeCompare(b.name);
    });
  const atCost = all.reduce((s, p) => s + Math.max(0, p.stock_qty) * (Number(p.cost_price) || 0), 0);
  const atSell = all.reduce((s, p) => s + Math.max(0, p.stock_qty) * (p.sell_price || 0), 0);
  const empty = !!products.data && all.length === 0 && !debounced;

  const th = (key: SortKey | null, label: string, cls = '') => (
    <th className={cx('px-1 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wide text-slate-500', cls)}>
      {key ? (
        <button type="button" onClick={() => setSort(key)} className={cx('uppercase', sort === key && 'text-slate-900 underline')}>
          {label}
        </button>
      ) : label}
    </th>
  );

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-28">
      <TopBar title="My stock" subtitle={`${all.length} item${all.length === 1 ? '' : 's'}`} back={fromBuy ? '/buy' : '/'} />

      {!empty && (
        <div className="mb-3 grid grid-cols-2 gap-2">
          <div className="rounded-2xl bg-white p-3 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Stock worth</p>
            <p className="text-2xl font-extrabold tabular-nums text-slate-900">{fmtMoney(round2(atCost))}</p>
            <p className="text-xs text-slate-500">at what you paid</p>
          </div>
          <div className="rounded-2xl bg-white p-3 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Will sell for</p>
            <p className="text-2xl font-extrabold tabular-nums text-emerald-700">{fmtMoney(round2(atSell))}</p>
            <p className="text-xs text-slate-500">at your prices</p>
          </div>
        </div>
      )}

      <div className="mb-2 flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search your stock"
          inputMode="search"
          className="min-h-[52px] min-w-0 flex-1 rounded-2xl border-2 border-slate-200 bg-white px-4 text-lg focus:border-slate-400 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="min-h-[52px] shrink-0 rounded-2xl bg-blue-600 px-4 text-base font-extrabold text-white active:bg-blue-700"
        >
          + New
        </button>
      </div>

      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {([
          ['all', `All · ${all.length}`],
          ['low', `Low · ${lowCount}`],
          ['noprice', `No price · ${noPriceCount}`],
        ] as [Filter, string][]).map(([f, label]) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cx(
              'min-h-[44px] shrink-0 rounded-full border-2 px-4 text-sm font-bold',
              filter === f
                ? f === 'low' ? 'border-amber-500 bg-amber-500 text-white' : f === 'noprice' ? 'border-red-600 bg-red-600 text-white' : 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-white text-slate-600',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {adding && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setAdding(false)}>
          <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-4 pb-[max(env(safe-area-inset-bottom),16px)]" onClick={(e) => e.stopPropagation()}>
            <AddProductInline
              initialName={q}
              onCancel={() => setAdding(false)}
              onCreated={() => {
                setAdding(false);
                toast.success('Item added to your stock');
                invalidate();
              }}
            />
          </div>
        </div>
      )}

      {products.isLoading && <p className="py-8 text-center text-slate-500">Loading your stock…</p>}
      {products.isError && <p className="rounded-2xl bg-red-50 p-4 font-semibold text-red-800">{(products.error as Error).message}</p>}

      {empty && (
        <section className="rounded-3xl border-2 border-dashed border-slate-200 bg-white p-6 text-center">
          <p className="text-xl font-extrabold text-slate-800">Your stock is empty</p>
          <p className="mt-1 text-slate-500">Add what you have — speak it, photograph the bill, or type it.</p>
          <Link to="/buy" className="mt-4 inline-flex min-h-[56px] items-center rounded-2xl bg-blue-600 px-6 text-lg font-extrabold text-white">
            Add stock
          </Link>
        </section>
      )}

      {!empty && products.data && shown.length === 0 && (
        <p className="rounded-2xl bg-slate-100 p-4 text-center font-semibold text-slate-600">
          {filter === 'low' ? 'Nothing is running low. 👍' : filter === 'noprice' ? 'Every item has both prices. 👍' : 'Nothing matches that search.'}
        </p>
      )}

      {shown.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border-2 border-slate-100 bg-white shadow-sm">
          <table className="w-full table-fixed border-collapse">
            <colgroup>
              <col className="w-[29%]" />
              <col className="w-[12%]" />
              <col className="w-[17%]" />
              <col className="w-[13%]" />
              <col className="w-[13%]" />
              <col className="w-[16%]" />
            </colgroup>
            <thead className="bg-slate-50">
              <tr>
                {th('name', 'Item', 'pl-3')}
                {th('qty', 'Qty', 'text-right')}
                {th(null, 'Unit', 'pl-2')}
                {th(null, 'Sell', 'text-right')}
                {th(null, 'Cost', 'text-right')}
                {th('margin', 'Margin', 'pr-3 text-right')}
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const low = isLow(p);
                const m = marginOf(p);
                return (
                  <tr key={p.id} onClick={() => setEditing(p)} className="cursor-pointer border-t border-slate-100 active:bg-slate-50">
                    <td className="py-2.5 pl-3 pr-1">
                      <span className="line-clamp-2 break-words text-[15px] font-bold leading-snug text-slate-900">{p.name}</span>
                      {p.local_name && <span className="block truncate text-xs text-slate-500">{p.local_name}</span>}
                    </td>
                    <td className={cx('px-1 text-right text-[15px] font-extrabold tabular-nums', low ? 'text-amber-600' : 'text-slate-900')}>
                      {Number(p.stock_qty.toFixed(3))}
                      {low && <span className="block text-[10px] font-bold uppercase">low</span>}
                    </td>
                    <td className="truncate pl-2 pr-1 text-xs text-slate-600">{p.unit}</td>
                    <td className="px-1 text-right text-[15px] font-semibold tabular-nums">
                      {p.sell_price > 0 ? p.sell_price : <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[11px] font-extrabold text-red-700">Set</span>}
                    </td>
                    <td className="px-1 text-right text-[15px] tabular-nums text-slate-600">
                      {Number(p.cost_price) > 0 ? p.cost_price : <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[11px] font-extrabold text-red-700">Set</span>}
                    </td>
                    <td className="py-2.5 pl-1 pr-3 text-right tabular-nums">
                      {m ? (
                        <>
                          <span className={cx('block text-[15px] font-extrabold', m.amount >= 0 ? 'text-emerald-700' : 'text-red-600')}>
                            {m.amount >= 0 ? '' : '−'}₹{Math.abs(m.amount)}
                          </span>
                          <span className={cx('block text-xs font-semibold', m.amount >= 0 ? 'text-emerald-600' : 'text-red-500')}>{m.pct.toFixed(0)}%</span>
                        </>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {shown.length > 0 && <p className="mt-2 text-center text-xs text-slate-400">Tap any item to change its price or stock.</p>}

      {editing && (
        <EditProductSheet
          key={editing.id}
          product={editing}
          onClose={() => setEditing(null)}
          onChanged={(p) => {
            setEditing(p);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

interface DetailsForm {
  name: string;
  brand: string;
  local_name: string;
  category: string;
  unit: string;
  sell_price: string;
  cost_price: string;
  low_stock_threshold: string;
}

function EditProductSheet({ product, onClose, onChanged }: { product: ProductOut; onClose: () => void; onChanged: (p: ProductOut) => void }) {
  const toast = useToast();
  const [form, setForm] = useState<DetailsForm>({
    name: product.name,
    brand: product.brand,
    local_name: product.local_name ?? '',
    category: product.category,
    unit: product.unit,
    sell_price: String(product.sell_price),
    cost_price: product.cost_price === null ? '' : String(product.cost_price),
    low_stock_threshold: String(product.low_stock_threshold),
  });

  // (a) add / remove — always in the product's own unit
  const [adjQty, setAdjQty] = useState('');
  const [reason, setReason] = useState<StockAdjustReason>('restock');
  const [adjNote, setAdjNote] = useState('');

  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : (e as Error).message);

  const history = useQuery({
    queryKey: ['products', 'ledger', product.id],
    queryFn: () => api.products.ledger(product.id, 20),
  });

  const update = useMutation({
    mutationFn: () => {
      const body: ProductPatch = {
        name: form.name.trim(),
        brand: form.brand.trim(),
        local_name: form.local_name.trim(), // empty string clears it
        category: form.category.trim(),
        unit: form.unit.trim(),
        sell_price: Number(form.sell_price) || 0,
        cost_price: numOrNull(form.cost_price),
        low_stock_threshold: Number(form.low_stock_threshold) || 0,
      };
      return api.products.update(product.id, body);
    },
    onSuccess: (p) => {
      toast.success('Saved');
      onChanged(p);
    },
    onError: onErr,
  });

  const adjust = useMutation({
    mutationFn: (sign: 1 | -1) =>
      api.products.addStock(product.id, { delta_qty: sign * Number(adjQty), reason, note: adjNote.trim() || undefined }),
    onSuccess: (p, sign) => {
      toast.success(`${sign > 0 ? 'Added' : 'Removed'}. Stock now ${formatStock(p.stock_qty, p.unit)}`);
      setAdjQty('');
      setAdjNote('');
      onChanged(p);
    },
    onError: onErr,
  });

  /** Prices on their own, so setting a price cannot touch the name, unit or anything else. */
  const savePrices = useMutation({
    mutationFn: () =>
      api.products.update(product.id, {
        sell_price: Number(form.sell_price) || 0,
        cost_price: numOrNull(form.cost_price),
      }),
    onSuccess: (p) => {
      toast.success(`Price set: ${fmtMoney(p.sell_price)} per ${p.unit}`);
      onChanged(p);
    },
    onError: onErr,
  });
  const toggleActive = useMutation({
    mutationFn: () => api.products.update(product.id, { is_active: !product.is_active }),
    onSuccess: (p) => {
      toast.success(p.is_active ? 'Product activated' : 'Product deactivated');
      onChanged(p);
    },
    onError: onErr,
  });

  const adjN = Number(adjQty);
  const adjValid = adjQty.trim() !== '' && Number.isFinite(adjN) && adjN > 0;
  const current = formatStock(product.stock_qty, product.unit);
  const low = isLow(product);

  const sell = Number(form.sell_price) || 0;
  const cost = numOrNull(form.cost_price);
  const margin = cost === null || cost <= 0 || sell <= 0
    ? null
    : { amount: round2(sell - cost), percent: cost > 0 ? ((sell - cost) / cost) * 100 : null };
  // Both prices or neither: a selling price with no cost hides the margin, and a cost with no selling
  // price lets the item be billed at zero.
  const pricesOk = sell > 0 && cost !== null && cost > 0;
  const pricesChanged =
    sell !== Number(product.sell_price) || numOrNull(form.cost_price) !== (product.cost_price ?? null);

  return (
    // 88dvh, not 94vh: on a phone `vh` counts the space behind the address bar, and the on-screen
    // keyboard shrinks the viewport further, so the top of the sheet -- and the only way out of it --
    // was pushed above the glass. `dvh` follows the space that is actually visible.
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="flex max-h-[88dvh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Sticky, so the way out stays on screen however far the sheet is scrolled. */}
        <div className="sticky top-0 z-10 rounded-t-2xl border-b border-slate-100 bg-white">
          <div className="flex justify-center pt-2" aria-hidden>
            <span className="h-1 w-10 rounded-full bg-slate-300" />
          </div>
          <div className="flex items-start justify-between gap-2 px-4 pb-2 pt-1.5">
            <div className="min-w-0 pt-1">
              <h2 className="truncate text-base font-semibold">
                {product.name} <span className="text-xs font-normal text-slate-400">{product.code}</span>
              </h2>
              {product.local_name && <p className="truncate text-sm text-slate-500">{product.local_name}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-2xl leading-none text-slate-600 active:bg-slate-200"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4 pt-3">
          {/* Price first. It is what a shopkeeper opens a product for: the wholesaler's rate is on the
              bill, the margin is theirs to decide, and neither should be behind a scroll. */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              savePrices.mutate();
            }}
            className="rounded-xl border-2 border-primary/30 bg-primary/5 p-3"
          >
            <div className="flex items-baseline justify-between gap-2">
              <p className={sectionTitle}>Price per {product.unit}</p>
              <p className={cx('text-right text-sm font-semibold', low ? 'text-amber-700' : 'text-slate-600')}>
                {current} in stock {low ? <LowBadge /> : null}
              </p>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="text-xs font-medium text-slate-700">
                Selling price ₹
                <input
                  className={cx(bigField, !(sell > 0) && '!border-2 !border-red-500 !bg-red-50')}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  placeholder="Required"
                  value={form.sell_price}
                  onChange={(e) => setForm({ ...form, sell_price: e.target.value })}
                />
              </label>
              <label className="text-xs text-slate-600">
                Cost price ₹
                <input
                  className={cx(bigField, !(cost !== null && cost > 0) && '!border-2 !border-red-500 !bg-red-50')}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  placeholder="Required"
                  value={form.cost_price}
                  onChange={(e) => setForm({ ...form, cost_price: e.target.value })}
                />
              </label>
            </div>

            <p className="mt-1.5 min-h-[18px] text-xs">
              {margin === null ? (
                <span className="font-semibold text-red-600">Both prices are needed to save.</span>
              ) : (
                <span className={margin.amount >= 0 ? 'font-medium text-emerald-700' : 'font-medium text-red-700'}>
                  Margin {fmtMoney(margin.amount)} per {product.unit}
                  {margin.percent !== null && ` · ${margin.percent.toFixed(0)}%`}
                </span>
              )}
            </p>

            <button
              type="submit"
              disabled={savePrices.isPending || !pricesChanged || !pricesOk}
              className="mt-2 min-h-[50px] w-full rounded-xl bg-primary text-base font-bold text-white disabled:bg-slate-300"
            >
              {savePrices.isPending ? 'Saving…' : !pricesOk ? 'Fill both prices' : pricesChanged ? 'Set price' : 'Price saved'}
            </button>
          </form>

          {/* (a) Add or remove stock */}
          <section className="rounded-xl border border-slate-200 p-3">
            <p className={sectionTitle}>Add or remove stock</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="text-xs text-slate-600">
                Qty ({product.unit})
                <input type="number" inputMode="decimal" min={0} step="any" value={adjQty} onChange={(e) => setAdjQty(e.target.value)} placeholder="0" className={field} />
              </label>
              <label className="text-xs text-slate-600">
                Reason
                <select value={reason} onChange={(e) => setReason(e.target.value as StockAdjustReason)} className={field}>
                  {STOCK_ADJUST_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </label>
              <label className="col-span-2 text-xs text-slate-600">
                Note
                <input value={adjNote} onChange={(e) => setAdjNote(e.target.value)} placeholder="Optional" className={field} />
              </label>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={!adjValid || adjust.isPending}
                onClick={() => adjust.mutate(1)}
                className="min-h-[44px] rounded-lg bg-primary font-semibold text-white disabled:bg-slate-300"
              >
                {adjust.isPending && adjust.variables === 1 ? 'Adding…' : 'Add'}
              </button>
              <button
                type="button"
                disabled={!adjValid || adjust.isPending}
                onClick={() => adjust.mutate(-1)}
                className="min-h-[44px] rounded-lg border border-red-300 bg-red-50 font-semibold text-red-700 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
              >
                {adjust.isPending && adjust.variables === -1 ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </section>

          {/* (c) Stock history */}
          <section className="rounded-xl border border-slate-200 p-3">
            <p className={sectionTitle}>Stock history</p>
            {history.isLoading && <p className="mt-2 text-sm text-slate-500">Loading…</p>}
            {history.isError && (
              <p className="mt-2 text-sm text-red-600">
                {(history.error as Error).message}{' '}
                <button type="button" className="underline" onClick={() => history.refetch()}>Retry</button>
              </p>
            )}
            {history.data && history.data.length === 0 && <p className="mt-2 text-sm text-slate-400">No stock changes yet.</p>}
            {history.data && history.data.length > 0 && (
              <ul className="mt-1 divide-y divide-slate-100">
                {history.data.slice(0, 20).map((m) => (
                  <li key={m.id} className="flex items-start justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-800">{movementReasonLabel(m.reason)}</div>
                      <div className="text-[11px] text-slate-500">{fmtDateTime(m.created_at)}</div>
                      {m.note && <div className="truncate text-[11px] text-slate-500">{m.note}</div>}
                    </div>
                    <div className="shrink-0 text-right">
                      <div className={cx('text-sm font-semibold', m.delta_qty > 0 ? 'text-emerald-700' : m.delta_qty < 0 ? 'text-red-700' : 'text-slate-600')}>
                        {formatSignedQty(m.delta_qty, product.unit)}
                      </div>
                      <div className="text-[11px] text-slate-500">Balance: {formatStock(m.balance_after, product.unit)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Everything a shopkeeper sets once and rarely touches again, folded away. */}
          <details className="rounded-xl border border-slate-200">
            <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between px-3 py-2">
              <span className={sectionTitle}>Name, unit and other details</span>
              <span className="text-slate-400">▾</span>
            </summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              update.mutate();
            }}
            className="border-t border-slate-100 p-3"
          >
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="col-span-2 text-xs text-slate-600">Name<input className={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
              <label className="col-span-2 text-xs text-slate-600">
                Local name
                <input className={field} value={form.local_name} onChange={(e) => setForm({ ...form, local_name: e.target.value })} placeholder={LOCAL_NAME_PLACEHOLDER} />
                <span className="mt-0.5 block text-[11px] text-slate-500">{LOCAL_NAME_HELP}</span>
              </label>
              <label className="text-xs text-slate-600">Brand<input className={field} value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></label>
              <label className="text-xs text-slate-600">Category<input className={field} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></label>
              <label className="text-xs text-slate-600">
                Unit
                <input
                  className={field}
                  list="edit-product-units"
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  required
                />
                <datalist id="edit-product-units">
                  {COMMON_UNITS.map((u) => <option key={u} value={u} />)}
                </datalist>
              </label>
              <label className="text-xs text-slate-600">
                Low stock at ({form.unit || 'unit'})
                <input className={field} type="number" inputMode="decimal" min={0} step="any" value={form.low_stock_threshold} onChange={(e) => setForm({ ...form, low_stock_threshold: e.target.value })} />
              </label>
            </div>
            <button type="submit" disabled={update.isPending} className="mt-3 min-h-[48px] w-full rounded-lg bg-primary font-semibold text-white disabled:opacity-60">
              {update.isPending ? 'Saving…' : 'Save details'}
            </button>
            <button type="button" onClick={() => toggleActive.mutate()} disabled={toggleActive.isPending} className="mt-2 min-h-[44px] w-full rounded-lg border border-slate-300 text-sm font-medium text-slate-600">
              {product.is_active ? 'Deactivate product' : 'Activate product'}
            </button>
          </form>
          </details>

          {/* A phone is held at the bottom. Reaching the × at the top needs a second hand. */}
          <button
            type="button"
            onClick={onClose}
            className="mb-[max(env(safe-area-inset-bottom),8px)] min-h-[52px] w-full rounded-xl border border-slate-300 bg-white font-semibold text-slate-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
