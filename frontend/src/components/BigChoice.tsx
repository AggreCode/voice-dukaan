import { ReactNode } from 'react';
import { cx } from '../lib/utils';

/**
 * One large, unmistakable button: an icon, a word in English, the same word in the shop's language,
 * and one line saying what happens. Sized for a thumb that is also holding a phone, and for eyes that
 * did not bring their reading glasses to the counter.
 */
export default function BigChoice({
  onClick, icon, title, local, detail, tone = 'plain', size = 'lg',
}: {
  onClick: () => void;
  icon: ReactNode;
  title: string;
  local?: string | null;
  detail: string;
  tone?: 'sale' | 'stock_in' | 'plain' | 'sale-soft' | 'stock_in-soft';
  size?: 'xl' | 'lg';
}) {
  const solid = tone === 'sale' || tone === 'stock_in';
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'group flex w-full items-center gap-4 rounded-3xl px-4 text-left shadow-sm transition-transform active:scale-[0.98]',
        size === 'xl' ? 'min-h-[132px]' : 'min-h-[96px]',
        tone === 'sale' && 'bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-emerald-900/20',
        tone === 'stock_in' && 'bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-blue-900/20',
        tone === 'sale-soft' && 'border-2 border-emerald-200 bg-white',
        tone === 'stock_in-soft' && 'border-2 border-blue-200 bg-white',
        tone === 'plain' && 'border-2 border-slate-200 bg-white',
      )}
    >
      <span
        className={cx(
          'flex shrink-0 items-center justify-center rounded-2xl',
          size === 'xl' ? 'h-20 w-20' : 'h-16 w-16',
          solid && 'bg-white/20',
          tone === 'sale-soft' && 'bg-emerald-600 text-white',
          tone === 'stock_in-soft' && 'bg-blue-600 text-white',
          tone === 'plain' && 'bg-slate-100 text-slate-700',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cx('block font-extrabold leading-tight', size === 'xl' ? 'text-3xl' : 'text-xl')}>{title}</span>
        {local && (
          <span className={cx('block font-bold leading-tight', size === 'xl' ? 'text-xl' : 'text-base', solid ? 'text-white/90' : 'text-slate-600')}>
            {local}
          </span>
        )}
        <span className={cx('mt-1 block text-sm leading-snug', solid ? 'text-white/85' : 'text-slate-500')}>{detail}</span>
      </span>
      <svg className={cx('h-7 w-7 shrink-0', solid ? 'text-white/80' : 'text-slate-400')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}
