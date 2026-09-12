import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { cx } from '../lib/utils';

type Kind = 'success' | 'error' | 'info';
interface ToastItem { id: number; kind: Kind; text: string }

interface ToastApi {
  show: (text: string, kind?: Kind) => void;
  success: (text: string) => void;
  error: (text: string) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const show = useCallback((text: string, kind: Kind = 'info') => {
    const id = ++seq.current;
    setItems((prev) => [...prev, { id, kind, text }]);
    window.setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), kind === 'error' ? 5000 : 3000);
  }, []);

  const value = useMemo<ToastApi>(
    () => ({ show, success: (t) => show(t, 'success'), error: (t) => show(t, 'error') }),
    [show],
  );

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-4">
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cx(
              'pointer-events-auto w-full max-w-md rounded-xl px-4 py-3 text-sm font-medium shadow-lg',
              t.kind === 'success' && 'bg-primary text-white',
              t.kind === 'error' && 'bg-red-600 text-white',
              t.kind === 'info' && 'bg-slate-800 text-white',
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
