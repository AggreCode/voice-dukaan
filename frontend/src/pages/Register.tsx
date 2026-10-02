import { FormEvent, useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { MeOut, RegisterIn, ShopType } from '../lib/types';
import { cx } from '../lib/utils';
import { Brand, PasswordField, fieldClass, invalidClass, labelClass } from './Login';

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
  const [tried1, setTried1] = useState(false);
  const [tried2, setTried2] = useState(false);

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

  /**
   * What is wrong with each box, in words a shopkeeper would use, or null when it is fine.
   *
   * A box goes red the moment it has something wrong IN it -- a space typed into the username shows
   * immediately, not after pressing Next. An EMPTY required box only goes red once they have tried to
   * move on, so a fresh form does not open covered in red.
   */
  const gstClean = gst.replace(/\s/g, '').toUpperCase();
  const u = username.trim().toLowerCase();
  const problem = {
    name: name.trim().length === 0 ? (tried1 ? 'Enter your shop name.' : null) : name.trim().length < 2 ? 'Shop name is too short.' : null,
    mobile: !mobile.trim() ? (tried1 ? 'Enter your mobile number.' : null) : !mobileOk(mobile) ? 'Enter a 10 digit mobile number.' : null,
    whatsapp: !sameWhatsapp && whatsapp.trim() && !mobileOk(whatsapp) ? 'Enter a 10 digit WhatsApp number.' : null,
    gst: gstClean && !/^[0-9A-Z]{15}$/.test(gstClean) ? `A GST number has 15 letters and numbers (this has ${gstClean.length}).` : null,
    username: !username ? (tried2 ? 'Choose a username.' : null)
      : /\s/.test(username) ? 'No spaces allowed. Use a dot or underscore instead, like maa.tarini'
      : u.length < 3 ? 'At least 3 letters.'
      : !usernameOk(u) ? 'Only small letters, numbers, dot, dash or underscore.'
      : available && !available.ok ? `Not available: ${available.reason}. Try another.` : null,
    password: !password ? (tried2 ? `Choose a password of at least ${MIN_PASSWORD} characters.` : null)
      : password.length < MIN_PASSWORD ? `Use at least ${MIN_PASSWORD} characters (${password.length} so far).` : null,
    confirm: !confirm ? (tried2 && password ? 'Type the password again.' : null)
      : confirm !== password ? 'The two passwords do not match.' : null,
  };
  const step1Ok = name.trim().length >= 2 && mobileOk(mobile) && !problem.whatsapp && !problem.gst;
  const step2Ok = usernameOk(u) && available?.ok !== false && password.length >= MIN_PASSWORD && password === confirm;
  const box = (p: string | null, extra = '') => cx(fieldClass, extra, p && invalidClass);
  const Hint = ({ p }: { p: string | null }) =>
    p ? <p className="mt-1.5 flex items-start gap-1 text-sm font-semibold text-red-600"><span aria-hidden>⚠</span>{p}</p> : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (step === 1) {
      setTried1(true);
      if (step1Ok) setStep(2);
      return;
    }
    setTried2(true);
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

      <form onSubmit={submit} noValidate className="space-y-4 rounded-2xl bg-white p-5 shadow-sm">
        {step === 1 ? (
          <>
            <div>
              <label className={labelClass} htmlFor="shop">Shop name *</label>
              <input id="shop" className={box(problem.name)} value={name} autoFocus placeholder="Maa Tarini Store"
                     onChange={(e) => setName(e.target.value)} aria-invalid={!!problem.name} />
              <Hint p={problem.name} />
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
              <input id="mobile" className={box(problem.mobile)} value={mobile} inputMode="tel" autoComplete="tel"
                     placeholder="9876543210" onChange={(e) => setMobile(e.target.value)} aria-invalid={!!problem.mobile} />
              <Hint p={problem.mobile} />
              <p className="mt-1 text-xs text-slate-500">You can sign in with this number too.</p>
            </div>

            <div>
              <label className="flex items-center gap-2.5 text-sm text-slate-700">
                <input type="checkbox" checked={sameWhatsapp} onChange={(e) => setSameWhatsapp(e.target.checked)}
                       className="h-5 w-5 rounded border-slate-300 text-primary focus:ring-primary/30" />
                WhatsApp number is the same
              </label>
              {!sameWhatsapp && (
                <>
                  <input className={box(problem.whatsapp, 'mt-2')} value={whatsapp} inputMode="tel"
                         placeholder="WhatsApp number" onChange={(e) => setWhatsapp(e.target.value)} />
                  <Hint p={problem.whatsapp} />
                </>
              )}
            </div>

            <div>
              <label className={labelClass} htmlFor="gst">GST number <span className="font-normal text-slate-400">(optional)</span></label>
              <input id="gst" className={box(problem.gst, 'uppercase')} value={gst} autoCapitalize="characters"
                     placeholder="21ABCDE1234F1Z5" onChange={(e) => setGst(e.target.value)} />
              <Hint p={problem.gst} />
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
              <input id="username" className={cx(box(problem.username), !problem.username && available?.ok && '!border-2 !border-emerald-500 !bg-emerald-50')}
                     value={username} autoFocus autoCapitalize="none" autoCorrect="off" autoComplete="username"
                     placeholder="maa.tarini" aria-invalid={!!problem.username}
                     onChange={(e) => setUsername(e.target.value.toLowerCase())} />
              {problem.username ? (
                <Hint p={problem.username} />
              ) : available?.ok ? (
                <p className="mt-1.5 text-sm font-semibold text-emerald-700">✓ “{u}” is free — it is yours.</p>
              ) : (
                <p className="mt-1.5 text-xs text-slate-500">Small letters and numbers. No spaces.</p>
              )}
            </div>

            <div>
              <PasswordField id="new-password" label="Password *" value={password} onChange={setPassword}
                             autoComplete="new-password" placeholder={`At least ${MIN_PASSWORD} characters`}
                             invalid={!!problem.password} />
              <Hint p={problem.password} />
            </div>

            <div>
              <PasswordField id="confirm-password" label="Confirm password *" value={confirm} onChange={setConfirm}
                             autoComplete="new-password" invalid={!!problem.confirm} />
              <Hint p={problem.confirm} />
            </div>

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
            disabled={create.isPending}
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
