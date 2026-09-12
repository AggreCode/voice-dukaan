import { fmtQty } from './utils';

/** Minimal product shape needed for unit maths. */
export interface UnitInfo {
  pack_unit: string;
  sub_unit: string;
  pack_size: number;
}

const INVARIANT = new Set(['kg', 'g', 'gm', 'mg', 'ml', 'l', 'ltr', 'dozen']);

/** "strip" -> "strips" when qty != 1. "other" reads as "unit". */
export function unitLabel(unit: string, qty: number): string {
  const u = !unit || unit === 'other' ? 'unit' : unit;
  if (Math.abs(qty) === 1 || INVARIANT.has(u.toLowerCase())) return u;
  if (/(s|x|z|ch|sh)$/i.test(u)) return u + 'es';
  return u + 's';
}

/** The unit stock is stored in. */
export function baseUnit(p: UnitInfo): string {
  return p.sub_unit || p.pack_unit;
}

/** True when the product has a distinct loose unit inside a pack. */
export function hasPacks(p: UnitInfo): boolean {
  return !!p.sub_unit && !!p.pack_unit && p.sub_unit !== p.pack_unit && (Number(p.pack_size) || 1) > 1;
}

/** Unit choices for stock entry: pack_unit first (default), then sub_unit. */
export function stockUnitOptions(p: UnitInfo): string[] {
  return [...new Set([p.pack_unit, p.sub_unit].filter((u): u is string => !!u))];
}

/** Convert qty in `unit` to base units. */
export function toBaseQty(qty: number, unit: string, p: UnitInfo): number {
  if (hasPacks(p) && unit === p.pack_unit) return qty * (Number(p.pack_size) || 1);
  return qty;
}

/** Base-unit quantity as packs + loose units, e.g. 125 tablets, pack of 10 -> "12 strips + 5 pieces". */
export function formatStock(qty: number, p: UnitInfo): string {
  const sign = qty < 0 ? '-' : '';
  const abs = Math.abs(Number(qty) || 0);
  if (!hasPacks(p)) return `${sign}${fmtQty(abs)} ${unitLabel(baseUnit(p), abs)}`;
  const size = Number(p.pack_size) || 1;
  const packs = Math.floor(abs / size + 1e-9);
  const loose = Math.round((abs - packs * size) * 1000) / 1000;
  if (packs === 0) return `${sign}${fmtQty(loose)} ${unitLabel(p.sub_unit, loose)}`;
  const packText = `${packs} ${unitLabel(p.pack_unit, packs)}`;
  if (loose === 0) return sign + packText;
  return `${sign}${packText} + ${fmtQty(loose)} ${unitLabel(p.sub_unit, loose)}`;
}

/** Signed base-unit quantity, e.g. "+20 pieces" / "-5 pieces". */
export function formatSignedQty(delta: number, p: UnitInfo): string {
  const abs = Math.abs(delta);
  return `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${fmtQty(abs)} ${unitLabel(baseUnit(p), abs)}`;
}
