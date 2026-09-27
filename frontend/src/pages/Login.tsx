import { FormEvent, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useSlowHint } from '../lib/useSlowHint';
import { MeOut } from '../lib/types';
import { cx } from '../lib/utils';

export const fieldClass =
  'min-h-[52px] w-full rounded-xl border border-slate-300 bg-white px-3.5 text-base text-slate-900 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25';
export const labelClass = 'mb-1.5 block text-sm font-medium text-slate-700';

export function Brand({ tagline }: { tagline: string }) {
  return (
    <header className="mb-7 text-center">
      <img src="/icon.svg" alt="" className="mx-auto mb-3 h-16 w-16 rounded-2xl shadow-sm" />
      <h1 className="text-2xl font-bold tracking-tight text-primary-dark">Mo Dokan</h1>
      <p className="mt-1 text-sm text-slate-500">{tagline}</p>
    </header>
  );
}

export function PasswordField({
  id, value, onChange, placeholder, autoComplete, label,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete: string;
  label: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div>
      <label className={labelClass} htmlFor={id}>{label}</label>
      <div className="relative">
        <input
          id={id}
          className={cx(fieldClass, 'pr-16')}
          type={shown ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          className="absolute right-1 top-1 min-h-[44px] rounded-lg px-3 text-xs font-semibold text-slate-500"
        >
          {shown ? 'Hide' : 'Show'}
        </button>
      </div>
    </div>
  );
}

export default function Login({ onSignedIn, onRegister }: { onSignedIn: (me: MeOut) => void; onRegister: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const signIn = useMutation({
    mutationFn: () => api.auth.login(username.trim(), password, remember),
    onSuccess: onSignedIn,
    onError: (e) => setErr(e instanceof ApiError ? e.message : (e as Error).message),
  });

  const waking = useSlowHint(signIn.isPending, 4000);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (username.trim() && password) signIn.mutate();
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-5 py-10">
      <Brand tagline="Speak or photograph the bill. We write it." />

      <form onSubmit={submit} className="space-y-4 rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">Sign in</h2>

        {err && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

        <div>
          <label className={labelClass} htmlFor="username">Username or mobile number</label>
          <input
            id="username"
            className={fieldClass}
            value={username}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            inputMode="text"
            placeholder="maa.tarini or 9876543210"
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>

        <PasswordField id="password" label="Password" value={password} onChange={setPassword} autoComplete="current-password" />

        {/* The session cookie is needed to sign in at all, so it is not something to ask permission
            for. How long it lasts is a real choice, and this is it, said in one line. */}
        <label className="flex items-start gap-2.5 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 text-primary focus:ring-primary/30"
          />
          <span>
            Keep me signed in on this phone
            <span className="block text-xs text-slate-400">
              Stores one cookie so the shop opens straight away. Untick on a shared device.
            </span>
          </span>
        </label>

        <button
          type="submit"
          disabled={signIn.isPending || !username.trim() || !password}
          className="min-h-[54px] w-full rounded-xl bg-primary text-base font-bold text-white shadow-sm active:bg-primary-dark disabled:bg-slate-300"
        >
          {signIn.isPending ? 'Signing in…' : 'Sign in'}
        </button>
        {waking && (
          <p className="text-center text-xs text-slate-500">
            Waking the server. The free plan sleeps when nobody is billing, so this first sign-in can take
            about a minute.
          </p>
        )}
      </form>

      <p className="mt-5 text-center text-sm text-slate-600">
        New shop?{' '}
        <button type="button" onClick={onRegister} className="min-h-[44px] font-bold text-primary underline">
          Create an account
        </button>
      </p>
    </div>
  );
}
