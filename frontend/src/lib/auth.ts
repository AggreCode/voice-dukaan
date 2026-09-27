/**
 * What the screens need to render before the server answers. Not credentials: the session is an
 * HttpOnly cookie that no script here can read or forge, which is the point. Anything in this file
 * can be stale or missing and the app must still work.
 */
const KEYS = {
  shopId: 'vd.shopId',
  shopName: 'vd.shopName',
  shopType: 'vd.shopType',
  username: 'vd.username',
  debug: 'vd.debug',
} as const;

function get(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function set(k: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}

export const auth = {
  getShopId: () => get(KEYS.shopId),
  getShopName: () => get(KEYS.shopName),
  getShopType: () => get(KEYS.shopType),
  getUsername: () => get(KEYS.username),
  remember(me: { shop: { id: string; name: string; type?: string }; user?: { username: string | null } }) {
    set(KEYS.shopId, me.shop.id);
    set(KEYS.shopName, me.shop.name);
    set(KEYS.shopType, me.shop.type ?? null);
    set(KEYS.username, me.user?.username ?? null);
    window.dispatchEvent(new Event('vd:auth'));
  },
  clear() {
    const debug = get(KEYS.debug);
    Object.values(KEYS).forEach((k) => set(k, null));
    set(KEYS.debug, debug); // a developer's own switch is not part of the session
    window.dispatchEvent(new Event('vd:auth'));
  },
  isDebug: () => get(KEYS.debug) === '1',
  setDebug(on: boolean) {
    set(KEYS.debug, on ? '1' : null);
    window.dispatchEvent(new Event('vd:debug'));
  },
};
