import { createStore, del, get, keys, set } from 'idb-keyval';
import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { VoiceMode, VoiceSessionOut } from './types';

export interface PendingUpload {
  clientSessionId: string;
  blob: Blob;
  mimeType: string;
  durationMs: number;
  /** Recording mode; stored so offline retries resend it. Records from older app versions lack it (= "sale"). */
  mode?: VoiceMode;
  createdAt: number;
  lastError?: string;
  attempts?: number;
}

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
  const session = await api.voice.upload({
    audio: item.blob,
    clientSessionId: item.clientSessionId,
    durationMs: item.durationMs,
    mimeType: item.mimeType,
    mode: item.mode === 'stock_in' ? 'stock_in' : 'sale',
    signal,
  });
  await cacheSession(session);
  await del(item.clientSessionId, queueStore);
  await refreshPendingCount();
  return session;
}

/**
 * Persist the recording first (so a crash/offline can't lose it), then upload.
 * Resolves with the session on success; rejects (but keeps the item queued) on failure.
 */
export async function enqueueAndUpload(
  args: { clientSessionId: string; blob: Blob; mimeType: string; durationMs: number; mode: VoiceMode },
  signal?: AbortSignal,
): Promise<VoiceSessionOut> {
  const item: PendingUpload = { ...args, createdAt: Date.now(), attempts: 0 };
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
