import { ExtractedItem, ProductOut, ReviewProduct, VoiceMode, VoiceSessionOut } from './types';
import { normalizeUnit, unitFactor } from './units';

/** Common shape for a product chosen in review (from review_products or /api/products). */
export interface PickedProduct {
  code: string;
  id: string;
  name: string;
  local_name: string | null;
  brand: string;
  unit: string;
  sell_price: number;
  cost_price: number | null;
  stock_qty: number;
}

/** Which base price a line defaults to: selling price for sales, cost price for purchases. */
export type PriceKind = 'sell' | 'cost';
export type Intent = 'sale' | 'purchase';

export function priceKindFor(type: Intent): PriceKind {
  return type === 'purchase' ? 'cost' : 'sell';
}

export function intentFor(mode: VoiceMode): Intent {
  return mode === 'stock_in' ? 'purchase' : 'sale';
}

export function toPicked(p: ProductOut | ReviewProduct): PickedProduct {
  return {
    code: p.code,
    id: p.id,
    name: p.name,
    local_name: p.local_name ?? null,
    brand: p.brand,
    unit: p.unit,
    sell_price: Number(p.sell_price) || 0,
    cost_price: p.cost_price === null || p.cost_price === undefined || !Number.isFinite(Number(p.cost_price)) ? null : Number(p.cost_price),
    stock_qty: Number(p.stock_qty) || 0,
  };
}

/**
 * One line of a bill while it is being checked.
 *
 * Every number is nullable on purpose. "Basmati, marigold biscuit, tiger biscuit" is a complete and
 * perfectly good thing for a shopkeeper to say; it produces three lines with the quantities empty, and
 * an empty box is honest where a pre-filled 1 would look like something they said. Saving is what
 * insists the boxes are filled, not capturing.
 */
export interface ReviewItem {
  key: string;
  item_index: number | null;
  product: PickedProduct | null;
  /** The name typed for a product that is not in the inventory yet (buying only). */
  newName?: string;
  qty: number | null;
  unit: string;
  /**
   * The RATE, per the product's own unit: ₹120 per kg, whatever unit this line is in. Selling: what the
   * customer pays per unit. Buying: the wholesaler's rate, i.e. the cost. A shopkeeper thinks in rates
   * ("butter is 120 a kilo"), so the box shows one, and the line converts: 500 g at ₹120/kg is ₹60.
   * For a product not in stock yet, its unit is this line's unit, so the two are the same.
   */
  unit_price: number | null;
  /** Buying only: what the shop will now sell this product at. Required to save a purchase. */
  sell_price: number | null;
  /** true once the user has typed a price, so re-picking a product won't overwrite it */
  priceTouched: boolean;
  original: ExtractedItem | null;
}

