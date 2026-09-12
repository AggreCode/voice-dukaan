import { ExtractedItem, ProductOut, ReviewProduct, UNITS, Unit, VoiceSessionOut } from './types';

/** Common shape for a product chosen in review (from review_products or /api/products). */
export interface PickedProduct {
  code: string;
  id: string;
  name: string;
  local_name: string | null;
  brand: string;
  pack_unit: string;
  sub_unit: string;
  pack_size: number;
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
    pack_unit: p.pack_unit,
    sub_unit: p.sub_unit,
    pack_size: Number(p.pack_size) || 1,
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
  unit: Unit;
  unit_price: number;
  /** true once the user has typed a price, so re-picking a product/unit won't overwrite it */
  priceTouched: boolean;
  original: ExtractedItem | null;
}

/**
 * Default unit price. Base price is sell_price, or for kind "cost" the cost_price when set (> 0), else sell_price.
 * pack_unit -> base ; sub_unit -> base / pack_size ; otherwise base.
 */
export function defaultUnitPrice(product: PickedProduct | null, unit: string, kind: PriceKind = 'sell'): number | null {
  if (!product) return null;
  const base = kind === 'cost' && product.cost_price !== null && product.cost_price > 0 ? product.cost_price : product.sell_price;
  if (unit === product.pack_unit) return base;
  if (unit === product.sub_unit && product.pack_size > 0) return round2(base / product.pack_size);
  return base;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function asUnit(u: string | null | undefined): Unit {
  return (UNITS as readonly string[]).includes(u ?? '') ? (u as Unit) : 'other';
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
    const unit = asUnit(it.unit);
    const llmPrice = it.unit_price !== null && it.unit_price > 0 ? it.unit_price : null;
    const price = llmPrice ?? defaultUnitPrice(product, unit, kind) ?? 0;
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
