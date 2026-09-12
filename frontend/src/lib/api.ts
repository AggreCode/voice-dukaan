import { auth } from './auth';
import {
  HealthOut, ProductIn, ProductOut, ProductUpdate, ShopOut, StockAdjustIn, StockCountIn, StockMovementOut,
  TransactionIn, TransactionOut, VoiceMode, VoiceSessionOut,
  normalizeProduct, normalizeSession, normalizeStockMovement, normalizeTransaction,
} from './types';

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  const token = auth.getToken();
  const shopId = auth.getShopId();
  if (token) h['Authorization'] = `Bearer ${token}`;
  if (shopId) h['X-Shop-Id'] = shopId;
  return h;
}

function extractMessage(status: number, body: unknown): string {
  if (body && typeof body === 'object') {
    const b = body as { detail?: unknown; message?: unknown; error?: unknown };
    const d = b.detail ?? b.message ?? b.error;
    if (typeof d === 'string') return d;
    if (Array.isArray(d)) {
      // FastAPI validation errors
      return d
        .map((e) => (e && typeof e === 'object' && 'msg' in e ? `${(e as { loc?: unknown[] }).loc?.join('.') ?? ''}: ${(e as { msg: string }).msg}` : JSON.stringify(e)))
        .join('; ');
    }
  }
  if (typeof body === 'string' && body) return body;
  return `Request failed (${status})`;
}

export interface RequestOptions {
  method?: string;
  body?: unknown; // JSON object or FormData
  signal?: AbortSignal;
  query?: Record<string, string | number | boolean | undefined | null>;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...authHeaders() };
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) {
    body = opts.body;
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let url = path;
  if (opts.query) {
    const qs = new URLSearchParams();
    Object.entries(opts.query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    });
    const s = qs.toString();
    if (s) url += (url.includes('?') ? '&' : '?') + s;
  }

  let res: Response;
  try {
    res = await fetch(url, { method: opts.method ?? 'GET', headers, body, signal: opts.signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'Network error. Check your connection.');
  }

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!res.ok) throw new ApiError(res.status, extractMessage(res.status, parsed), parsed);
  return parsed as T;
}

export const api = {
  health: () => request<HealthOut>('/api/health'),

  shops: {
    list: () => request<ShopOut[]>('/api/shops'),
    create: (body: { name: string; type: string; default_language: string; owner_name: string; pin?: string }) =>
      request<{ token: string; shop: ShopOut }>('/api/shops', { method: 'POST', body }),
    login: (shop_id: string, pin: string) =>
      request<{ token: string; shop: ShopOut }>('/api/auth/login', { method: 'POST', body: { shop_id, pin } }),
    me: () => request<ShopOut>('/api/shops/me'),
  },

  products: {
    list: async (q?: string, lowStock?: boolean) =>
      (await request<ProductOut[]>('/api/products', { query: { q, low_stock: lowStock ? 'true' : undefined } })).map(normalizeProduct),
    create: async (body: ProductIn) => normalizeProduct(await request<ProductOut>('/api/products', { method: 'POST', body })),
    update: async (id: string, body: ProductUpdate) =>
      normalizeProduct(await request<ProductOut>(`/api/products/${id}`, { method: 'PATCH', body })),
    /** Positive qty adds, negative removes. qty+unit is converted to base units by the server. */
    addStock: async (id: string, body: StockAdjustIn) =>
      normalizeProduct(await request<ProductOut>(`/api/products/${id}/stock`, { method: 'POST', body })),
    /** @deprecated use addStock with qty+unit */
    adjustStock: async (id: string, body: { delta_qty: number; reason: string; note?: string }) =>
      normalizeProduct(await request<ProductOut>(`/api/products/${id}/stock`, { method: 'POST', body })),
    /** Set stock to a counted amount; the difference is recorded with reason "count". */
    countStock: async (id: string, body: StockCountIn) =>
      normalizeProduct(await request<ProductOut>(`/api/products/${id}/stock/count`, { method: 'POST', body })),
    /** Stock movements, newest first. Quantities are in the product's sub_unit. */
    ledger: async (id: string, limit = 50) =>
      (await request<StockMovementOut[]>(`/api/products/${id}/ledger`, { query: { limit } })).map(normalizeStockMovement),
    addAlias: async (id: string, alias: string, lang: string) =>
      normalizeProduct(await request<ProductOut>(`/api/products/${id}/aliases`, { method: 'POST', body: { alias, lang } })),
    deleteAlias: async (id: string, alias: string) =>
      normalizeProduct(await request<ProductOut>(`/api/products/${id}/aliases/${encodeURIComponent(alias)}`, { method: 'DELETE' })),
    importCsv: (file: File) => {
      const fd = new FormData();
      fd.append('file', file, file.name);
      return request<{ created: number; updated: number }>('/api/products/import', { method: 'POST', body: fd });
    },
  },

  voice: {
    upload: async (args: { audio: Blob; clientSessionId: string; durationMs: number; mimeType: string; mode?: VoiceMode; signal?: AbortSignal }) => {
      const fd = new FormData();
      const ext = args.mimeType.includes('mp4') ? 'm4a' : args.mimeType.includes('ogg') ? 'ogg' : 'webm';
      fd.append('audio', args.audio, `recording.${ext}`);
      fd.append('client_session_id', args.clientSessionId);
      fd.append('duration_ms', String(Math.round(args.durationMs)));
      fd.append('mime_type', args.mimeType);
      fd.append('mode', args.mode ?? 'sale');
      return normalizeSession(await request<VoiceSessionOut>('/api/voice/sessions', { method: 'POST', body: fd, signal: args.signal }));
    },
    get: async (id: string) => normalizeSession(await request<VoiceSessionOut>(`/api/voice/sessions/${id}`)),
    list: async (limit = 30) => (await request<VoiceSessionOut[]>('/api/voice/sessions', { query: { limit } })).map(normalizeSession),
  },

  transactions: {
    create: async (body: TransactionIn) =>
      normalizeTransaction(await request<TransactionOut>('/api/transactions', { method: 'POST', body })),
    list: async (day?: string, limit?: number) =>
      (await request<TransactionOut[]>('/api/transactions', { query: { day, limit } })).map(normalizeTransaction),
    void: async (id: string) => normalizeTransaction(await request<TransactionOut>(`/api/transactions/${id}/void`, { method: 'POST' })),
  },
};
