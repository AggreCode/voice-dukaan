import { FormEvent, useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { MeOut, RegisterIn, ShopType } from '../lib/types';
import { cx } from '../lib/utils';
import { Brand, PasswordField, fieldClass, labelClass } from './Login';

const MIN_PASSWORD = 8;

/** Digits only, so "98765 43210" and "+91 98765-43210" both pass. */
function mobileOk(v: string): boolean {
  const digits = v.replace(/[\s()-]/g, '');
  return /^\+?[0-9]{10,15}$/.test(digits);
}
function usernameOk(v: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{2,31}$/.test(v);
}

type Step = 1 | 2;

export default function Register({ onDone, onSignIn }: { onDone: (me: MeOut) => void; onSignIn: () => void }) {
  const [step, setStep] = useState<Step>(1);

  // step 1 — the shop
  const [name, setName] = useState('');
  const [type, setType] = useState<ShopType>('kirana');
  const [lang, setLang] = useState('or-IN');
  const [mobile, setMobile] = useState('');
  const [sameWhatsapp, setSameWhatsapp] = useState(true);
  const [whatsapp, setWhatsapp] = useState('');
  const [gst, setGst] = useState('');
  const [address, setAddress] = useState('');

  // step 2 — the login
  const [owner, setOwner] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [available, setAvailable] = useState<{ ok: boolean; reason: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Tell them the username is taken while they type it, not after they have filled in everything else.
  useEffect(() => {
    const candidate = username.trim().toLowerCase();
    if (!usernameOk(candidate)) {
      setAvailable(null);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(async () => {
      try {
        const r = await api.auth.usernameAvailable(candidate);
        if (!cancelled) setAvailable({ ok: r.available, reason: r.reason });
      } catch {
        if (!cancelled) setAvailable(null);
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [username]);

  const create = useMutation({
    mutationFn: () => {
      const body: RegisterIn = {
        name: name.trim(),
        type,
        default_language: lang,
        mobile: mobile.trim(),
        whatsapp: sameWhatsapp ? mobile.trim() : whatsapp.trim() || null,
        gst_number: gst.trim() || null,
        address: address.trim() || null,
        owner_name: owner.trim() || name.trim(),
        username: username.trim().toLowerCase(),
        password,
      };
      return api.auth.register(body);
    },
    onSuccess: onDone,
    onError: (e) => setErr(e instanceof ApiError ? e.message : (e as Error).message),
  });

  const step1Ok = name.trim().length >= 2 && mobileOk(mobile) && (sameWhatsapp || !whatsapp.trim() || mobileOk(whatsapp));
  const step2Ok =
    usernameOk(username.trim().toLowerCase()) &&
    available?.ok !== false &&
    password.length >= MIN_PASSWORD &&
    password === confirm;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (step === 1) {
      if (step1Ok) setStep(2);
      return;
    }
    if (step2Ok) create.mutate();
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-5 py-8">
      <Brand tagline="Set your shop up once. It takes a minute." />

      <ol className="mb-5 flex items-center gap-2" aria-label="Progress">
        {([1, 2] as const).map((n) => (
          <li key={n} className="flex flex-1 items-center gap-2">
            <span
              className={cx(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                step >= n ? 'bg-primary text-white' : 'bg-slate-200 text-slate-500',
              )}
            >
              {n}
            </span>
            <span className={cx('text-xs font-semibold', step >= n ? 'text-primary-dark' : 'text-slate-400')}>
              {n === 1 ? 'Your shop' : 'Your login'}
            </span>
            {n === 1 && <span className={cx('h-0.5 flex-1 rounded', step > 1 ? 'bg-primary' : 'bg-slate-200')} />}
          </li>
        ))}
      </ol>

      {err && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

      <form onSubmit={submit} className="space-y-4 rounded-2xl bg-white p-5 shadow-sm">
        {step === 1 ? (
          <>
            <div>
              <label className={labelClass} htmlFor="shop">Shop name *</label>
              <input id="shop" className={fieldClass} value={name} autoFocus placeholder="Maa Tarini Store"
                     onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass} htmlFor="type">Shop type</label>
                <select id="type" className={fieldClass} value={type} onChange={(e) => setType(e.target.value as ShopType)}>
                  <option value="kirana">Kirana</option>
                  <option value="medical">Medical</option>
                  <option value="general">General</option>
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="lang">Language</label>
                <select id="lang" className={fieldClass} value={lang} onChange={(e) => setLang(e.target.value)}>
                  <option value="or-IN">Odia</option>
                  <option value="hi-IN">Hindi</option>
                  <option value="en-IN">English</option>
                </select>
              </div>
            </div>

            <div>
              <label className={labelClass} htmlFor="mobile">Mobile number *</label>
              <input id="mobile" className={fieldClass} value={mobile} inputMode="tel" autoComplete="tel"
                     placeholder="9876543210" onChange={(e) => setMobile(e.target.value)} />
              {mobile && !mobileOk(mobile) && (
                <p className="mt-1 text-xs text-red-600">Enter a 10 digit mobile number.</p>
              )}
              <p className="mt-1 text-xs text-slate-500">You can sign in with this number too.</p>
            </div>

            <div>
              <label className="flex items-center gap-2.5 text-sm text-slate-700">
                <input type="checkbox" checked={sameWhatsapp} onChange={(e) => setSameWhatsapp(e.target.checked)}
                       className="h-5 w-5 rounded border-slate-300 text-primary focus:ring-primary/30" />
                WhatsApp number is the same
              </label>
              {!sameWhatsapp && (
                <input className={cx(fieldClass, 'mt-2')} value={whatsapp} inputMode="tel"
                       placeholder="WhatsApp number" onChange={(e) => setWhatsapp(e.target.value)} />
              )}
            </div>

            <div>
              <label className={labelClass} htmlFor="gst">GST number <span className="font-normal text-slate-400">(optional)</span></label>
              <input id="gst" className={cx(fieldClass, 'uppercase')} value={gst} autoCapitalize="characters"
                     placeholder="21ABCDE1234F1Z5" onChange={(e) => setGst(e.target.value)} />
            </div>

            <div>
              <label className={labelClass} htmlFor="address">Shop address</label>
              <textarea id="address" className={cx(fieldClass, 'min-h-[80px] py-2.5')} value={address} rows={2}
                        placeholder="Street, town, district" onChange={(e) => setAddress(e.target.value)} />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className={labelClass} htmlFor="owner">Your name</label>
              <input id="owner" className={fieldClass} value={owner} autoComplete="name"
                     placeholder="Shop owner" onChange={(e) => setOwner(e.target.value)} />
            </div>

            <div>
              <label className={labelClass} htmlFor="username">Username *</label>
              <input id="username" className={fieldClass} value={username} autoFocus autoCapitalize="none"
                     autoCorrect="off" autoComplete="username" placeholder="maa.tarini"
                     onChange={(e) => setUsername(e.target.value.toLowerCase())} />
              {username && !usernameOk(username.trim().toLowerCase()) ? (
                <p className="mt-1 text-xs text-slate-500">
                  3 to 32 characters: small letters, digits, dot, dash or underscore.
                </p>
              ) : available ? (
                <p className={cx('mt-1 text-xs font-medium', available.ok ? 'text-emerald-700' : 'text-red-600')}>
                  {available.ok ? `"${username.trim().toLowerCase()}" is free` : `Not available: ${available.reason}`}
                </p>
              ) : null}
            </div>

            <PasswordField id="new-password" label="Password *" value={password} onChange={setPassword}
                           autoComplete="new-password" placeholder={`At least ${MIN_PASSWORD} characters`} />
            {password && password.length < MIN_PASSWORD && (
              <p className="text-xs text-red-600">Use at least {MIN_PASSWORD} characters.</p>
            )}

            <PasswordField id="confirm-password" label="Confirm password *" value={confirm} onChange={setConfirm}
                           autoComplete="new-password" />
            {confirm && confirm !== password && <p className="text-xs text-red-600">The two passwords do not match.</p>}

            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
              Write this down somewhere safe. Nobody can read your password back to you, not even us: only a
              scrambled version of it is stored.
            </p>
          </>
        )}

        <div className="flex gap-2 pt-1">
          {step === 2 && (
            <button type="button" onClick={() => setStep(1)}
                    className="min-h-[54px] flex-1 rounded-xl border border-slate-300 bg-white font-semibold text-slate-700">
              Back
            </button>
          )}
          <button
            type="submit"
            disabled={step === 1 ? !step1Ok : !step2Ok || create.isPending}
            className="min-h-[54px] flex-[2] rounded-xl bg-primary text-base font-bold text-white shadow-sm active:bg-primary-dark disabled:bg-slate-300"
          >
            {step === 1 ? 'Next' : create.isPending ? 'Creating…' : 'Create account'}
          </button>
        </div>
      </form>

      <p className="mt-5 text-center text-sm text-slate-600">
        Already have an account?{' '}
        <button type="button" onClick={onSignIn} className="min-h-[44px] font-bold text-primary underline">
          Sign in
        </button>
      </p>
    </div>
  );
}
