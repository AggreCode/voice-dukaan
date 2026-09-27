import { createStore, del, get, keys, set } from 'idb-keyval';
import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { VoiceMode, VoiceSessionOut } from './types';

interface PendingBase {
  clientSessionId: string;
  /** sale or stock_in; stored so offline retries resend it. Records from older app versions lack it (= "sale"). */
  mode?: VoiceMode;
  createdAt: number;
  lastError?: string;
  attempts?: number;
}

/** A recording waiting to upload. `kind` is absent on rows written before scanning existed. */
export interface PendingVoiceUpload extends PendingBase {
  kind?: 'voice';
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

/** Photos of a paper list waiting to upload. Blobs survive in IndexedDB, so a scan taken with no
 *  signal is not lost: it uploads on the next reconnect like a recording does. */
export interface PendingScanUpload extends PendingBase {
  kind: 'image';
  photos: Blob[];
}

export type PendingUpload = PendingVoiceUpload | PendingScanUpload;

export function isScanUpload(u: PendingUpload): u is PendingScanUpload {
  return u.kind === 'image';
}

// These database names are NOT the product name and must not be renamed with it. A phone that has
// the app installed already holds recordings and photos waiting to upload under these names; renaming
// the stores would orphan that queue and lose a shopkeeper's unsent bills.
const queueStore = createStore('voice-dukan', 'upload-queue');
const sessionStore = createStore('voice-dukan-sessions', 'sessions');

const listeners = new Set<() => void>();
let pendingCount = 0;
let retrying = false;

function notify() {
  listeners.forEach((l) => l());
}

export function subscribePending(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
export function getPendingCount() {
  return pendingCount;
}

export async function refreshPendingCount(): Promise<number> {
  try {
    const ks = await keys(queueStore);
    pendingCount = ks.length;
  } catch {
    pendingCount = 0;
  }
  notify();
  return pendingCount;
}

export async function listPending(): Promise<PendingUpload[]> {
  const ks = await keys(queueStore);
  const out: PendingUpload[] = [];
  for (const k of ks) {
    const v = await get<PendingUpload>(k, queueStore);
    if (v) out.push(v);
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

export async function cacheSession(s: VoiceSessionOut) {
  try {
    await set(`session:${s.session_id}`, s, sessionStore);
    if (s.client_session_id) await set(`client:${s.client_session_id}`, s.session_id, sessionStore);
  } catch {
    /* ignore cache failures */
  }
}
export async function getCachedSession(id: string): Promise<VoiceSessionOut | undefined> {
  try {
    return await get<VoiceSessionOut>(`session:${id}`, sessionStore);
  } catch {
    return undefined;
  }
}

/** Errors that mean "don't bother retrying automatically". */
function isPermanent(e: unknown): boolean {
  if (e instanceof ApiError) return e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429;
  return false;
}

async function uploadOne(item: PendingUpload, signal?: AbortSignal): Promise<VoiceSessionOut> {
  const mode = item.mode === 'stock_in' ? 'stock_in' : 'sale';
  const session = isScanUpload(item)
    ? await api.scan.upload({ photos: item.photos, clientSessionId: item.clientSessionId, mode, signal })
    : await api.voice.upload({
        audio: item.blob,
        clientSessionId: item.clientSessionId,
        durationMs: item.durationMs,
        mimeType: item.mimeType,
        mode,
        signal,
      });
  await cacheSession(session);
  await del(item.clientSessionId, queueStore);
  await refreshPendingCount();
  return session;
}

/**
 * Persist the capture first (so a crash or dead signal can't lose it), then upload.
 * Resolves with the session on success; rejects (but keeps the item queued) on failure.
 */
async function persistThenUpload(item: PendingUpload, signal?: AbortSignal): Promise<VoiceSessionOut> {
  await set(item.clientSessionId, item, queueStore);
  await refreshPendingCount();
  try {
    return await uploadOne(item, signal);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      await set(item.clientSessionId, { ...item, attempts: 1, lastError: msg }, queueStore);
    } catch {
      /* ignore */
    }
    throw e;
  }
}

export function enqueueAndUpload(
  args: { clientSessionId: string; blob: Blob; mimeType: string; durationMs: number; mode: VoiceMode },
  signal?: AbortSignal,
): Promise<VoiceSessionOut> {
  return persistThenUpload({ ...args, kind: 'voice', createdAt: Date.now(), attempts: 0 }, signal);
}

export function enqueueAndUploadScan(
  args: { clientSessionId: string; photos: Blob[]; mode: VoiceMode },
  signal?: AbortSignal,
): Promise<VoiceSessionOut> {
  return persistThenUpload({ ...args, kind: 'image', createdAt: Date.now(), attempts: 0 }, signal);
}

export async function removePending(clientSessionId: string) {
  await del(clientSessionId, queueStore);
  await refreshPendingCount();
}

export interface RetryResult {
  uploaded: VoiceSessionOut[];
  failed: { clientSessionId: string; error: string }[];
}

export async function retryAll(): Promise<RetryResult> {
  const result: RetryResult = { uploaded: [], failed: [] };
  if (retrying) return result;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return result;
  retrying = true;
  try {
    const items = await listPending();
    for (const item of items) {
      try {
        const s = await uploadOne(item);
        result.uploaded.push(s);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        result.failed.push({ clientSessionId: item.clientSessionId, error: msg });
        try {
          await set(item.clientSessionId, { ...item, attempts: (item.attempts ?? 0) + 1, lastError: msg }, queueStore);
        } catch {
          /* ignore */
        }
        if (isPermanent(e)) continue; // skip this one, try others
        if (e instanceof ApiError && e.status === 0) break; // offline: stop the loop
      }
    }
  } finally {
    retrying = false;
    await refreshPendingCount();
  }
  return result;
}

let installed = false;
/** Wire up automatic retry on reconnect / app focus. Idempotent. */
export function installAutoRetry() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('online', () => void retryAll());
  window.addEventListener('focus', () => void retryAll());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void retryAll();
  });
  void refreshPendingCount().then((n) => {
    if (n > 0) void retryAll();
  });
}

export function usePendingCount(): number {
  const [n, setN] = useState(pendingCount);
  useEffect(() => {
    const unsub = subscribePending(() => setN(pendingCount));
    void refreshPendingCount();
    return unsub;
  }, []);
  return n;
}
