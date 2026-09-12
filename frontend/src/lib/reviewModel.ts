import { ExtractedItem, ProductOut, ReviewProduct, VoiceSessionOut } from './types';

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

export function buildReviewItems(session: VoiceSessionOut, kind: PriceKind = 'sell'): ReviewItem[] {
  const byCode = new Map<string, PickedProduct>();
  session.review_products.forEach((p) => byCode.set(p.code, toPicked(p)));
  const items = session.extraction?.items ?? [];
  return items.map((it, idx) => {
    const product = it.product_id ? byCode.get(it.product_id) ?? null : null;
    const unit = it.unit || product?.unit || 'piece';
    const llmPrice = it.unit_price !== null && it.unit_price > 0 ? it.unit_price : null;
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
