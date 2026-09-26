import { StockAdjustReason, VoiceMode } from './types';

/**
 * Sample value for the product "Local name" field. This is example data, not UI chrome,
 * and is the only non-Latin script string allowed in source.
 */
export const LOCAL_NAME_PLACEHOLDER = 'e.g. ପାରାସିଟାମଲ';
export const LOCAL_NAME_HELP = 'How customers say it in your language (optional)';

export const VOICE_MODE_STORAGE_KEY = 'vd.recordMode';

export const VOICE_MODES: { value: VoiceMode; label: string }[] = [
  { value: 'sale', label: 'Sale' },
  { value: 'stock_in', label: 'Stock in' },
];

/** Suggestions only for a free-text unit `<input>` + `<datalist>` — never a constrained `<select>`. */
export const COMMON_UNITS = [
  'piece', 'kg', 'g', 'litre', 'ml', 'box', 'carton', 'packet', 'strip', 'bottle',
  'dozen', 'bag', 'bundle', 'gross', 'roll', 'pair', 'set',
];

export const STOCK_ADJUST_REASONS: { value: StockAdjustReason; label: string }[] = [
  { value: 'restock', label: 'Restock' },
  { value: 'damage', label: 'Damaged' },
  { value: 'expired', label: 'Expired' },
  { value: 'return', label: 'Returned' },
  { value: 'adjustment', label: 'Other adjustment' },
];

const MOVEMENT_REASON_LABELS: Record<string, string> = {
  sale: 'Sale',
  purchase: 'Stock in',
  adjustment: 'Adjustment',
  return: 'Returned',
  opening: 'Opening stock',
  void: 'Bill voided',
  count: 'Stock count',
  restock: 'Restock',
  damage: 'Damaged',
  expired: 'Expired',
};

export function movementReasonLabel(reason: string): string {
  return MOVEMENT_REASON_LABELS[reason] ?? (reason ? reason.charAt(0).toUpperCase() + reason.slice(1) : 'Change');
}

/**
 * The model returns machine-readable reasons ("no_quantity", "ambiguous_product"). A shopkeeper should
 * never be shown those, so each one gets a sentence saying what to do about it. An unknown reason falls
 * back to the raw string rather than being hidden: better odd wording than a silent flag.
 */
const EXTRACTION_REASON_LABELS: Record<string, string> = {
  no_quantity: 'No quantity given — check',
  no_quantity_evidence: 'Quantity not clearly given — check',
  ambiguous_product: 'Could be more than one item',
  ambiguous_category: 'Which one? Tap to pick',
  not_in_catalog: 'Not in your inventory',
  unknown_id: 'Item not recognised',
  unit_assumed: 'Unit assumed from inventory',
  unit_mismatch_catalog: 'Unit differs from inventory',
  span_not_in_transcript: 'Not found in the text',
  price_without_evidence: 'No price given',
  low_confidence: 'Unsure — please check',
  asr_garbled: 'Speech was unclear',
  ocr_unclear: 'Writing was unclear',
  partial_word: 'Word was cut short',
  fuzzy_matched: 'Matched on spelling — check',
  mock_extractor_no_llm: 'Matching is switched off',
};

/** Reasons arrive comma-joined from the guards. */
export function extractionReasonLabel(reason: string | null | undefined): string {
  if (!reason) return '';
  return reason
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => EXTRACTION_REASON_LABELS[r] ?? r.replace(/_/g, ' '))
    .join(' · ');
}

export const CSV_COLUMNS = 'name, brand, category, unit, sell_price, aliases (separated by ;), opening_stock, local_name';
