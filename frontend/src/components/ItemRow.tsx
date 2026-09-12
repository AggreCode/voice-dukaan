import ConfidenceBadge, { confidenceLevel } from './ConfidenceBadge';
import { PriceKind, ReviewItem, defaultUnitPrice, lineTotal } from '../lib/reviewModel';
import { formatStock } from '../lib/stock';
import { UNITS, Unit } from '../lib/types';
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
}

export default function ItemRow({ item, active, onChange, onDelete, onPickProduct, onActivate, priceKind = 'sell' }: Props) {
  const conf = item.original?.confidence ?? (item.product ? 1 : 0);
  const level = confidenceLevel(conf, !!item.product);
  const needsReview = item.original?.needs_review ?? false;
  const field = 'min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-2 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30';

  const setUnit = (unit: Unit) => {
    const price = item.priceTouched ? item.unit_price : defaultUnitPrice(item.product, unit, priceKind) ?? item.unit_price;
    onChange({ ...item, unit, unit_price: price });
  };

  return (
    <li
      onClick={onActivate}
      onFocus={onActivate}
      className={cx(
        'rounded-xl border p-3 transition-colors',
        active ? 'border-primary ring-2 ring-primary/30' : 'border-slate-200',
        needsReview || level === 'red' ? 'bg-red-50' : level === 'amber' ? 'bg-amber-50/60' : 'bg-white',
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
            item.product ? 'border-slate-300 bg-white' : 'border-dashed border-red-400 bg-white',
          )}
        >
          {item.product ? (
            <>
              <div className="truncate font-semibold text-slate-900">{item.product.name}</div>
              {item.product.local_name && <div className="truncate text-sm text-slate-500">{item.product.local_name}</div>}
              <div className="truncate text-xs text-slate-500">
                {item.product.brand ? item.product.brand + ' · ' : ''}
                {item.product.code} · stock {formatStock(item.product.stock_qty, item.product)}
              </div>
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
        <ConfidenceBadge confidence={conf} hasProduct={!!item.product} className="mt-1 shrink-0" />
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
          <select className={field} value={item.unit} onChange={(e) => setUnit(e.target.value as Unit)}>
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
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

      <div className="mt-2 flex items-end justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-[11px] text-slate-500">
          {item.original?.reason ? item.original.reason : item.original?.spoken_span ? `“${item.original.spoken_span}”` : item.item_index === null ? 'Added manually' : ''}
        </p>
        <p className="shrink-0 text-sm font-semibold text-slate-800">= {fmtMoney(lineTotal(item))}</p>
      </div>
    </li>
  );
}
