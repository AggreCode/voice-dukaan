import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { PickedProduct, toPicked } from '../lib/reviewModel';
import { formatStock } from '../lib/stock';
import { cx, fmtMoney } from '../lib/utils';
import { AddProductInline } from './AddProductInline';

interface Alternative { product_id: string; confidence: number }

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (p: PickedProduct) => void;
  alternatives?: Alternative[];
  /** Products known from the session (to resolve alternative codes to names). */
  knownProducts?: PickedProduct[];
  currentCode?: string | null;
  initialQuery?: string;
}

export default function ProductPicker({ open, onClose, onSelect, alternatives = [], knownProducts = [], currentCode, initialQuery = '' }: Props) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ(initialQuery);
      setDebounced(initialQuery);
      setShowAdd(false);
      window.setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, initialQuery]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const search = useQuery({
    queryKey: ['products', 'search', debounced],
    queryFn: () => api.products.list(debounced || undefined),
    enabled: open,
    staleTime: 30_000,
  });

  const known = useMemo(() => {
    const m = new Map<string, PickedProduct>();
    knownProducts.forEach((p) => m.set(p.code, p));
    (search.data ?? []).forEach((p) => m.set(p.code, toPicked(p)));
    return m;
  }, [knownProducts, search.data]);

  const alts = useMemo(
    () =>
      [...alternatives]
        .sort((a, b) => b.confidence - a.confidence)
        .map((a) => ({ ...a, product: known.get(a.product_id) ?? null })),
    [alternatives, known],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between px-4 pt-3">
          <h2 className="text-base font-semibold">Pick product</h2>
          <button type="button" onClick={onClose} className="min-h-[44px] min-w-[44px] rounded-full text-2xl leading-none text-slate-500" aria-label="Close">
            ×
          </button>
        </div>

        <div className="px-4 pb-2 pt-2">
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name / brand / alias…"
            className="min-h-[48px] w-full rounded-xl border border-slate-300 px-3 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            inputMode="search"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom),16px)]">
          {alts.length > 0 && !debounced && (
            <div className="mb-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Suggestions</p>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {alts.map((a) => (
                  <li key={a.product_id}>
                    <button
                      type="button"
                      disabled={!a.product}
                      onClick={() => a.product && onSelect(a.product)}
                      className={cx(
                        'flex min-h-[56px] w-full items-center gap-3 px-3 py-2 text-left disabled:opacity-50',
                        a.product_id === currentCode && 'bg-primary-light/60',
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{a.product?.name ?? a.product_id}</div>
                        {a.product?.local_name && <div className="truncate text-sm text-slate-500">{a.product.local_name}</div>}
                        <div className="truncate text-xs text-slate-500">
                          {a.product ? `${a.product.brand ? a.product.brand + ' · ' : ''}${fmtMoney(a.product.sell_price)}/${a.product.unit} · stock ${formatStock(a.product.stock_qty, a.product.unit)}` : 'not in catalogue'}
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-slate-100">
                          <div
                            className={cx(
                              'h-full rounded',
                              a.confidence >= 0.9 ? 'bg-emerald-500' : a.confidence >= 0.75 ? 'bg-amber-500' : 'bg-red-500',
                            )}
                            style={{ width: `${Math.round(a.confidence * 100)}%` }}
                          />
                        </div>
                      </div>
                      <span className="text-xs font-semibold text-slate-600">{Math.round(a.confidence * 100)}%</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {debounced ? `Results for "${debounced}"` : 'All products'}
          </p>
          {search.isLoading && <p className="py-3 text-sm text-slate-500">Searching…</p>}
          {search.isError && <p className="py-3 text-sm text-red-600">{(search.error as Error).message}</p>}
          {search.data && search.data.length === 0 && <p className="py-3 text-sm text-slate-500">No products found.</p>}
          {search.data && search.data.length > 0 && (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {search.data.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(toPicked(p))}
                    className={cx('flex min-h-[52px] w-full items-center gap-3 px-3 py-2 text-left', p.code === currentCode && 'bg-primary-light/60')}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{p.name}</div>
                      {p.local_name && <div className="truncate text-sm text-slate-500">{p.local_name}</div>}
                      <div className="truncate text-xs text-slate-500">
                        {p.brand ? p.brand + ' · ' : ''}
                        {fmtMoney(p.sell_price)}/{p.unit} · stock {formatStock(p.stock_qty, p.unit)}
                      </div>
                    </div>
                    <span className="text-xs text-slate-400">{p.code}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4">
            {!showAdd ? (
              <button
                type="button"
                onClick={() => setShowAdd(true)}
                className="min-h-[48px] w-full rounded-xl border-2 border-dashed border-primary/50 font-semibold text-primary"
              >
                + Add new product
              </button>
            ) : (
              <AddProductInline
                initialName={q}
                onCancel={() => setShowAdd(false)}
                onCreated={(p) => {
                  setShowAdd(false);
                  onSelect(p);
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