/** The shop's own saved price for a product, or null when it has not set one. Never a substitute. */
export function defaultUnitPrice(product: PickedProduct | null, kind: PriceKind = 'sell'): number | null {
  if (!product) return null;
  if (kind === 'cost') return product.cost_price !== null && product.cost_price > 0 ? product.cost_price : null;
  return product.sell_price > 0 ? product.sell_price : null;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

let keySeq = 0;
export function nextKey(): string {
  keySeq += 1;
  return `ri-${Date.now()}-${keySeq}`;
}

/**
 * Whether a price read off the input should be used, or the shop's own price should win.
 *
 * Buying: the wholesaler's bill carries the rate, and that rate is the whole reason for photographing
 * it, so it wins. Selling: the shop sets the price, margin included, and it is not on the customer's
 * paper list at all, so any number the reader found there is ignored in favour of the catalog price.
 * A price the shopkeeper *speaks* always wins, whichever way round, because that is them deciding.
 */
export function usesCapturedPrice(session: VoiceSessionOut, kind: PriceKind): boolean {
  return !(session.input_kind === 'image' && kind === 'sell');
}

export function buildReviewItems(session: VoiceSessionOut, kind: PriceKind = 'sell'): ReviewItem[] {
  const byCode = new Map<string, PickedProduct>();
  session.review_products.forEach((p) => byCode.set(p.code, toPicked(p)));
  const items = session.extraction?.items ?? [];
  const takePrice = usesCapturedPrice(session, kind);
  return items.map((it, idx) => {
    const product = it.product_id ? byCode.get(it.product_id) ?? null : null;
    // "gm", "grams", "ଗ୍ରାମ" all become "g"; nothing said means the product's own unit.
    const unit = normalizeUnit(it.unit) || product?.unit || '';
    const f = product ? unitFactor(unit, product.unit) : 1;
    // A spoken price is per the unit spoken; the box holds the rate per the product's unit.
    const spoken = takePrice && it.unit_price !== null && it.unit_price > 0 ? it.unit_price : null;
    const captured = spoken !== null && f ? Math.round((spoken / f) * 100) / 100 : spoken;
    return {
      key: nextKey(),
      item_index: idx,
      product,
      newName: product ? undefined : (it.product_name_guess || '').trim() || undefined,
      qty: it.quantity !== null && it.quantity > 0 ? it.quantity : null,
      // What was said, else the product's own unit, else nothing. Never "piece" out of thin air.
      unit,
      unit_price: captured ?? defaultUnitPrice(product, kind),
      sell_price: kind === 'cost' ? defaultUnitPrice(product, 'sell') : null,
      priceTouched: captured !== null,
      original: it,
    };
  });
}

export function newBlankItem(): ReviewItem {
  return {
    key: nextKey(), item_index: null, product: null, qty: null, unit: '', unit_price: null, sell_price: null,
    priceTouched: false, original: null,
  };
}

/**
 * How many of the product's own unit one of this line's unit is: 0.001 for "g" against a product kept
 * in "kg". null when they measure different things (a "packet" of something kept in grams).
 */
export function lineFactor(it: ReviewItem): number | null {
  if (!it.product) return 1;
  return unitFactor(it.unit || it.product.unit, it.product.unit);
}

/** The line's quantity in the product's own unit: 500 g of a kg product is 0.5. */
export function baseQty(it: ReviewItem): number | null {
  const f = lineFactor(it);
  return f === null ? null : (Number(it.qty) || 0) * f;
}

export function lineTotal(it: ReviewItem): number {
  const q = baseQty(it);
  return q === null ? 0 : round2(q * (Number(it.unit_price) || 0));
}

/** The price per unit OF THIS LINE, which is what the server multiplies the quantity by. */
export function linePrice(it: ReviewItem): number {
  const f = lineFactor(it) ?? 1;
  return Math.round((Number(it.unit_price) || 0) * f * 1e6) / 1e6;
}

/** The name a not-yet-known line would be created under, or "" when there is nothing to go on. */
export function newItemName(it: ReviewItem): string {
  return (it.newName ?? it.original?.product_name_guess ?? '').trim();
}

export type Missing = 'product' | 'qty' | 'unit' | 'unitMismatch' | 'price' | 'sell';

/**
 * What still has to be filled in before this line can be saved. Each name maps to one box on the row,
 * so the screen can mark exactly that box instead of saying "something is wrong somewhere".
 */
export function missingFields(it: ReviewItem, intent: Intent): Missing[] {
  const out: Missing[] = [];
  const named = !!newItemName(it);
  if (!it.product && !(intent === 'purchase' && named)) out.push('product');
  if (!(Number(it.qty) > 0)) out.push('qty');
  if (!it.product && intent === 'purchase' && !it.unit.trim()) out.push('unit');
  if (it.product && lineFactor(it) === null) out.push('unitMismatch');
  if (!(Number(it.unit_price) > 0)) out.push('price');
  if (intent === 'purchase' && !(Number(it.sell_price) > 0)) out.push('sell');
  return out;
}

/** Margin in rupees and percent on one buying line, or null until both prices are in. */
export function rowMargin(it: ReviewItem): { amount: number; pct: number } | null {
  const cost = Number(it.unit_price);
  const sell = Number(it.sell_price);
  if (!(cost > 0) || !(sell > 0)) return null;
  return { amount: round2(sell - cost), pct: ((sell - cost) / cost) * 100 };
}

/**
 * An empty bill, for typing one in by hand.
 *
 * Deliberately the same shape a recording or a photograph produces, so the screen that edits it is
 * the same screen, with the same catalog lookup, the same prices and the same save. A bill typed by
 * hand is not a lesser bill; it just arrived without a capture behind it.
 */
export function blankSession(mode: VoiceMode): VoiceSessionOut {
  return {
    session_id: '',
    client_session_id: '',
    status: 'extracted',
    mode,
    input_kind: 'voice',
    transcript: null,
    secondary_views: {},
    transcript_language: null,
    language_probability: null,
    low_language_confidence: false,
    image_count: null,
    ocr_lines: [],
    ocr_columns: [],
    ocr_unclear_lines: [],
    ocr_notes: '',
    reader: null,
    extraction: null,
    review_products: [],
    latencies: {},
    error: null,
    created_at: new Date().toISOString(),
  };
}
