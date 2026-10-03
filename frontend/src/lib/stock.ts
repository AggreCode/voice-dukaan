import { normalizeUnit } from './units';
import { fmtQty } from './utils';

/** Units written as symbols, which never take a plural: "5 kg", not "5 kgs". */
const INVARIANT = new Set(['kg', 'g', 'mg', 'ml', 'litre', 'quintal', 'dozen']);

/**
 * "strip" -> "strips" when qty != 1. Cosmetic only. A unit already spelled as a plural ("Grams") is left
 * alone, which used to come out as "400 Gramses".
 */
export function unitLabel(unit: string, qty: number): string {
  const u = unit || 'unit';
  if (INVARIANT.has(normalizeUnit(u))) return ['kg', 'g', 'mg', 'ml'].includes(normalizeUnit(u)) ? normalizeUnit(u) : u;
  if (Math.abs(qty) === 1 || /s$/i.test(u)) return u;
  if (/(s|x|z|ch|sh)$/i.test(u)) return u + 'es';
  return u + 's';
}

/** Plain "`qty` `unit`" display, e.g. "125 kg", "40 piece". No pack math — a product has one unit. */
export function formatStock(qty: number, unit: string): string {
  const sign = qty < 0 ? '-' : '';
  const abs = Math.abs(Number(qty) || 0);
  return `${sign}${fmtQty(abs)} ${unitLabel(unit, abs)}`;
}

/** Signed quantity, e.g. "+20 pieces" / "-5 pieces". */
export function formatSignedQty(delta: number, unit: string): string {
  const abs = Math.abs(delta);
  return `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${fmtQty(abs)} ${unitLabel(unit, abs)}`;
}
