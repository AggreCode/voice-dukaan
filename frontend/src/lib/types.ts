export type ShopType = 'medical' | 'kirana' | 'general';

export interface ShopOut {
  id: string;
  name: string;
  type: ShopType | string;
  default_language: string;
  catalog_version: number;
}

export interface HealthOut {
  ok: boolean;
  db: boolean;
  sarvam_configured: boolean;
  anthropic_configured: boolean;
  google_shadow: boolean;
  claude_model: string;
  sarvam_model: string;
}

export interface ProductOut {
  id: string;
  code: string;
  name: string;
  local_name: string | null;
  brand: string;
  category: string;
  /** Free text, e.g. "kg", "box", "strip" — the ONLY unit this product has. */
  unit: string;
  sell_price: number;
  cost_price: number | null;
  /** In `unit`, no pack math. */
  stock_qty: number;
  low_stock_threshold: number;
  is_active: boolean;
  aliases: string[];
}

export interface ProductIn {
  name: string;
  local_name?: string | null;
  brand?: string;
  category?: string;
  /** Free text, required. */
  unit: string;
  sell_price?: number;
  cost_price?: number | null;
  low_stock_threshold?: number;
  aliases?: string[];
  /** In `unit`. */
  opening_stock?: number | null;
}

/** PATCH /api/products/{id}. local_name "" clears it. */
export type ProductPatch = Partial<ProductIn> & { is_active?: boolean };
/** @deprecated use ProductPatch */
export type ProductUpdate = ProductPatch;

export type VoiceMode = 'sale' | 'stock_in';

export type SessionStatus = 'processing' | 'extracted' | 'no_speech' | 'saved' | 'failed' | 'needs_manual';

export interface ExtractedItem {
  spoken_span: string;
  product_id: string | null; // product CODE like p001
  product_name_guess: string;
  quantity: number;
  unit: string;
  unit_raw: string;
  unit_price: number | null;
  alternatives: { product_id: string; confidence: number }[];
  confidence: number;
  needs_review: boolean;
  reason: string;
}

export interface BillExtraction {
  intent: 'sale' | 'purchase' | 'stock_query' | 'unknown';
  items: ExtractedItem[];
  customer_name: string | null;
  payment_mode: 'cash' | 'upi' | 'credit' | 'unknown' | null;
  notes: string;
  transcript_language: string;
}

export interface ReviewProduct {
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

export interface VoiceSessionOut {
  session_id: string;
  client_session_id: string;
  status: SessionStatus;
  mode: VoiceMode;
  transcript: string | null;
  secondary_views: Record<string, string>;
  transcript_language: string | null;
  language_probability: number | null;
  low_language_confidence: boolean;
  extraction: BillExtraction | null;
  review_products: ReviewProduct[];
  latencies: Record<string, number>;
  error: string | null;
  created_at: string;
}

export interface TransactionItemIn {
  item_index: number | null;
  product_code: string;
  qty: number;
  unit: string;
  unit_price: number;
  spoken_span: string | null;
  llm_product_code: string | null;
  llm_confidence: number | null;
}

export type PaymentMode = 'cash' | 'upi' | 'credit';

export interface TransactionIn {
  voice_session_id: string | null;
  type: 'sale' | 'purchase';
  items: TransactionItemIn[];
  /** Customer for sales, supplier for purchases. */
  customer_name: string | null;
  payment_mode: string;
  notes: string | null;
  deleted_item_indexes: number[];
  llm_intent: string | null;
}

export interface TransactionItemOut {
  id: string;
  product_code: string;
  product_name: string;
  product_local_name: string | null;
  qty: number;
  unit: string;
  unit_price: number;
  line_total: number;
  was_corrected: boolean;
}

export interface TransactionOut {
  id: string;
  type: 'sale' | 'purchase' | string;
  customer_name: string | null;
  payment_mode: string;
  total_amount: number;
  status: string;
  notes: string | null;
  created_at: string;
  items: TransactionItemOut[];
}

export type StockMovementReason =
  | 'sale' | 'purchase' | 'adjustment' | 'return' | 'opening' | 'void' | 'count' | 'restock' | 'damage' | 'expired';

/** Free text; any reason string is accepted by the server. */
export type StockAdjustReason = string;

export interface StockAdjustIn {
  /** Signed: positive adds, negative removes. */
  delta_qty: number;
  reason: string;
  note?: string | null;
}

export interface StockCountIn {
  /** >= 0 */
  counted_qty: number;
  note?: string | null;
}

/** Quantities are in the product's own unit. */
export interface StockMovementOut {
  id: string;
  created_at: string;
  delta_qty: number;
  balance_after: number;
  reason: StockMovementReason | string;
  ref_type: string | null;
  note: string | null;
  transaction_id: string | null;
}

/** Coerce Decimal-as-string fields into numbers. */
export function num(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === '') return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Like num() but keeps null/undefined/unparseable as null. */
export function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

export function normalizeProduct(p: ProductOut): ProductOut {
  return {
    ...p,
    local_name: strOrNull(p.local_name),
    sell_price: num(p.sell_price),
    cost_price: numOrNull(p.cost_price),
    stock_qty: num(p.stock_qty),
    low_stock_threshold: num(p.low_stock_threshold),
    aliases: Array.isArray(p.aliases) ? p.aliases : [],
  };
}

export function normalizeReviewProduct(p: ReviewProduct): ReviewProduct {
  return {
    ...p,
    local_name: strOrNull(p.local_name),
    sell_price: num(p.sell_price),
    cost_price: numOrNull(p.cost_price),
    stock_qty: num(p.stock_qty),
  };
}

export function normalizeTransaction(t: TransactionOut): TransactionOut {
  return {
    ...t,
    total_amount: num(t.total_amount),
    items: (t.items || []).map((i) => ({
      ...i,
      product_local_name: strOrNull(i.product_local_name),
      qty: num(i.qty),
      unit_price: num(i.unit_price),
      line_total: num(i.line_total),
    })),
  };
}

export function normalizeStockMovement(m: StockMovementOut): StockMovementOut {
  return {
    ...m,
    delta_qty: num(m.delta_qty),
    balance_after: num(m.balance_after),
  };
}

export function normalizeSession(s: VoiceSessionOut): VoiceSessionOut {
  return {
    ...s,
    mode: s.mode === 'stock_in' ? 'stock_in' : 'sale',
    secondary_views: s.secondary_views || {},
    latencies: s.latencies || {},
    review_products: (s.review_products || []).map(normalizeReviewProduct),
    extraction: s.extraction
      ? {
          ...s.extraction,
          items: (s.extraction.items || []).map((it) => ({
            ...it,
            quantity: num(it.quantity, 1),
            unit_price: it.unit_price === null || it.unit_price === undefined ? null : num(it.unit_price),
            confidence: num(it.confidence),
            alternatives: (it.alternatives || []).map((a) => ({ ...a, confidence: num(a.confidence) })),
          })),
        }
      : null,
  };
}
