import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { LOCAL_NAME_HELP, LOCAL_NAME_PLACEHOLDER } from '../lib/constants';
import { PickedProduct, toPicked } from '../lib/reviewModel';
import { stockUnitOptions, unitLabel } from '../lib/stock';
import { ProductIn, ProductOut, UNITS, numOrNull } from '../lib/types';

/** UNITS plus the current value when it is not one of them (e.g. imported "tablet"). */
export function unitChoices(current?: string | null): string[] {
  const list: string[] = [...UNITS];
  if (current && !list.includes(current)) list.unshift(current);
  return list;
}

interface Props {
  initialName?: string;
  /** compact: quick form inside the product picker; full: complete form on the Inventory page. */
  variant?: 'compact' | 'full';
  onCancel: () => void;
  onCreated: (p: PickedProduct, raw: ProductOut) => void;
}

export function AddProductInline({ initialName, variant = 'compact', onCancel, onCreated }: Props) {
  const full = variant === 'full';
  const qc = useQueryClient();
  const [name, setName] = useState(initialName ?? '');
  const [brand, setBrand] = useState('');
  const [localName, setLocalName] = useState('');
  const [category, setCategory] = useState('');
  const [packUnit, setPackUnit] = useState('piece');
  const [subUnit, setSubUnit] = useState('');
  const [packSize, setPackSize] = useState('1');
  const [sellPrice, setSellPrice] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [lowStock, setLowStock] = useState('5');
  const [aliases, setAliases] = useState('');
  const [opening, setOpening] = useState('');
  const [openingUnit, setOpeningUnit] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const size = Number(packSize) || 1;
  const openingUnits = stockUnitOptions({ pack_unit: packUnit, sub_unit: subUnit, pack_size: size });
  const effOpeningUnit = openingUnits.includes(openingUnit) ? openingUnit : openingUnits[0] ?? packUnit;
  const looseUnit = subUnit || packUnit;

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
    if (size > 1 && !subUnit) {
      setErr('Pick a sub unit (the loose unit inside a pack) when pack size is more than 1');
      return;
    }
    setErr(null);
    const body: ProductIn = {
      name: name.trim(),
      brand: brand.trim(),
      category: category.trim(),
      pack_unit: packUnit,
      sub_unit: subUnit,
      pack_size: size,
      sell_price: Number(sellPrice) || 0,
      low_stock_threshold: Number(lowStock) || 0,
      aliases: aliases.split(',').map((a) => a.trim()).filter(Boolean),
    };
    // Omit local_name when blank so the server derives it from aliases.
    if (localName.trim()) body.local_name = localName.trim();
    const cost = numOrNull(costPrice);
    if (cost !== null && cost >= 0) body.cost_price = cost;
    const openQty = numOrNull(opening);
    if (openQty !== null && openQty > 0) {
      body.opening_stock = openQty;
      body.opening_stock_unit = effOpeningUnit;
    }
    create.mutate(body);
  };

  const field = 'min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-base focus:border-primary focus:outline-none';
  const label = 'text-xs text-slate-600';
  return (
    <form onSubmit={submit} className="rounded-xl border border-primary/30 bg-primary-light/30 p-3">
      <p className="mb-2 text-sm font-semibold text-primary-dark">{full ? 'Add product' : 'New product'}</p>
      <div className="grid grid-cols-2 gap-2">
        <label className={`col-span-2 ${label}`}>
          Name *
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        {full && (
          <>
            <label className={label}>
              Brand
              <input className={field} value={brand} onChange={(e) => setBrand(e.target.value)} />
            </label>
            <label className={label}>
              Category
              <input className={field} value={category} onChange={(e) => setCategory(e.target.value)} />
            </label>
          </>
        )}
        <label className={`col-span-2 ${label}`}>
          Local name
          <input className={field} value={localName} onChange={(e) => setLocalName(e.target.value)} placeholder={LOCAL_NAME_PLACEHOLDER} />
          <span className="mt-0.5 block text-[11px] text-slate-500">{LOCAL_NAME_HELP}</span>
        </label>
        <label className={label}>
          Pack unit
          <select className={field} value={packUnit} onChange={(e) => setPackUnit(e.target.value)}>
            {unitChoices(packUnit).map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </label>
        <label className={label}>
          Sub unit
          <select className={field} value={subUnit} onChange={(e) => setSubUnit(e.target.value)}>
            <option value="">(none)</option>
            {unitChoices(subUnit).map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </label>
        <label className={label}>
          Pack size {subUnit ? `(${unitLabel(subUnit, 2)} per ${packUnit})` : ''}
          <input className={field} type="number" inputMode="decimal" min={1} step="any" value={packSize} onChange={(e) => setPackSize(e.target.value)} />
        </label>
        {full && (
          <label className={label}>
            Low stock at ({unitLabel(looseUnit, 2)})
            <input className={field} type="number" inputMode="decimal" min={0} step="any" value={lowStock} onChange={(e) => setLowStock(e.target.value)} />
          </label>
        )}
        <label className={label}>
          Selling price (₹/{packUnit})
          <input className={field} type="number" inputMode="decimal" min={0} step="any" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} />
        </label>
        <label className={label}>
          Cost price (₹/{packUnit})
          <input className={field} type="number" inputMode="decimal" min={0} step="any" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} placeholder="Optional" />
        </label>
        {full && (
          <label className={`col-span-2 ${label}`}>
            Aliases (comma-separated)
            <input className={field} value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="e.g. PCM, fever tablet" />
          </label>
        )}
        <div className={`col-span-2 grid grid-cols-2 gap-2`}>
          <label className={label}>
            Opening stock
            <input className={field} type="number" inputMode="decimal" min={0} step="any" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0" />
          </label>
          <label className={label}>
            Opening stock unit
            <select className={field} value={effOpeningUnit} onChange={(e) => setOpeningUnit(e.target.value)}>
              {openingUnits.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onCancel} className="min-h-[44px] flex-1 rounded-lg border border-slate-300 bg-white font-medium">
          Cancel
        </button>
        <button type="submit" disabled={create.isPending} className="min-h-[44px] flex-1 rounded-lg bg-primary font-semibold text-white disabled:opacity-60">
          {create.isPending ? 'Saving…' : full ? 'Save product' : 'Create & use'}
        </button>
      </div>
    </form>
  );
}

export default AddProductInline;
