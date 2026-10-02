import { auth } from './auth';
import {
  AdminOverview, AdminShopDetail, AnalyticsOut, HealthOut, MatchOut, MeOut, ProductIn, ProductOut, ProductPatch, RegisterIn, ShopOut, ShopType, StockAdjustIn,
  StockCountIn, StockMovementOut, TransactionIn, TransactionOut, VoiceMode, VoiceSessionOut,
  normalizeProduct, normalizeReviewProduct, normalizeSession, normalizeStockMovement, normalizeTransaction, num,
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

/**
 * Every request says it came from this app.
 *
 * The session lives in an HttpOnly cookie, which the browser attaches on its own and no script can
 * read, so there is nothing to put in an Authorization header any more. A cookie alone would also be
 * attached to a request another site made on the shopkeeper's behalf, so this header is the proof it
 * was us: a cross-site form cannot set one, and a cross-origin script cannot either without a CORS
 * preflight the server does not grant. The server requires it on anything that changes data.
 */
function appHeaders(): Record<string, string> {
  return { 'X-VD-App': '1' };
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
  const headers: Record<string, string> = { Accept: 'application/json', ...appHeaders() };
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
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body,
      signal: opts.signal,
      // Send the session cookie. Same-origin in production (one container) and through the Vite proxy
      // in development, so this never becomes a cross-site request.
      credentials: 'same-origin',
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'Network error. Check your connection.');
  }

  // The session ended: expired, signed out on another device, or the password was changed. Drop the
  // cached shop and let the app show the login screen rather than an error on every panel.
  //
  // Several screens are usually loading at once, and each would otherwise announce the sign-out and
  // set off another round of refetching, which is what made signing out feel like a stutter. Announce
  // it once and ignore the rest.
  if (res.status === 401 && !path.startsWith('/api/auth/') && auth.getShopId()) auth.clear();

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

  auth: {
    /** The signed-in shop, or a 401 when nobody is. This is the app's front door on every load. */
    me: () => request<MeOut>('/api/auth/me'),
    register: (body: RegisterIn) => request<MeOut>('/api/auth/register', { method: 'POST', body }),
    login: (username: string, password: string, remember: boolean) =>
      request<MeOut>('/api/auth/login', { method: 'POST', body: { username, password, remember } }),
    logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
    usernameAvailable: (username: string) =>
      request<{ username: string; available: boolean; reason: string }>('/api/auth/username-available', {
        query: { username },
      }),
    changePassword: (current_password: string, new_password: string) =>
      request<{ ok: boolean }>('/api/auth/password', { method: 'POST', body: { current_password, new_password } }),
  },

  /** What sold, what moves, what earns, over the last `days` days (1 = today), in shop time. */
  analytics: (days: number) => request<AnalyticsOut>('/api/analytics', { query: { days } }),

  /** Read-only, and only answers an account with the admin role. Everyone else gets a 404. */
  admin: {
    shops: () => request<AdminOverview>('/api/admin/shops'),
    shop: (id: string) => request<AdminShopDetail>(`/api/admin/shops/${id}`),
  },

  shops: {
    me: () => request<ShopOut>('/api/shops/me'),
    update: (body: Partial<ShopOut> & { name: string }) =>
      request<ShopOut>('/api/shops/me', { method: 'PATCH', body }),
  },

  products: {
    list: async (q?: string, lowStock?: boolean) =>
      (await request<ProductOut[]>('/api/products', { query: { q, low_stock: lowStock ? 'true' : undefined } })).map(normalizeProduct),
    create: async (body: ProductIn) => normalizeProduct(await request<ProductOut>('/api/products', { method: 'POST', body })),
    update: async (id: string, body: ProductPatch) =>
      normalizeProduct(await request<ProductOut>(`/api/products/${id}`, { method: 'PATCH', body })),
    /** Positive delta_qty adds, negative removes — in the product's own unit. */
    addStock: async (id: string, body: StockAdjustIn) =>
      normalizeProduct(await request<ProductOut>(`/api/products/${id}/stock`, { method: 'POST', body })),
    /** Set stock to a counted amount; the difference is recorded with reason "count". */
    countStock: async (id: string, body: StockCountIn) =>
      normalizeProduct(await request<ProductOut>(`/api/products/${id}/stock/count`, { method: 'POST', body })),
    /** Stock movements, newest first. Quantities are in the product's own unit. */
    ledger: async (id: string, limit = 50) =>
      (await request<StockMovementOut[]>(`/api/products/${id}/ledger`, { query: { limit } })).map(normalizeStockMovement),
    addAlias: async (id: string, alias: string, lang: string) =>
      normalizeProduct(await request<ProductOut>(`/api/products/${id}/aliases`, { method: 'POST', body: { alias, lang } })),
    deleteAlias: async (id: string, alias: string) =>
      normalizeProduct(await request<ProductOut>(`/api/products/${id}/aliases/${encodeURIComponent(alias)}`, { method: 'DELETE' })),
    /** Existing products these written names might mean. Used before offering to create anything,
     *  so stocking in adds to the product already on the shelf instead of duplicating it. */
    match: async (names: string[]) =>
      (await request<MatchOut[]>('/api/products/match', { method: 'POST', body: { names } })).map((m) => ({
        ...m,
        candidates: (m.candidates || []).map((c) => ({ ...normalizeReviewProduct(c), score: num(c.score) })),
      })),
    importCsv: (file: File) => {
      const fd = new FormData();
      fd.append('file', file, file.name);
      return request<{ created: number; updated: number }>('/api/products/import', { method: 'POST', body: fd });
    },
  },

  /** Static reference product-name list for autocomplete only — never the shop's actual inventory. */
  glossary: {
    search: (shopType: ShopType | string, q: string, limit = 20) =>
      request<string[]>('/api/glossary', { query: { shop_type: shopType, q, limit } }),
  },

  /** Photographed list: the photos are read by the OCR model, then matched against the catalog by the
   *  same extractor the voice path uses, so the response is the same session shape. */
  scan: {
    upload: async (args: { photos: Blob[]; clientSessionId: string; mode?: VoiceMode; signal?: AbortSignal }) => {
      const fd = new FormData();
      args.photos.forEach((p, i) => fd.append('images', p, `page${i + 1}.jpg`));
      fd.append('client_session_id', args.clientSessionId);
      fd.append('mode', args.mode ?? 'sale');
      return normalizeSession(await request<VoiceSessionOut>('/api/scan/sessions', { method: 'POST', body: fd, signal: args.signal }));
    },
    get: async (id: string) => normalizeSession(await request<VoiceSessionOut>(`/api/scan/sessions/${id}`)),
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
