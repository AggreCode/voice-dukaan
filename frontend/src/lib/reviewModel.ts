import { ExtractedItem, ProductOut, ReviewProduct, VoiceMode, VoiceSessionOut } from './types';

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

export function priceKindFor(type: 'sale' | 'purchase'): PriceKind {
  return type === 'purchase' ? 'cost' : 'sell';
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

export interface ReviewItem {
  key: string;
  item_index: number | null;
  product: PickedProduct | null;
  qty: number;
  unit: string;
  unit_price: number;
  /** true once the user has typed a price, so re-picking a product/unit won't overwrite it */
  priceTouched: boolean;
  original: ExtractedItem | null;
}

/** Default unit price: sell_price, or for kind "cost" the cost_price when set (> 0), else sell_price. */
export function defaultUnitPrice(product: PickedProduct | null, kind: PriceKind = 'sell'): number | null {
  if (!product) return null;
  return kind === 'cost' && product.cost_price !== null && product.cost_price > 0 ? product.cost_price : product.sell_price;
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
    const unit = it.unit || product?.unit || 'piece';
    const llmPrice = takePrice && it.unit_price !== null && it.unit_price > 0 ? it.unit_price : null;
    const price = llmPrice ?? defaultUnitPrice(product, kind) ?? 0;
    return {
      key: nextKey(),
      item_index: idx,
      product,
      qty: it.quantity > 0 ? it.quantity : 1,
      unit,
      unit_price: price,
      priceTouched: llmPrice !== null,
      original: it,
    };
  });
}

export function newBlankItem(): ReviewItem {
  return { key: nextKey(), item_index: null, product: null, qty: 1, unit: 'piece', unit_price: 0, priceTouched: false, original: null };
}

export function lineTotal(it: ReviewItem): number {
  return round2((Number(it.qty) || 0) * (Number(it.unit_price) || 0));
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
