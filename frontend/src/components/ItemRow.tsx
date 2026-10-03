import { useState } from 'react';
import { COMMON_UNITS, extractionReasonLabel } from '../lib/constants';
import {
  Intent, Missing, PickedProduct, ReviewItem, baseQty, defaultUnitPrice, lineFactor, lineTotal, missingFields, newItemName,
  rowMargin,
} from '../lib/reviewModel';
import { formatStock } from '../lib/stock';
import { cx, fmtMoney } from '../lib/utils';
import { normalizeUnit, trimQty } from '../lib/units';
import { CheckIcon, TrashIcon } from './Icons';

interface Props {
  item: ReviewItem;
  index: number;
  intent: Intent;
  active: boolean;
  onChange: (next: ReviewItem) => void;
  onDelete: () => void;
  onPickProduct: () => void;
  onActivate: () => void;
  /** Where the line came from, so the evidence under it reads "Heard" or "Written". */
  source?: 'voice' | 'image' | 'manual';
  /** Buying: a product not in the inventory yet is created on save rather than being an error. */
  newItemOk?: boolean;
  /** An existing inventory product this line probably means, offered instead of creating a duplicate. */
  suggestion?: PickedProduct | null;
  onUseSuggestion?: () => void;
  /** Products this line could equally mean ("biscuit" with nine biscuits on the shelf). */
  choices?: PickedProduct[];
  onChoose?: (p: PickedProduct) => void;
  /** After a save attempt, empty required boxes turn red instead of amber. */
  showErrors?: boolean;
}

/**
 * One line of the bill.
 *
 * Empty boxes are amber, an invitation rather than an error, because a bare list of names is a fine
 * way to start a bill. Only after the shopkeeper presses Save do the ones still empty turn red, and
 * then only those boxes: never the whole line, never a message that leaves them hunting for what is
 * wrong.
 */
