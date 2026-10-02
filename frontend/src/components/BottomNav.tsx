import { NavLink, useLocation } from 'react-router-dom';
import { WordKey, useLocal } from '../lib/labels';
import { usePendingCount } from '../lib/uploadQueue';
import { useDrafts } from '../lib/drafts';
import { cx } from '../lib/utils';
import { ChartIcon, HomeIcon, ListIcon, MoreIcon } from './Icons';

/**
 * Four places, the same four on every screen, each with a picture, an English word and the shop's own
 * word. Home holds everything to do with making a bill; the other three are things to look at.
 * A dot on Home means a bill is waiting there, unfinished or unsent.
 */
const tabs: { to: string; label: string; local: WordKey; icon: typeof HomeIcon; match: (p: string) => boolean }[] = [
  { to: '/', label: 'Home', local: 'home', icon: HomeIcon, match: (p) => p === '/' || /^\/(sell|buy|review)(\/|$)/.test(p) },
  { to: '/stock', label: 'Stock', local: 'stock', icon: ListIcon, match: (p) => p.startsWith('/stock') },
  { to: '/report', label: 'Report', local: 'report', icon: ChartIcon, match: (p) => p.startsWith('/report') || p.startsWith('/bills') },
  { to: '/settings', label: 'More', local: 'more', icon: MoreIcon, match: (p) => p.startsWith('/settings') || p.startsWith('/admin') },
];

export default function BottomNav() {
  const pending = usePendingCount();
  const drafts = useDrafts().length;
  const word = useLocal();
  const { pathname } = useLocation();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(0,0,0,0.04)]">
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {tabs.map((t) => {
          const active = t.match(pathname);
          const badge = t.to === '/' ? pending + drafts : 0;
          return (
            <li key={t.to}>
              <NavLink
                to={t.to}
                className={cx(
                  'relative flex min-h-[64px] flex-col items-center justify-center gap-0.5',
                  active ? 'text-slate-900' : 'text-slate-400',
                )}
              >
                <span className={cx('flex h-8 w-14 items-center justify-center rounded-full transition-colors', active && 'bg-slate-900 text-white')}>
                  <t.icon className="h-6 w-6" />
                </span>
                <span className="text-xs font-bold leading-none">
                  {t.label}
                  {word(t.local) && <span className="ml-1 font-semibold opacity-70">{word(t.local)}</span>}
                </span>
                {badge > 0 && (
                  <span className="absolute right-[22%] top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-500 px-1 text-[11px] font-extrabold text-white">
                    {badge}
                  </span>
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
