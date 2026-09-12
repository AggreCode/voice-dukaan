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

export const CSV_COLUMNS = 'name, brand, category, pack_unit, sub_unit, pack_size, sell_price, aliases (separated by ;), opening_stock, local_name';