export default function ItemRow({
  item, index, intent, active, onChange, onDelete, onPickProduct, onActivate, source = 'voice', newItemOk = false,
  suggestion = null, onUseSuggestion, choices = [], onChoose, showErrors = false,
}: Props) {
  const buying = intent === 'purchase';
  const missing = new Set<Missing>(missingFields(item, intent));
  const isNew = !item.product && newItemOk;
  // Worth a "Check" only when something about WHICH product is in doubt. A missing quantity or unit
  // is already shown by its own yellow box; repeating it as a pill only crowds out the product's name.
  const needsReview = (item.original?.reason ?? '')
    .split(',')
    .map((r) => r.trim())
    .some((r) => r && !['no_quantity', 'no_quantity_evidence', 'unit_assumed', 'not_in_catalog'].includes(r))
    || (item.original?.needs_review === true && (item.original?.confidence ?? 1) < 0.6);
  const showChoices = choices.length > 1 && !!onChoose && (!item.product || needsReview);
  const reason = extractionReasonLabel(
    (item.original?.reason ?? '')
      .split(',')
      .filter((r) => !['not_in_catalog', 'no_quantity', 'unit_assumed', 'low_confidence'].includes(r.trim()))
      .join(','),
  );
  const margin = buying ? rowMargin(item) : null;
  // Prices are per the product's own unit; say which, so "120" reads as "120 a kilo".
  const per = normalizeUnit(item.product?.unit || item.unit) || 'unit';
  const factor = lineFactor(item);
  const converted = item.product && factor !== null && factor !== 1 && Number(item.qty) > 0;
  const mismatch = missing.has('unitMismatch');
  // What is being typed into the Amount box, kept apart from the calculated value so the box does not
  // rewrite itself under the shopkeeper's finger while they type "2.5".
  const [amountText, setAmountText] = useState<string | null>(null);

  const box = (field: Missing) =>
    cx(
      'mt-1 min-h-[52px] w-full rounded-xl border-2 px-3 text-lg font-semibold tabular-nums text-slate-900 focus:outline-none focus:ring-4',
      missing.has(field) || (field === 'unit' && mismatch)
        ? showErrors || (field === 'unit' && mismatch)
          ? 'border-red-500 bg-red-50 placeholder:text-red-400 focus:ring-red-200'
          : 'border-dashed border-amber-400 bg-amber-50/70 placeholder:text-amber-600/70 focus:ring-amber-200'
        : 'border-slate-200 bg-white focus:border-slate-400 focus:ring-slate-200',
    );
  const label = (field: Missing) =>
    cx('block text-xs font-bold uppercase tracking-wide',
      (missing.has(field) && showErrors) || (field === 'unit' && mismatch) ? 'text-red-600' : 'text-slate-500');

  const num = (v: string): number | null => (v.trim() === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

  return (
    <li
      onClick={onActivate}
      onFocus={onActivate}
      className={cx(
        'rounded-2xl border-2 bg-white p-3 shadow-sm transition-colors',
        active ? 'border-slate-400' : missing.size > 0 && showErrors ? 'border-red-300' : 'border-slate-100',
      )}
    >
      {/* ---- what it is ---- */}
      <div className="flex items-start gap-2">
        <span className="mt-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-600">
          {index + 1}
        </span>

        {isNew ? (
          <div className="min-w-0 flex-1">
            <input
              value={newItemName(item)}
              onChange={(e) => onChange({ ...item, newName: e.target.value })}
              placeholder="Item name"
              className={cx(
                'min-h-[52px] w-full rounded-xl border-2 border-blue-300 bg-blue-50/60 px-3 text-lg font-bold text-slate-900',
                'focus:outline-none focus:ring-4 focus:ring-blue-200',
              )}
            />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onActivate();
                onPickProduct();
              }}
              className="mt-1 min-h-[36px] text-sm font-semibold text-blue-700 underline"
            >
              New item · or choose from my stock
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onActivate();
              onPickProduct();
            }}
            className={cx(
              'min-h-[56px] min-w-0 flex-1 rounded-xl border-2 px-3 py-1.5 text-left',
              item.product
                ? 'border-slate-200 bg-white'
                : showErrors
                  ? 'border-red-500 bg-red-50'
                  : 'border-dashed border-amber-400 bg-amber-50/70',
            )}
          >
            {item.product ? (
              <>
                <span className="line-clamp-2 text-lg font-bold leading-snug text-slate-900">{item.product.name}</span>
                <span className="block truncate text-xs text-slate-500">
                  {item.product.local_name ? `${item.product.local_name} · ` : ''}
                  stock {formatStock(item.product.stock_qty, item.product.unit)}
                  {item.product.sell_price > 0 && ` · ${fmtMoney(item.product.sell_price)}/${item.product.unit}`}
                </span>
              </>
            ) : (
              <>
                <span className="block truncate text-lg font-bold text-amber-800">
                  {newItemName(item) || 'Choose item'} <span className="font-normal">▾</span>
                </span>
                <span className="block text-xs font-semibold text-amber-700">
                  {newItemName(item) ? 'Not in your stock — tap to choose' : 'Tap to choose from your stock'}
                </span>
              </>
            )}
          </button>
        )}

        <StatusPill product={!!item.product} isNew={isNew} needsReview={needsReview} />

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-slate-400 active:bg-red-50 active:text-red-600"
          aria-label={`Remove line ${index + 1}`}
        >
          <TrashIcon className="h-6 w-6" />
        </button>
      </div>

      {/* ---- "biscuit": which one? ---- */}
      {showChoices && (
        <div className="mt-2 rounded-xl border border-amber-300 bg-amber-50 p-2">
          <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-amber-800">Which one?</p>
          <div className="flex flex-wrap gap-1.5">
            {choices.slice(0, 4).map((c) => {
              const chosen = item.product?.code === c.code;
              const price = defaultUnitPrice(c, buying ? 'cost' : 'sell');
              return (
                <button
                  key={c.code}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChoose?.(c);
                  }}
                  className={cx(
                    'min-h-[48px] max-w-full rounded-xl border-2 px-3 py-1 text-left',
                    chosen ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white',
                  )}
                >
                  <span className="block truncate text-sm font-bold">{c.name}</span>
                  <span className={cx('block text-xs', chosen ? 'text-white/80' : 'text-slate-500')}>
                    {price !== null ? `${fmtMoney(price)}/${c.unit}` : 'no price yet'} · {formatStock(c.stock_qty, c.unit)}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onPickProduct();
              }}
              className="min-h-[48px] rounded-xl border-2 border-dashed border-slate-300 px-3 text-sm font-semibold text-slate-600"
            >
              Other…
            </button>
          </div>
        </div>
      )}

      {/* ---- buying something that is probably already on the shelf ---- */}
      {isNew && suggestion && onUseSuggestion && (
        <div className="mt-2 flex items-center gap-2 rounded-xl border-2 border-blue-200 bg-white px-2.5 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-slate-500">Already in your stock?</p>
            <p className="truncate font-bold text-slate-900">
              {suggestion.name}
              <span className="ml-1 font-normal text-slate-500">· {formatStock(suggestion.stock_qty, suggestion.unit)}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUseSuggestion();
            }}
            className="min-h-[44px] shrink-0 rounded-xl bg-blue-600 px-3 text-sm font-bold text-white active:bg-blue-700"
          >
            Yes, add to it
          </button>
        </div>
      )}

      {/* ---- how many, of what ---- */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label onClick={(e) => e.stopPropagation()}>
          <span className={label('qty')}>Quantity</span>
          <input
            className={box('qty')}
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            placeholder="Fill"
            value={item.qty ?? ''}
            onChange={(e) => onChange({ ...item, qty: num(e.target.value) })}
          />
        </label>
        <label onClick={(e) => e.stopPropagation()}>
          <span className={label('unit')}>Unit</span>
          <input
            className={box('unit')}
            list={`units-${item.key}`}
            placeholder={item.product?.unit || 'kg, packet…'}
            value={item.unit}
            onChange={(e) => onChange({ ...item, unit: e.target.value })}
            onBlur={() => {
              // "gm", "grams", "ଗ୍ରାମ" all settle to "g", so the shop's records use one word for one unit
              const n = normalizeUnit(item.unit);
              if (n && n !== item.unit) onChange({ ...item, unit: n });
            }}
          />
          <datalist id={`units-${item.key}`}>
            {COMMON_UNITS.map((u) => <option key={u} value={u} />)}
          </datalist>
        </label>
      </div>

      {mismatch && item.product && (
        <div className="mt-2 flex items-center gap-2 rounded-xl border-2 border-red-200 bg-red-50 px-3 py-2">
          <p className="min-w-0 flex-1 text-sm font-semibold text-red-700">
            {item.product.name} is counted in {item.product.unit}, not {item.unit}.
          </p>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange({ ...item, unit: item.product!.unit });
            }}
            className="min-h-[44px] shrink-0 rounded-xl bg-red-600 px-3 text-sm font-bold text-white"
          >
            Use {item.product.unit}
          </button>
        </div>
      )}

      {/* ---- at what price ---- */}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label onClick={(e) => e.stopPropagation()}>
          <span className={label('price')}>{buying ? `Cost ₹ per ${per}` : `Rate ₹ per ${per}`}</span>
          <input
            className={box('price')}
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            placeholder={buying ? 'What you paid' : 'Fill'}
            value={item.unit_price ?? ''}
            onChange={(e) => onChange({ ...item, unit_price: num(e.target.value), priceTouched: true })}
          />
        </label>
        {!buying && (
          <label onClick={(e) => e.stopPropagation()}>
            <span className="block text-xs font-bold uppercase tracking-wide text-slate-500">
              Amount ₹{Number(item.qty) > 0 ? ` for ${trimQty(Number(item.qty))} ${normalizeUnit(item.unit) || per}` : ''}
            </span>
            <input
              className="mt-1 min-h-[52px] w-full rounded-xl border-2 border-emerald-200 bg-emerald-50 px-3 text-lg font-extrabold tabular-nums text-emerald-900 focus:outline-none focus:ring-4 focus:ring-emerald-200"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              placeholder="—"
              disabled={!(Number(item.qty) > 0) || baseQty(item) === null}
              value={amountText ?? (lineTotal(item) > 0 ? String(lineTotal(item)) : '')}
              onFocus={() => setAmountText(lineTotal(item) > 0 ? String(lineTotal(item)) : '')}
              onBlur={() => setAmountText(null)}
              onChange={(e) => {
                // Typing the amount ("make it ₹3") sets the rate that gives it, so the two always agree.
                setAmountText(e.target.value);
                const amount = num(e.target.value);
                const q = baseQty(item);
                if (amount !== null && q && q > 0) {
                  onChange({ ...item, unit_price: Math.round((amount / q) * 10000) / 10000, priceTouched: true });
                }
              }}
            />
          </label>
        )}
        {buying && (
          <label onClick={(e) => e.stopPropagation()}>
            <span className={label('sell')}>Sell ₹ per {per}</span>
            <input
              className={box('sell')}
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              placeholder="You sell at"
              value={item.sell_price ?? ''}
              onChange={(e) => onChange({ ...item, sell_price: num(e.target.value) })}
            />
          </label>
        )}
      </div>

      {/* ---- the evidence, and what this line adds up to ---- */}
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="min-w-0 flex-1 text-xs">
          {converted && (
            <p className="font-bold text-slate-700">
              {trimQty(Number(item.qty))} {normalizeUnit(item.unit)} = {trimQty(baseQty(item) ?? 0)} {item.product!.unit}
              {Number(item.unit_price) > 0 && ` × ${fmtMoney(Number(item.unit_price))}`}
            </p>
          )}
          {margin && (
            <p className={cx('font-bold', margin.amount >= 0 ? 'text-emerald-700' : 'text-red-600')}>
              {margin.amount >= 0 ? 'You earn' : 'Loss of'} {fmtMoney(Math.abs(margin.amount))} each · {margin.pct.toFixed(0)}%
            </p>
          )}
          {item.original?.spoken_span && (
            <p className="truncate text-slate-500">
              <span className="mr-1 font-semibold text-slate-400">{source === 'image' ? 'Written' : 'Heard'}</span>
              “{item.original.spoken_span}”
            </p>
          )}
          {reason && <p className="truncate font-semibold text-amber-700">{reason}</p>}
        </div>
        {/* Selling lines show their amount in its own box above; buying lines total here. */}
        {buying && (
          <p className="shrink-0 text-lg font-extrabold tabular-nums text-slate-900">
            {lineTotal(item) > 0 ? fmtMoney(lineTotal(item)) : <span className="text-slate-300">₹ —</span>}
          </p>
        )}
      </div>
    </li>
  );
}

function StatusPill({ product, isNew, needsReview }: { product: boolean; isNew: boolean; needsReview: boolean }) {
  if (isNew) {
    return <span className="mt-3 shrink-0 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-extrabold uppercase text-blue-800">New</span>;
  }
  if (product && !needsReview) {
    return (
      <span className="mt-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700" aria-label="Matched">
        <CheckIcon className="h-4 w-4" />
      </span>
    );
  }
  if (product) {
    return <span className="mt-3 shrink-0 rounded-full bg-amber-100 px-2 py-1 text-[11px] font-extrabold uppercase text-amber-800">Check</span>;
  }
  return null;
}
