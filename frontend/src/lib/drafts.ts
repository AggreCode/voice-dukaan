import { useEffect, useState } from 'react';
import { auth } from './auth';
import { PickedProduct, ReviewItem } from './reviewModel';
import { PaymentMode, VoiceMode } from './types';

/**
 * Bills that are started but not saved, kept on the phone until the shopkeeper saves or discards them.
 *
 * A shop counter is all interruptions: a customer asks for something else, the phone rings, the
 * shopkeeper taps another tab to check a price. Losing ten typed lines to that is the fastest way to
 * make someone give up on an app. So every change to a bill is written down here as it happens, the
 * bill comes back exactly as it was, and Home says "you left a bill unfinished" in case they forget
 * where it was. Only Save or an explicit Discard removes it.
 *
 * Stored per shop, so a second shop signing in on the same phone never sees the first one's bills.
 */
export type DraftSource = 'voice' | 'photo' | 'manual';

export interface DraftMeta {
  key: string;
  route: string;
  mode: VoiceMode;
  source: DraftSource;
  items: number;
  total: number;
  preview: string;
  updatedAt: number;
}

export interface DraftState {
  items: ReviewItem[];
  deleted: number[];
  payment: PaymentMode;
  customer: string;
  /** Products that came with lines spoken in later, so their "which one?" choices survive a return. */
  extraProducts?: PickedProduct[];
}

interface Store {
  [key: string]: { meta: DraftMeta; state?: DraftState };
}

const EVENT = 'vd:drafts';

function storeKey(): string | null {
  const shop = auth.getShopId();
  return shop ? `vd.drafts.${shop}` : null;
}

function read(): Store {
  const k = storeKey();
  if (!k) return {};
  try {
    return JSON.parse(localStorage.getItem(k) || '{}') as Store;
  } catch {
    return {};
  }
}

function write(s: Store): void {
  const k = storeKey();
  if (!k) return;
  try {
    localStorage.setItem(k, JSON.stringify(s));
  } catch {
    /* full or blocked storage: the bill is still on screen, just not kept */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function saveDraft(meta: DraftMeta, state?: DraftState): void {
  const s = read();
  s[meta.key] = { meta, state: state ?? s[meta.key]?.state };
  write(s);
}

export function loadDraft(key: string): DraftState | null {
  return read()[key]?.state ?? null;
}

export function clearDraft(key: string): void {
  const s = read();
  if (!(key in s)) return;
  delete s[key];
  write(s);
}

export function listDrafts(): DraftMeta[] {
  return Object.values(read())
    .map((d) => d.meta)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function useDrafts(): DraftMeta[] {
  const [list, setList] = useState<DraftMeta[]>(() => listDrafts());
  useEffect(() => {
    const h = () => setList(listDrafts());
    window.addEventListener(EVENT, h);
    window.addEventListener('vd:auth', h);
    window.addEventListener('storage', h);
    return () => {
      window.removeEventListener(EVENT, h);
      window.removeEventListener('vd:auth', h);
      window.removeEventListener('storage', h);
    };
  }, []);
  return list;
}

/** "5 min ago", for the unfinished-bill card. */
export function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}
