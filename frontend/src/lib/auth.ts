const KEYS = {
  shopId: 'vd.shopId',
  token: 'vd.token',
  shopName: 'vd.shopName',
  shopType: 'vd.shopType',
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
  getToken: () => get(KEYS.token),
  getShopName: () => get(KEYS.shopName),
  getShopType: () => get(KEYS.shopType),
  setShop(shop: { id: string; name: string; type?: string }, token?: string | null) {
    set(KEYS.shopId, shop.id);
    set(KEYS.shopName, shop.name);
    set(KEYS.shopType, shop.type ?? null);
    set(KEYS.token, token ?? null);
    window.dispatchEvent(new Event('vd:auth'));
  },
  clear() {
    Object.values(KEYS).forEach((k) => set(k, null));
    window.dispatchEvent(new Event('vd:auth'));
  },
  isDebug: () => get(KEYS.debug) === '1',
  setDebug(on: boolean) {
    set(KEYS.debug, on ? '1' : null);
    window.dispatchEvent(new Event('vd:debug'));
  },
};
