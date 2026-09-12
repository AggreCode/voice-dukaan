import { fmtQty } from './utils';

const INVARIANT = new Set(['kg', 'g', 'gm', 'mg', 'ml', 'l', 'ltr', 'dozen']);

/** "strip" -> "strips" when qty != 1. Cosmetic only — units are freeform words, not enums. */
export function unitLabel(unit: string, qty: number): string {
  const u = unit || 'unit';
  if (Math.abs(qty) === 1 || INVARIANT.has(u.toLowerCase())) return u;
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
