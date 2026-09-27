import { NavLink, useLocation } from 'react-router-dom';
import { cx } from '../lib/utils';
import { usePendingCount } from '../lib/uploadQueue';

// One tab to start a bill, whichever of the three ways it starts. Speaking, photographing and typing
// are choices on that screen rather than competing tabs, so the bar stays readable on a small phone
// and none of the three looks like the poor relation.
const tabs = [
  { to: '/', label: 'Bill', icon: ShopIcon, also: ['/record', '/scan', '/manual'] },
  { to: '/ledger', label: 'Ledger', icon: LedgerIcon, also: [] as string[] },
  { to: '/products', label: 'Inventory', icon: BoxIcon, also: [] as string[] },
  { to: '/settings', label: 'Settings', icon: GearIcon, also: [] as string[] },
];

export default function BottomNav() {
  const pending = usePendingCount();
  const { pathname } = useLocation();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {tabs.map((t) => (
          <li key={t.to}>
            <NavLink
              to={t.to}
              end={t.to === '/'}
              className={({ isActive }) =>
                cx(
                  'relative flex min-h-[60px] flex-col items-center justify-center gap-0.5 text-xs font-medium',
                  isActive || t.also.includes(pathname) ? 'text-primary' : 'text-slate-500',
                )
              }
            >
              <t.icon className="h-6 w-6" />
              <span>{t.label}</span>
              {t.to === '/' && pending > 0 && (
                <span className="absolute right-3 top-2 rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">{pending}</span>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function ShopIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9h16l-1.4-3a2 2 0 0 0-1.8-1.1H7.2A2 2 0 0 0 5.4 6L4 9z" />
      <path d="M5.5 10.5V19a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-8.5M10 20v-5.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V20" />
    </svg>
  );
}
function LedgerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 8h8M8 12h8M8 16h5" />
    </svg>
  );
}
function BoxIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8" />
    </svg>
  );
}
function GearIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}
