import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import BottomNav from './components/BottomNav';
import { api, ApiError } from './lib/api';
import { auth } from './lib/auth';
import { MeOut } from './lib/types';
import Login from './pages/Login';
import Register from './pages/Register';
import Record from './pages/Record';
import Scan from './pages/Scan';
import Review from './pages/Review';
import Ledger from './pages/Ledger';
import Products from './pages/Products';
import Settings from './pages/Settings';

export default function App() {
  const qc = useQueryClient();
  const loc = useLocation();
  const [wantsRegister, setWantsRegister] = useState(false);

  /**
   * The front door. The session is an HttpOnly cookie the browser sends on its own, so the only way
   * to know whether anyone is signed in is to ask. If the cookie is there and valid this resolves
   * before the first paint finishes and the shop opens straight away; if not, the login screen shows.
   */
  const me = useQuery<MeOut>({
    queryKey: ['me'],
    queryFn: api.auth.me,
    retry: (count, e) => !(e instanceof ApiError && e.status === 401) && count < 2,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (me.data) auth.remember(me.data);
  }, [me.data]);

  // Any screen can discover the session has ended (api.ts clears the cache on a 401).
  useEffect(() => {
    const h = () => {
      if (!auth.getShopId()) {
        qc.clear();
        void me.refetch();
      }
    };
    window.addEventListener('vd:auth', h);
    return () => window.removeEventListener('vd:auth', h);
  }, [qc, me]);

  const signedIn = useCallback(
    (data: MeOut) => {
      auth.remember(data);
      qc.clear();
      qc.setQueryData(['me'], data);
      setWantsRegister(false);
    },
    [qc],
  );

  if (me.isLoading) return <Splash />;

  const unauthenticated = me.isError && me.error instanceof ApiError && me.error.status === 401;
  if (unauthenticated || (!me.data && me.isError)) {
    if (!unauthenticated) return <Unreachable onRetry={() => void me.refetch()} message={(me.error as Error).message} />;
    return wantsRegister ? (
      <Register onDone={signedIn} onSignIn={() => setWantsRegister(false)} />
    ) : (
      <Login onSignedIn={signedIn} onRegister={() => setWantsRegister(true)} />
    );
  }
  if (!me.data) return <Splash />;

  return (
    <div className="min-h-screen pb-[calc(64px+env(safe-area-inset-bottom))]">
      <Routes location={loc}>
        <Route path="/" element={<Record />} />
        <Route path="/scan" element={<Scan />} />
        <Route path="/review/:sessionId" element={<Review />} />
        <Route path="/ledger" element={<Ledger />} />
        <Route path="/products" element={<Products />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <BottomNav />
    </div>
  );
}

function Splash() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6">
      <img src="/icon.svg" alt="" className="h-16 w-16 rounded-2xl opacity-90" />
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
      <span className="sr-only">Opening your shop</span>
    </div>
  );
}

/** The server is down or the phone is offline. Not a sign-in problem, so do not ask for a password. */
function Unreachable({ onRetry, message }: { onRetry: () => void; message: string }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <img src="/icon.svg" alt="" className="h-14 w-14 rounded-2xl opacity-80" />
      <h1 className="text-lg font-bold text-slate-800">Cannot reach your shop</h1>
      <p className="text-sm text-slate-500">{message}</p>
      <button type="button" onClick={onRetry} className="min-h-[52px] w-full rounded-xl bg-primary font-bold text-white">
        Try again
      </button>
    </div>
  );
}
