import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
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

/** A product added by a stock-in has a cost but no selling price yet: the margin is the shop's to set.
 *  Without this badge it would sit in the list at zero and could be sold for nothing. */
function NoPriceBadge() {
  return <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-red-800">Set price</span>;
}

export default function Products() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [editing, setEditing] = useState<ProductOut | null>(null);
  const [adding, setAdding] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const products = useQuery({
    queryKey: ['products', debounced, lowOnly],
    queryFn: () => api.products.list(debounced || undefined, lowOnly),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['products'] });

  const noProductsAtAll = !!products.data && products.data.length === 0 && !debounced && !lowOnly;

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-6 pt-4">
      {/* Exactly two ways to add stock, always here whether the list is empty or not. */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-primary-dark">Inventory</h1>
        <div className="flex gap-2">
          <Link to="/record?mode=stock_in" className="flex min-h-[44px] items-center rounded-lg border border-primary bg-white px-3 text-sm font-semibold text-primary">
            By voice
          </Link>
          <Link to="/scan?mode=stock_in" className="flex min-h-[44px] items-center rounded-lg border border-primary bg-white px-3 text-sm font-semibold text-primary">
            By photo
          </Link>
          <button type="button" onClick={() => setAdding(true)} className="min-h-[44px] rounded-lg bg-primary px-3 text-sm font-semibold text-white">
            + Add product
          </button>
        </div>
      </div>

      {!noProductsAtAll && (
        <div className="mb-3 flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products" inputMode="search" className={cx(field, 'flex-1')} />
          <button
            type="button"
            onClick={() => setLowOnly((v) => !v)}
            aria-pressed={lowOnly}
            className={cx('min-h-[44px] whitespace-nowrap rounded-lg border px-3 text-xs font-semibold', lowOnly ? 'border-amber-500 bg-amber-100 text-amber-800' : 'border-slate-300 bg-white text-slate-600')}
          >
            Low stock
          </button>
        </div>
      )}

      {adding && (
        <div className="mb-3">
          <AddProductInline
            initialName={q}
            onCancel={() => setAdding(false)}
            onCreated={() => {
              setAdding(false);
              toast.success('Product added');
              invalidate();
            }}
          />
        </div>
      )}

      {products.isLoading && <p className="py-6 text-center text-sm text-slate-500">Loading…</p>}
      {products.isError && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{(products.error as Error).message}</p>}

      {noProductsAtAll && !adding && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 text-center">
          <p className="font-semibold text-slate-800">Your inventory is empty</p>
          <p className="mt-1 text-sm text-slate-500">Add a product, or add by voice, above.</p>
        </section>
      )}
      {products.data && products.data.length === 0 && !noProductsAtAll && (
        <p className="rounded-xl bg-slate-100 p-4 text-center text-sm text-slate-600">{lowOnly ? 'Nothing is low on stock.' : 'No products match your search.'}</p>
      )}

      <ul className="space-y-2">
        {products.data?.map((p) => {
          const low = isLow(p);
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setEditing(p)}
                className={cx('flex min-h-[64px] w-full items-center gap-3 rounded-xl border bg-white px-3 py-2 text-left', !p.is_active && 'opacity-50', low ? 'border-amber-300' : 'border-slate-200')}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{p.name}</div>
                  {p.local_name && <div className="truncate text-sm text-slate-500">{p.local_name}</div>}
                  <div className="truncate text-xs text-slate-500">
                    {p.brand ? p.brand + ' · ' : ''}
                    {p.code} · {fmtMoney(p.sell_price)}/{p.unit}
                  </div>
                </div>
                <div className="max-w-[45%] shrink-0 text-right">
                  <div className={cx('text-sm font-bold leading-tight', low ? 'text-amber-700' : 'text-slate-800')}>{formatStock(p.stock_qty, p.unit)}</div>
                  {(low || p.sell_price <= 0) && (
                    <div className="mt-1 flex flex-wrap justify-end gap-1">
                      {p.sell_price <= 0 && <NoPriceBadge />}
                      {low && <LowBadge />}
                    </div>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>

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
                  className={bigField}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={form.sell_price}
                  onChange={(e) => setForm({ ...form, sell_price: e.target.value })}
                />
              </label>
              <label className="text-xs text-slate-600">
                Cost price ₹
                <input
                  className={bigField}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  placeholder="Optional"
                  value={form.cost_price}
                  onChange={(e) => setForm({ ...form, cost_price: e.target.value })}
                />
              </label>
            </div>

            <p className="mt-1.5 min-h-[18px] text-xs">
              {margin === null ? (
                <span className="text-slate-500">Add a cost price to see your margin.</span>
              ) : (
                <span className={margin.amount >= 0 ? 'font-medium text-emerald-700' : 'font-medium text-red-700'}>
                  Margin {fmtMoney(margin.amount)} per {product.unit}
                  {margin.percent !== null && ` · ${margin.percent.toFixed(0)}%`}
                </span>
              )}
            </p>

            <button
              type="submit"
              disabled={savePrices.isPending || !pricesChanged}
              className="mt-2 min-h-[50px] w-full rounded-xl bg-primary text-base font-bold text-white disabled:bg-slate-300"
            >
              {savePrices.isPending ? 'Saving…' : pricesChanged ? 'Set price' : 'Price saved'}
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
