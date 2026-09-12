import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import BottomNav from './components/BottomNav';
import { auth } from './lib/auth';
import Onboarding from './pages/Onboarding';
import Record from './pages/Record';
import Review from './pages/Review';
import Ledger from './pages/Ledger';
import Products from './pages/Products';
import Settings from './pages/Settings';

export default function App() {
  const [shopId, setShopId] = useState<string | null>(auth.getShopId());
  const qc = useQueryClient();
  const loc = useLocation();

  useEffect(() => {
    const h = () => {
      setShopId(auth.getShopId());
      qc.clear();
    };
    window.addEventListener('vd:auth', h);
    return () => window.removeEventListener('vd:auth', h);
  }, [qc]);

  if (!shopId) {
    return <Onboarding onDone={() => setShopId(auth.getShopId())} />;
  }

  return (
    <div className="min-h-screen pb-[calc(64px+env(safe-area-inset-bottom))]">
      <Routes location={loc}>
        <Route path="/" element={<Record />} />
        <Route path="/review/:sessionId" element={<Review />} />
        <Route path="/ledger" element={<Ledger />} />
        <Route path="/products" element={<Products />} />
        <Route path="/settings" element={<Settings onSwitchShop={() => setShopId(null)} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <BottomNav />
    </div>
  );
}
