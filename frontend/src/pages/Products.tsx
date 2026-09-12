import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { COMMON_UNITS, CSV_COLUMNS, LOCAL_NAME_HELP, LOCAL_NAME_PLACEHOLDER, STOCK_ADJUST_REASONS, movementReasonLabel } from '../lib/constants';
import { formatSignedQty, formatStock } from '../lib/stock';
import { ProductOut, ProductPatch, StockAdjustReason, numOrNull } from '../lib/types';
import { cx, fmtDateTime, fmtMoney } from '../lib/utils';
import { useToast } from '../components/Toast';
import { AddProductInline } from '../components/AddProductInline';

const field = 'min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30';
const sectionTitle = 'text-xs font-semibold uppercase tracking-wide text-slate-500';

function isLow(p: ProductOut): boolean {
  return p.stock_qty <= p.low_stock_threshold;
}

function LowBadge() {
  return <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-800">Low stock</span>;
}

export default function Products() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [editing, setEditing] = useState<ProductOut | null>(null);
  const [adding, setAdding] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const products = useQuery({
    queryKey: ['products', debounced, lowOnly],
    queryFn: () => api.products.list(debounced || undefined, lowOnly),
  });

  const importCsv = useMutation({
    mutationFn: (f: File) => api.products.importCsv(f),
    onSuccess: (r) => {
      toast.success(`Imported: ${r.created} created, ${r.updated} updated`);
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : (e as Error).message),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['products'] });
  const pickCsv = () => fileRef.current?.click();

  const noProductsAtAll = !!products.data && products.data.length === 0 && !debounced && !lowOnly;

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-6 pt-4">
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importCsv.mutate(f);
          e.target.value = '';
        }}
      />
      <div className="mb-3 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-primary-dark">Inventory</h1>
        <div className="flex gap-2">
          <Link to="/stock-in" className="flex min-h-[44px] items-center rounded-lg border border-primary bg-white px-3 text-sm font-semibold text-primary">
            Stock in
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
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="font-semibold text-slate-800">Your inventory is empty</p>
          <p className="mt-1 text-sm text-slate-500">Choose how to add your products.</p>
          <div className="mt-3 space-y-2">
            <button type="button" onClick={() => setAdding(true)} className="flex min-h-[56px] w-full flex-col items-start justify-center rounded-xl border border-slate-200 px-3 py-2 text-left hover:border-primary">
              <span className="font-semibold text-primary">Add a product</span>
              <span className="text-xs text-slate-500">Type name, units, prices and opening stock.</span>
            </button>
            <button
              type="button"
              onClick={pickCsv}
              disabled={importCsv.isPending}
              className="flex min-h-[56px] w-full flex-col items-start justify-center rounded-xl border border-slate-200 px-3 py-2 text-left hover:border-primary disabled:opacity-60"
            >
              <span className="font-semibold text-primary">{importCsv.isPending ? 'Importing…' : 'Import a CSV'}</span>
              <span className="text-xs text-slate-500">Columns: {CSV_COLUMNS}. Only name is required.</span>
            </button>
            <button type="button" onClick={() => nav('/?mode=stock_in')} className="flex min-h-[56px] w-full flex-col items-start justify-center rounded-xl border border-slate-200 px-3 py-2 text-left hover:border-primary">
              <span className="font-semibold text-primary">Speak your stock</span>
              <span className="text-xs text-slate-500">Say what you have, e.g. “Paracetamol 10 strips, ORS 5 packets”.</span>
            </button>
          </div>
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
                  {low && (
                    <div className="mt-1">
                      <LowBadge />
                    </div>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {products.data && products.data.length > 0 && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
          <button type="button" onClick={pickCsv} disabled={importCsv.isPending} className="min-h-[44px] w-full rounded-lg border border-slate-300 text-sm font-medium text-slate-700 disabled:opacity-60">
            {importCsv.isPending ? 'Importing…' : 'Import products from CSV'}
          </button>
          <p className="mt-1 text-[11px] text-slate-500">Columns: {CSV_COLUMNS}.</p>
        </div>
      )}

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
  // (b) count
  const [countQty, setCountQty] = useState('');
  // aliases
  const [alias, setAlias] = useState('');
  const [aliasLang, setAliasLang] = useState('or');

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

  const count = useMutation({
    mutationFn: () => api.products.countStock(product.id, { counted_qty: Number(countQty) }),
    onSuccess: (p) => {
      toast.success(`Stock set to ${formatStock(p.stock_qty, p.unit)}`);
      setCountQty('');
      onChanged(p);
    },
    onError: onErr,
  });

  const addAlias = useMutation({
    mutationFn: () => api.products.addAlias(product.id, alias.trim(), aliasLang),
    onSuccess: (p) => {
      setAlias('');
      onChanged(p);
    },
    onError: onErr,
  });
  const delAlias = useMutation({
    mutationFn: (a: string) => api.products.deleteAlias(product.id, a),
    onSuccess: onChanged,
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
  const counted = numOrNull(countQty);
  const countValid = counted !== null && counted >= 0;
  const current = formatStock(product.stock_qty, product.unit);
  const after = countValid ? formatStock(counted, product.unit) : '—';
  const low = isLow(product);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="flex max-h-[94vh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="flex items-start justify-between gap-2 px-4 pt-3">
          <div className="min-w-0 pt-2">
            <h2 className="truncate text-base font-semibold">
              {product.name} <span className="text-xs font-normal text-slate-400">{product.code}</span>
            </h2>
            {product.local_name && <p className="truncate text-sm text-slate-500">{product.local_name}</p>}
          </div>
          <button type="button" onClick={onClose} className="min-h-[44px] min-w-[44px] shrink-0 rounded-full text-2xl leading-none text-slate-500" aria-label="Close">×</button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-2">
          {/* Current stock */}
          <section className="rounded-xl bg-slate-50 p-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className={sectionTitle}>In stock</p>
              <p className={cx('text-right text-lg font-bold', low ? 'text-amber-700' : 'text-slate-900')}>{current}</p>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-500">
              <span>{low ? <LowBadge /> : null}</span>
            </div>
          </section>

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

          {/* (b) Correct stock count */}
          <section className="rounded-xl border border-slate-200 p-3">
            <p className={sectionTitle}>Correct stock count</p>
            <div className="mt-2 grid grid-cols-[1fr_auto] items-end gap-2">
              <label className="text-xs text-slate-600">
                I counted ({product.unit})
                <input type="number" inputMode="decimal" min={0} step="any" value={countQty} onChange={(e) => setCountQty(e.target.value)} placeholder="0" className={field} />
              </label>
              <button
                type="button"
                disabled={!countValid || count.isPending}
                onClick={() => count.mutate()}
                className="min-h-[44px] rounded-lg bg-primary px-4 font-semibold text-white disabled:bg-slate-300"
              >
                {count.isPending ? 'Saving…' : 'Set'}
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-600">
              Current: {current}. After: {after}.
            </p>
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

          {/* Aliases */}
          <section className="rounded-xl border border-slate-200 p-3">
            <p className={sectionTitle}>Aliases</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {product.aliases.length === 0 && <span className="text-xs text-slate-400">None yet</span>}
              {product.aliases.map((a) => (
                <span key={a} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-1 pl-3 pr-1 text-sm">
                  {a}
                  <button type="button" aria-label={`Remove ${a}`} onClick={() => delAlias.mutate(a)} className="flex h-7 w-7 items-center justify-center rounded-full text-slate-500 hover:bg-red-100 hover:text-red-600">×</button>
                </span>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (alias.trim()) addAlias.mutate();
              }}
              className="mt-2 flex gap-2"
            >
              <input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="New alias" className={cx(field, 'flex-1')} />
              <select value={aliasLang} onChange={(e) => setAliasLang(e.target.value)} className={cx(field, 'w-20')} aria-label="Alias language">
                <option value="or">or</option>
                <option value="hi">hi</option>
                <option value="en">en</option>
              </select>
              <button type="submit" disabled={!alias.trim() || addAlias.isPending} className="min-h-[44px] rounded-lg bg-primary px-3 font-semibold text-white disabled:bg-slate-300">Add</button>
            </form>
          </section>

          {/* Details */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              update.mutate();
            }}
            className="rounded-xl border border-slate-200 p-3"
          >
            <p className={sectionTitle}>Details</p>
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
              <label className="text-xs text-slate-600">Selling price (₹/{form.unit || 'unit'})<input className={field} type="number" inputMode="decimal" min={0} step="any" value={form.sell_price} onChange={(e) => setForm({ ...form, sell_price: e.target.value })} /></label>
              <label className="text-xs text-slate-600">Cost price (₹/{form.unit || 'unit'})<input className={field} type="number" inputMode="decimal" min={0} step="any" value={form.cost_price} placeholder="Optional" onChange={(e) => setForm({ ...form, cost_price: e.target.value })} /></label>
            </div>
            <button type="submit" disabled={update.isPending} className="mt-3 min-h-[48px] w-full rounded-lg bg-primary font-semibold text-white disabled:opacity-60">
              {update.isPending ? 'Saving…' : 'Save details'}
            </button>
            <button type="button" onClick={() => toggleActive.mutate()} disabled={toggleActive.isPending} className="mt-2 min-h-[44px] w-full rounded-lg border border-slate-300 text-sm font-medium text-slate-600">
              {product.is_active ? 'Deactivate product' : 'Activate product'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
