import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import ProductPicker from '../components/ProductPicker';
import { useToast } from '../components/Toast';
import { api, ApiError } from '../lib/api';
import { COMMON_UNITS } from '../lib/constants';
import { PickedProduct, defaultUnitPrice, round2 } from '../lib/reviewModel';
import { formatStock } from '../lib/stock';
import { PaymentMode, TransactionIn } from '../lib/types';
import { cx, fmtMoney } from '../lib/utils';

interface Row {
  key: string;
  product: PickedProduct | null;
  qty: string;
  unit: string;
  cost: string;
  /** true once the user typed a cost, so changing product/unit keeps it */
  costTouched: boolean;
}

let rowSeq = 0;
function newRow(): Row {
  rowSeq += 1;
  return { key: `si-${Date.now()}-${rowSeq}`, product: null, qty: '', unit: '', cost: '', costTouched: false };
}

function priceStr(n: number | null): string {
  return n === null ? '' : String(n);
}

function rowTotal(r: Row): number {
  return round2((Number(r.qty) || 0) * (Number(r.cost) || 0));
}

const field =
  'min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-2 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:bg-slate-100';

export default function StockIn() {
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();

  const [rows, setRows] = useState<Row[]>(() => [newRow()]);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [supplier, setSupplier] = useState('');
  const [payment, setPayment] = useState<PaymentMode>('cash');
  const [note, setNote] = useState('');
  const [showDetails, setShowDetails] = useState(false);

  const total = useMemo(() => round2(rows.reduce((s, r) => s + rowTotal(r), 0)), [rows]);
  const ready = rows.length > 0 && rows.every((r) => r.product && Number(r.qty) > 0);
  const pickerRow = rows.find((r) => r.key === pickerFor) ?? null;

  const patchRow = (key: string, fn: (r: Row) => Row) => setRows((prev) => prev.map((r) => (r.key === key ? fn(r) : r)));

  const pickProduct = (key: string, p: PickedProduct) => {
    patchRow(key, (r) => ({ ...r, product: p, unit: p.unit, cost: r.costTouched ? r.cost : priceStr(defaultUnitPrice(p, 'cost')) }));
    setPickerFor(null);
  };

  const setUnit = (key: string, unit: string) => patchRow(key, (r) => ({ ...r, unit }));

  const addRow = () => {
    const r = newRow();
    setRows((prev) => [...prev, r]);
    setPickerFor(r.key);
  };

  const removeRow = (key: string) => setRows((prev) => prev.filter((r) => r.key !== key));

  const submit = useMutation({
    mutationFn: () => {
      const body: TransactionIn = {
        voice_session_id: null,
        type: 'purchase',
        llm_intent: null,
        deleted_item_indexes: [],
        items: rows.map((r) => ({
          item_index: null,
          product_code: r.product!.code,
          qty: Number(r.qty),
          unit: r.unit,
          unit_price: Number(r.cost) || 0,
          spoken_span: null,
          llm_product_code: null,
          llm_confidence: null,
        })),
        customer_name: supplier.trim() || null,
        payment_mode: payment,
        notes: note.trim() || null,
      };
      return api.transactions.create(body);
    },
    onSuccess: () => {
      const n = rows.length;
      toast.success(`Stock added: ${n} item${n === 1 ? '' : 's'}`);
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['transactions'] });
      nav('/products');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : (e as Error).message),
  });

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-44 pt-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-primary-dark">Stock in</h1>
          <p className="text-xs text-slate-500">Type the stock you received</p>
        </div>
        <Link to="/products" className="flex min-h-[44px] items-center rounded-lg px-2 text-sm font-medium text-primary">
          ← Inventory
        </Link>
      </header>

      <button
        type="button"
        onClick={() => nav('/?mode=stock_in')}
        className="mb-3 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-primary/40 bg-white text-sm font-semibold text-primary"
      >
        <MicIcon className="h-5 w-5" />
        Speak it instead
      </button>

      <ul className="space-y-2">
        {rows.map((r, idx) => {
          return (
            <li key={r.key} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => setPickerFor(r.key)}
                  className={cx(
                    'min-h-[48px] min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-left',
                    r.product ? 'border-slate-300 bg-white' : 'border-dashed border-primary/60 bg-white',
                  )}
                >
                  {r.product ? (
                    <>
                      <div className="truncate font-semibold text-slate-900">{r.product.name}</div>
                      {r.product.local_name && <div className="truncate text-sm text-slate-500">{r.product.local_name}</div>}
                      <div className="truncate text-xs text-slate-500">In stock: {formatStock(r.product.stock_qty, r.product.unit)}</div>
                    </>
                  ) : (
                    <>
                      <div className="font-semibold text-primary">Choose product ▾</div>
                      <div className="text-xs text-slate-500">Search, or add a new product</div>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => removeRow(r.key)}
                  aria-label={`Remove row ${idx + 1}`}
                  className="min-h-[44px] min-w-[44px] shrink-0 rounded-lg text-2xl leading-none text-slate-400 hover:bg-red-100 hover:text-red-600"
                >
                  ×
                </button>
              </div>

              <div className="mt-2 grid grid-cols-[1fr_1.2fr_1.3fr] gap-2">
                <label className="text-[11px] text-slate-500">
                  Qty
                  <input
                    className={field}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={r.qty}
                    placeholder="0"
                    onChange={(e) => patchRow(r.key, (x) => ({ ...x, qty: e.target.value }))}
                  />
                </label>
                <label className="text-[11px] text-slate-500">
                  Unit
                  <input
                    className={field}
                    list="stock-in-units"
                    value={r.unit}
                    placeholder="e.g. kg"
                    onChange={(e) => setUnit(r.key, e.target.value)}
                  />
                  <datalist id="stock-in-units">
                    {COMMON_UNITS.map((u) => (
                      <option key={u} value={u} />
                    ))}
                  </datalist>
                </label>
                <label className="text-[11px] text-slate-500">
                  Cost per unit ₹
                  <input
                    className={field}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={r.cost}
                    placeholder="0"
                    onChange={(e) => patchRow(r.key, (x) => ({ ...x, cost: e.target.value, costTouched: true }))}
                  />
                </label>
              </div>
              <p className="mt-2 text-right text-sm font-semibold text-slate-800">= {fmtMoney(rowTotal(r))}</p>
            </li>
          );
        })}
      </ul>
      {rows.length === 0 && <p className="rounded-xl bg-slate-100 p-3 text-center text-sm text-slate-600">No rows. Add one below.</p>}

      <button type="button" onClick={addRow} className="mt-3 min-h-[48px] w-full rounded-xl border-2 border-dashed border-primary/50 font-semibold text-primary">
        + Add row
      </button>

      {!showDetails && (
        <button
          type="button"
          onClick={() => setShowDetails(true)}
          className="mt-3 min-h-[44px] w-full rounded-xl px-3 text-left text-sm font-medium text-slate-500"
        >
          + Supplier, payment or note
        </button>
      )}

      <section className={cx('mt-4 space-y-3 rounded-xl border border-slate-200 bg-white p-3', !showDetails && 'hidden')}>
        <label className="block text-xs text-slate-600">
          Supplier name (optional)
          <input className={cx(field, 'px-3')} value={supplier} onChange={(e) => setSupplier(e.target.value)} />
        </label>
        <div>
          <p className="text-xs text-slate-600">Payment</p>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {(['cash', 'upi', 'credit'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setPayment(m)}
                aria-pressed={payment === m}
                className={cx(
                  'min-h-[44px] rounded-lg border text-xs font-semibold uppercase',
                  payment === m ? 'border-primary bg-primary text-white' : 'border-slate-300 bg-white text-slate-600',
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <label className="block text-xs text-slate-600">
          Note (optional)
          <input className={cx(field, 'px-3')} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. invoice number" />
        </label>
      </section>

      <div className="fixed inset-x-0 bottom-[60px] z-30 border-t border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-2">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                Total · {rows.length} item{rows.length === 1 ? '' : 's'}
              </div>
              <div className="text-2xl font-bold text-slate-900">{fmtMoney(total)}</div>
            </div>
            <button
              type="button"
              onClick={() => submit.mutate()}
              disabled={!ready || submit.isPending}
              className="min-h-[52px] rounded-xl bg-primary px-6 text-base font-semibold text-white disabled:bg-slate-300"
            >
              {submit.isPending ? 'Saving…' : 'Add stock'}
            </button>
          </div>
          {!ready && rows.length > 0 && <p className="mt-1 text-[11px] text-slate-500">Every row needs a product and a quantity above 0.</p>}
        </div>
      </div>

      <ProductPicker
        open={!!pickerRow}
        onClose={() => setPickerFor(null)}
        onSelect={(p) => pickerRow && pickProduct(pickerRow.key, p)}
        currentCode={pickerRow?.product?.code ?? null}
      />
    </div>
  );
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
    </svg>
  );
}
