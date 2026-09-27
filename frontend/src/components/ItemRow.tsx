import ConfidenceBadge, { confidenceLevel } from './ConfidenceBadge';
import { COMMON_UNITS, extractionReasonLabel } from '../lib/constants';
import { PickedProduct, PriceKind, ReviewItem, defaultUnitPrice, lineTotal } from '../lib/reviewModel';
import { formatStock } from '../lib/stock';
import { cx, fmtMoney } from '../lib/utils';

interface Props {
  item: ReviewItem;
  active: boolean;
  onChange: (next: ReviewItem) => void;
  onDelete: () => void;
  onPickProduct: () => void;
  onActivate: () => void;
  /** "cost" for purchases: label price as cost and default to cost_price. */
  priceKind?: PriceKind;
  /** Where the line came from, so the evidence under it reads "Heard" or "Written". */
  source?: 'voice' | 'image';
  /**
   * True on a stock-in row whose product is not in the inventory yet. Stocking in is how a product
   * ENTERS the inventory, so "not in your inventory" is not an error there, it is the normal first
   * day of an item. The row stays editable and saving creates it.
   */
  newItemOk?: boolean;
  /** An existing inventory product this line probably means, offered instead of creating a duplicate. */
  suggestion?: PickedProduct | null;
  onUseSuggestion?: () => void;
}

export default function ItemRow({ item, active, onChange, onDelete, onPickProduct, onActivate, priceKind = 'sell', source = 'voice', newItemOk = false, suggestion = null, onUseSuggestion }: Props) {
  const conf = item.original?.confidence ?? (item.product ? 1 : 0);
  const level = confidenceLevel(conf, !!item.product);
  const needsReview = item.original?.needs_review ?? false;
  const isNew = !item.product && newItemOk;
  // "Not in your inventory" is the whole point of a stock-in line, so it is not worth saying twice.
  const reasonText = isNew
    ? extractionReasonLabel((item.original?.reason ?? '').split(',').filter((r) => r.trim() !== 'not_in_catalog').join(','))
    : extractionReasonLabel(item.original?.reason);
  const field = 'min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-2 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30';

  const setUnit = (unit: string) => {
    const price = item.priceTouched ? item.unit_price : defaultUnitPrice(item.product, priceKind) ?? item.unit_price;
    onChange({ ...item, unit, unit_price: price });
  };

  return (
    <li
      onClick={onActivate}
      onFocus={onActivate}
      className={cx(
        'rounded-xl border p-3 transition-colors',
        active ? 'border-primary ring-2 ring-primary/30' : 'border-slate-200',
        isNew ? 'bg-primary/5' : needsReview || level === 'red' ? 'bg-red-50' : level === 'amber' ? 'bg-amber-50/60' : 'bg-white',
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onActivate();
            onPickProduct();
          }}
          className={cx(
            'min-h-[48px] min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-left',
            item.product ? 'border-slate-300 bg-white' : isNew ? 'border-dashed border-primary/60 bg-white' : 'border-dashed border-red-400 bg-white',
          )}
        >
          {item.product ? (
            <>
              <div className="truncate font-semibold text-slate-900">{item.product.name}</div>
              {item.product.local_name && <div className="truncate text-sm text-slate-500">{item.product.local_name}</div>}
              <div className="truncate text-xs text-slate-500">
                {item.product.brand ? item.product.brand + ' · ' : ''}
                {item.product.code} · stock {formatStock(item.product.stock_qty, item.product.unit)}
              </div>
            </>
          ) : isNew ? (
            <>
              <div className="truncate font-semibold text-primary-dark">
                {item.original?.product_name_guess || 'New item'} <span className="font-normal">▾</span>
              </div>
              <div className="text-xs text-primary">Will be added to your inventory · tap to pick an existing one</div>
            </>
          ) : (
            <>
              <div className="truncate font-semibold text-red-700">
                {item.original?.product_name_guess || 'Choose product'} <span className="font-normal">▾</span>
              </div>
              <div className="text-xs text-red-600">Tap to pick a product</div>
            </>
          )}
        </button>
        {isNew ? (
          <span className="mt-1 shrink-0 rounded-full bg-primary/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-primary-dark">
            New
          </span>
        ) : (
          <ConfidenceBadge confidence={conf} hasProduct={!!item.product} className="mt-1 shrink-0" />
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label="Delete item"
          className="min-h-[44px] min-w-[44px] shrink-0 rounded-lg text-xl text-slate-400 hover:bg-red-100 hover:text-red-600"
        >
          🗑
        </button>
      </div>

      <div className="mt-2 grid grid-cols-[1fr_1.3fr_1.2fr] gap-2">
        <label className="text-[11px] text-slate-500">
          Qty
          <input
            className={field}
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={item.qty}
            onChange={(e) => onChange({ ...item, qty: Number(e.target.value) })}
          />
        </label>
        <label className="text-[11px] text-slate-500">
          Unit {item.original?.unit_raw && item.original.unit_raw !== item.unit ? <span className="text-slate-400">({item.original.unit_raw})</span> : null}
          <input
            className={field}
            list="item-row-units"
            value={item.unit}
            onChange={(e) => setUnit(e.target.value)}
          />
          <datalist id="item-row-units">
            {COMMON_UNITS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </label>
        <label className="text-[11px] text-slate-500">
          {priceKind === 'cost' ? 'Cost per unit ₹' : 'Price ₹'}
          <input
            className={field}
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={item.unit_price}
            onChange={(e) => onChange({ ...item, unit_price: Number(e.target.value), priceTouched: true })}
          />
        </label>
      </div>

      {/* The wholesaler's wording is never the shop's, so a line that looks new may well be a product
          already on the shelf. Offer it before anything gets created twice. */}
      {isNew && suggestion && onUseSuggestion && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-primary/40 bg-white px-2 py-1.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] text-slate-500">Already in your inventory</p>
            <p className="truncate text-sm font-semibold text-slate-800">
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
            className="min-h-[40px] shrink-0 rounded-lg bg-primary px-3 text-xs font-bold text-white"
          >
            Add stock to it
          </button>
        </div>
      )}

      {/* Evidence, then what to do about it: the words this line came from, and any flag in plain
          language. Both, not one or the other -- the words are how the shopkeeper judges the flag. */}
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="min-w-0 flex-1">
          {item.original?.spoken_span ? (
            <p className="truncate text-[11px] text-slate-500">
              <span className="mr-1 font-medium text-slate-400">{source === 'image' ? 'Written' : 'Heard'}</span>
              “{item.original.spoken_span}”
            </p>
          ) : item.item_index === null ? (
            <p className="text-[11px] text-slate-500">Added by hand</p>
          ) : null}
          {reasonText && (
            <p className={cx('truncate text-[11px] font-medium', level === 'red' ? 'text-red-700' : 'text-amber-700')}>
              {reasonText}
            </p>
          )}
        </div>
        <p className="shrink-0 text-sm font-semibold text-slate-800">= {fmtMoney(lineTotal(item))}</p>
      </div>
    </li>
  );
}
