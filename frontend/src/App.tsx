import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import BottomNav from './components/BottomNav';
import { api, ApiError } from './lib/api';
import { auth } from './lib/auth';
import { MeOut } from './lib/types';
import { useSlowHint } from './lib/useSlowHint';
import Login from './pages/Login';
import Register from './pages/Register';
import Admin from './pages/Admin';
import Home from './pages/Home';
import Hub from './pages/Hub';
import Report from './pages/Report';
import Manual from './pages/Manual';
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
   * Set the moment the shopkeeper signs out, before the server has answered.
   *
   * Signing out used to reload the whole page, which on a sleeping free instance meant downloading
   * the app again and waiting for the server to wake. Nothing about ending a session needs a reload:
   * the cookie is cleared by the response, and this flips the screen straight away.
   */
  const [signedOut, setSignedOut] = useState(false);

  const me = useQuery<MeOut>({
    queryKey: ['me'],
    queryFn: api.auth.me,
    enabled: !signedOut,
    retry: (count, e) => !(e instanceof ApiError && e.status === 401) && count < 2,
    staleTime: 5 * 60_000,
  });

  // auth.clear() and auth.remember() both announce themselves, from anywhere in the app: a 401 on any
  // screen, the sign-out button, a fresh sign-in. One listener, registered once.
  useEffect(() => {
    const h = () => setSignedOut(!auth.getShopId());
    window.addEventListener('vd:auth', h);
    return () => window.removeEventListener('vd:auth', h);
  }, []);

  // One shop's data must never be on screen while another signs in.
  useEffect(() => {
    if (signedOut) qc.clear();
  }, [signedOut, qc]);

  useEffect(() => {
    if (me.data) auth.remember(me.data);
  }, [me.data]);

  const signedIn = useCallback(
    (data: MeOut) => {
      // Seed the answer first, then drop everything else, so the app never blinks through its
      // loading state on the way in.
      qc.setQueryData(['me'], data);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      auth.remember(data);
      setSignedOut(false);
      setWantsRegister(false);
    },
    [qc],
  );

  const authScreen = wantsRegister ? (
    <Register onDone={signedIn} onSignIn={() => setWantsRegister(false)} />
  ) : (
    <Login onSignedIn={signedIn} onRegister={() => setWantsRegister(true)} />
  );

  if (signedOut) return authScreen;
  if (me.isLoading) return <Splash />;
  if (me.isError) {
    return me.error instanceof ApiError && me.error.status === 401 ? (
      authScreen
    ) : (
      <Unreachable onRetry={() => void me.refetch()} message={(me.error as Error).message} />
    );
  }
  if (!me.data) return <Splash />;

  return (
    <div className="min-h-screen pb-[calc(64px+env(safe-area-inset-bottom))]">
      <ScrollToTop />
      <Routes location={loc}>
        <Route path="/" element={<Home />} />
        <Route path="/sell" element={<Hub key="sell" mode="sale" />} />
        <Route path="/buy" element={<Hub key="buy" mode="stock_in" />} />
        <Route path="/sell/voice" element={<Record key="sv" mode="sale" />} />
        <Route path="/buy/voice" element={<Record key="bv" mode="stock_in" />} />
        <Route path="/sell/photo" element={<Scan key="sp" mode="sale" />} />
        <Route path="/buy/photo" element={<Scan key="bp" mode="stock_in" />} />
        <Route path="/sell/type" element={<Manual key="st" mode="sale" />} />
        <Route path="/buy/type" element={<Manual key="bt" mode="stock_in" />} />
        <Route path="/review/:sessionId" element={<Review />} />
        <Route path="/stock" element={<Products />} />
        <Route path="/report" element={<Report />} />
        <Route path="/bills" element={<Ledger />} />
        <Route path="/settings" element={<Settings />} />
        {/* The server answers this only for an admin account; everyone else gets a 404 from the API. */}
        <Route path="/admin" element={<Admin />} />
        {/* Older addresses, from bookmarks and installed shortcuts, still land somewhere sensible. */}
        <Route path="/record" element={<Legacy kind="voice" />} />
        <Route path="/scan" element={<Legacy kind="photo" />} />
        <Route path="/manual" element={<Legacy kind="type" />} />
        <Route path="/products" element={<Navigate to="/stock" replace />} />
        <Route path="/ledger" element={<Navigate to="/bills" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <BottomNav />
    </div>
  );
}

/**
 * Every new screen opens at its top.
 *
 * A single-page app keeps the scroll position when it changes screen, so saving a long bill landed the
 * shopkeeper halfway down the next screen, with its "Bill saved!" confirmation scrolled out of sight
 * above them. Found by filming the app, not by reading it.
 */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

/** `/record?mode=stock_in` and friends, from before buying and selling had their own addresses. */
function Legacy({ kind }: { kind: 'voice' | 'photo' | 'type' }) {
  const [params] = useSearchParams();
  const side = params.get('mode') === 'stock_in' ? 'buy' : 'sell';
  return <Navigate to={`/${side}/${kind}`} replace />;
}

function Splash() {
  const slow = useSlowHint(true);
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-8 text-center">
      <img src="/icon.svg" alt="" className="h-16 w-16 rounded-2xl opacity-90" />
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
      <p className="min-h-[40px] text-sm text-slate-500">
        {slow ? 'Waking the server. The free plan sleeps when nobody is billing, so the first visit of the day takes about a minute.' : 'Opening your shop…'}
      </p>
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
