import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { auth } from '../lib/auth';
import { ShopOut, ShopType } from '../lib/types';

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'pick' | 'create'>('pick');
  const [pinFor, setPinFor] = useState<ShopOut | null>(null);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const shops = useQuery({ queryKey: ['shops'], queryFn: api.shops.list });

  const login = useMutation({
    mutationFn: ({ shop, pin }: { shop: ShopOut; pin: string }) => api.shops.login(shop.id, pin),
    onSuccess: (r) => {
      auth.setShop(r.shop, r.token);
      onDone();
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : (e as Error).message),
  });

  const pickShop = (shop: ShopOut) => {
    // Header-based auth (X-Shop-Id) is enough per contract; PIN login is optional.
    auth.setShop(shop, null);
    onDone();
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-5 py-8">
      <header className="mb-6 text-center">
        <img src="/icon.svg" alt="" className="mx-auto mb-3 h-16 w-16 rounded-2xl" />
        <h1 className="text-2xl font-bold text-primary-dark">Voice Dukan</h1>
        <p className="text-sm text-slate-500">Speak the bill, we write it.</p>
      </header>

      <div className="mb-4 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
        {(['pick', 'create'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setErr(null);
            }}
            className={
              'min-h-[44px] rounded-lg text-sm font-semibold ' + (mode === m ? 'bg-white text-primary shadow' : 'text-slate-600')
            }
          >
            {m === 'pick' ? 'Existing shop' : 'New shop'}
          </button>
        ))}
      </div>

      {err && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

      {mode === 'pick' && (
        <div>
          {shops.isLoading && <p className="text-sm text-slate-500">Loading shops…</p>}
          {shops.isError && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {(shops.error as Error).message}
              <button type="button" onClick={() => shops.refetch()} className="ml-2 underline">
                Retry
              </button>
            </div>
          )}
          {shops.data && shops.data.length === 0 && (
            <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-600">No shops yet. Create one.</p>
          )}
          <ul className="space-y-2">
            {shops.data?.map((s) => (
              <li key={s.id} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-2">
                <button type="button" onClick={() => pickShop(s)} className="min-h-[52px] min-w-0 flex-1 rounded-lg px-2 text-left">
                  <div className="truncate font-semibold">{s.name}</div>
                  <div className="text-xs text-slate-500">
                    {s.type} · {s.default_language} · v{s.catalog_version}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPinFor(s);
                    setPin('');
                    setErr(null);
                  }}
                  className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-xs font-medium text-slate-600"
                >
                  PIN
                </button>
              </li>
            ))}
          </ul>

          {pinFor && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                login.mutate({ shop: pinFor, pin });
              }}
              className="mt-4 rounded-xl border border-primary/30 bg-primary-light/30 p-3"
            >
              <p className="mb-2 text-sm font-semibold">Login to {pinFor.name} with PIN</p>
              <input
                type="password"
                inputMode="numeric"
                autoFocus
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="PIN"
                className="min-h-[48px] w-full rounded-lg border border-slate-300 px-3 text-lg tracking-widest"
              />
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => setPinFor(null)} className="min-h-[44px] flex-1 rounded-lg border border-slate-300 bg-white">
                  Cancel
                </button>
                <button type="submit" disabled={login.isPending || !pin} className="min-h-[44px] flex-1 rounded-lg bg-primary font-semibold text-white disabled:opacity-60">
                  {login.isPending ? 'Logging in…' : 'Login'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {mode === 'create' && <CreateShopForm onDone={onDone} onError={setErr} />}
    </div>
  );
}

function CreateShopForm({ onDone, onError }: { onDone: () => void; onError: (m: string | null) => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<ShopType>('kirana');
  const [owner, setOwner] = useState('');
  const [lang, setLang] = useState('or-IN');
  const [pin, setPin] = useState('');

  const create = useMutation({
    mutationFn: () =>
      api.shops.create({ name: name.trim(), type, default_language: lang, owner_name: owner.trim() || name.trim(), pin: pin || undefined }),
    onSuccess: (r) => {
      auth.setShop(r.shop, r.token);
      onDone();
    },
    onError: (e) => onError(e instanceof ApiError ? e.message : (e as Error).message),
  });

  const field = 'min-h-[48px] w-full rounded-lg border border-slate-300 bg-white px-3 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30';
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) create.mutate();
      }}
      className="space-y-3"
    >
      <label className="block text-sm text-slate-600">
        Shop name *
        <input className={field} value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </label>
      <label className="block text-sm text-slate-600">
        Type
        <select className={field} value={type} onChange={(e) => setType(e.target.value as ShopType)}>
          <option value="kirana">Kirana</option>
          <option value="medical">Medical</option>
          <option value="general">General</option>
        </select>
      </label>
      <label className="block text-sm text-slate-600">
        Owner name
        <input className={field} value={owner} onChange={(e) => setOwner(e.target.value)} />
      </label>
      <label className="block text-sm text-slate-600">
        Language
        <select className={field} value={lang} onChange={(e) => setLang(e.target.value)}>
          <option value="or-IN">Odia (or-IN)</option>
          <option value="hi-IN">Hindi (hi-IN)</option>
          <option value="en-IN">English (en-IN)</option>
        </select>
      </label>
      <label className="block text-sm text-slate-600">
        PIN (optional)
        <input className={field} type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} />
      </label>
      <button type="submit" disabled={create.isPending || !name.trim()} className="min-h-[52px] w-full rounded-xl bg-primary text-lg font-semibold text-white disabled:opacity-60">
        {create.isPending ? 'Creating…' : 'Create shop'}
      </button>
    </form>
  );
}
