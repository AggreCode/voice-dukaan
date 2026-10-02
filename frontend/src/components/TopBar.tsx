import { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLocal } from '../lib/labels';
import { THEME } from '../lib/theme';
import { VoiceMode } from '../lib/types';
import { cx } from '../lib/utils';

/**
 * The same header on every screen below Home: a large Back on the left, where the thumb finds it,
 * and the screen's name in the colour of the side of the counter it belongs to.
 *
 * Back goes to a fixed parent rather than the browser history. Someone who opened the app from a
 * WhatsApp link has no history, and `history.back()` would close the app on them.
 */
export default function TopBar({
  title, subtitle, back, mode, right,
}: {
  title: string;
  subtitle?: string | null;
  back: string;
  mode?: VoiceMode;
  right?: ReactNode;
}) {
  const nav = useNavigate();
  const word = useLocal();
  const theme = mode ? THEME[mode] : null;
  return (
    <header
      className={cx(
        'sticky top-0 z-30 -mx-4 mb-4 flex items-center gap-2 px-3 pb-3 pt-[max(env(safe-area-inset-top),12px)]',
        theme ? theme.gradient : 'bg-white text-slate-900 shadow-sm',
      )}
    >
      <button
        type="button"
        onClick={() => nav(back)}
        className={cx(
          'flex min-h-[48px] items-center gap-1.5 rounded-2xl pl-2 pr-3.5 text-base font-bold',
          theme ? 'bg-white/20 active:bg-white/30' : 'bg-slate-100 active:bg-slate-200',
        )}
        aria-label="Back"
      >
        <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 5l-7 7 7 7" />
        </svg>
        <span className="leading-tight">
          Back
          {word('back') && <span className="block text-[11px] font-semibold opacity-80">{word('back')}</span>}
        </span>
      </button>
      <div className="min-w-0 flex-1 text-center">
        <h1 className="truncate text-lg font-extrabold leading-tight">{title}</h1>
        {subtitle && <p className={cx('truncate text-xs font-semibold', theme ? 'opacity-90' : 'text-slate-500')}>{subtitle}</p>}
      </div>
      <div className="flex min-w-[48px] justify-end">{right}</div>
    </header>
  );
}
