import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { auth } from '../lib/auth';
import { COMMON_UNITS, LOCAL_NAME_HELP, LOCAL_NAME_PLACEHOLDER } from '../lib/constants';
import { PickedProduct, toPicked } from '../lib/reviewModel';
import { ProductIn, ProductOut, numOrNull } from '../lib/types';
import { cx } from '../lib/utils';

interface Props {
  initialName?: string;
  onCancel: () => void;
  onCreated: (p: PickedProduct, raw: ProductOut) => void;
}

const field = 'min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-base focus:border-primary focus:outline-none';
const label = 'text-xs text-slate-600';

/**
 * Quick add: exactly 3 required fields (name, unit, quantity). Manual entry and voice dictation
 * (see Record/Review) are the only two ways to add or receive stock — this is the manual one.
 */
export function AddProductInline({ initialName, onCancel, onCreated }: Props) {
  const qc = useQueryClient();
  const [name, setName] = useState(initialName ?? '');
  const [unit, setUnit] = useState('');
  const [qty, setQty] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [debouncedName, setDebouncedName] = useState('');
  const nameBoxRef = useRef<HTMLDivElement>(null);

  const [showMore, setShowMore] = useState(false);
  const [localName, setLocalName] = useState('');
  const [brand, setBrand] = useState('');
  const [category, setCategory] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [lowStock, setLowStock] = useState('');
  const [aliases, setAliases] = useState('');

  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedName(name.trim()), 250);
    return () => window.clearTimeout(t);
  }, [name]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (nameBoxRef.current && !nameBoxRef.current.contains(e.target as Node)) setShowSuggestions(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const shopType = auth.getShopType();
  const glossary = useQuery({
    queryKey: ['glossary', shopType, debouncedName],
    queryFn: () => api.glossary.search(shopType!, debouncedName),
    enabled: !!shopType && debouncedName.length >= 1,
    staleTime: 60_000,
  });

  const create = useMutation({
    mutationFn: (body: ProductIn) => api.products.create(body),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ['products'] });
      onCreated(toPicked(p), p);
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : (e as Error).message),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErr('Name is required');
      return;
    }
    if (!unit.trim()) {
      setErr('Unit is required');
      return;
    }
    setErr(null);
    const body: ProductIn = {
      name: name.trim(),
      unit: unit.trim(),
    };
    const openQty = numOrNull(qty);
    if (openQty !== null && openQty > 0) body.opening_stock = openQty;
    if (localName.trim()) body.local_name = localName.trim();
    if (brand.trim()) body.brand = brand.trim();
    if (category.trim()) body.category = category.trim();
    const sell = numOrNull(sellPrice);
    if (sell !== null && sell >= 0) body.sell_price = sell;
    const cost = numOrNull(costPrice);
    if (cost !== null && cost >= 0) body.cost_price = cost;
    const low = numOrNull(lowStock);
    if (low !== null && low >= 0) body.low_stock_threshold = low;
    const aliasList = aliases.split(',').map((a) => a.trim()).filter(Boolean);
    if (aliasList.length > 0) body.aliases = aliasList;
    create.mutate(body);
  };

  const suggestions = glossary.data ?? [];

  return (
    <form onSubmit={submit} className="rounded-xl border border-primary/30 bg-primary-light/30 p-3">
      <p className="mb-2 text-sm font-semibold text-primary-dark">New product</p>
      <div className="space-y-2">
        <div ref={nameBoxRef} className="relative">
          <label className={label}>
            Product name *
            <input
              className={field}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              autoComplete="off"
              required
            />
          </label>
          {showSuggestions && debouncedName.length >= 1 && suggestions.length > 0 && (
            <div className="absolute z-10 mt-0.5 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
              <p className="border-b border-slate-100 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Suggestions</p>
              <ul className="max-h-48 overflow-y-auto">
                {suggestions.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      onClick={() => {
                        setName(s);
                        setShowSuggestions(false);
                      }}
                      className="flex min-h-[40px] w-full items-center px-3 text-left text-sm hover:bg-primary-light/40"
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className={label}>
            Unit *
            <input
              className={field}
              list="add-product-units"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="e.g. kg, box"
              required
            />
            <datalist id="add-product-units">
              {COMMON_UNITS.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </label>
          <label className={label}>
            Quantity
            <input
              className={field}
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="0"
            />
          </label>
        </div>

        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          className="min-h-[36px] text-xs font-semibold text-primary-dark"
        >
          {showMore ? '− Fewer details' : '+ More details'}
        </button>

        <div className={cx('grid grid-cols-2 gap-2', !showMore && 'hidden')}>
          <label className={`col-span-2 ${label}`}>
            Local name
            <input className={field} value={localName} onChange={(e) => setLocalName(e.target.value)} placeholder={LOCAL_NAME_PLACEHOLDER} />
            <span className="mt-0.5 block text-[11px] text-slate-500">{LOCAL_NAME_HELP}</span>
          </label>
          <label className={label}>
            Brand
            <input className={field} value={brand} onChange={(e) => setBrand(e.target.value)} />
          </label>
          <label className={label}>
            Category
            <input className={field} value={category} onChange={(e) => setCategory(e.target.value)} />
          </label>
          <label className={label}>
            Selling price ₹
            <input className={field} type="number" inputMode="decimal" min={0} step="any" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} />
          </label>
          <label className={label}>
            Cost price ₹
            <input className={field} type="number" inputMode="decimal" min={0} step="any" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} placeholder="Optional" />
          </label>
          <label className={label}>
            Low stock at
            <input className={field} type="number" inputMode="decimal" min={0} step="any" value={lowStock} onChange={(e) => setLowStock(e.target.value)} />
          </label>
          <label className={`col-span-2 ${label}`}>
            Aliases (comma-separated)
            <input className={field} value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="e.g. PCM, fever tablet" />
          </label>
        </div>
      </div>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onCancel} className="min-h-[44px] flex-1 rounded-lg border border-slate-300 bg-white font-medium">
          Cancel
        </button>
        <button type="submit" disabled={create.isPending} className="min-h-[44px] flex-1 rounded-lg bg-primary font-semibold text-white disabled:opacity-60">
          {create.isPending ? 'Saving…' : 'Create & use'}
        </button>
      </div>
    </form>
  );
}

export default AddProductInline;
