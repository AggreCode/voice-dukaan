import { useNavigate } from 'react-router-dom';
import { ago, clearDraft, useDrafts } from '../lib/drafts';
import { THEME } from '../lib/theme';
import { VoiceMode } from '../lib/types';
import { cx, fmtMoney } from '../lib/utils';

/**
 * "You left a bill unfinished." Shown wherever a shopkeeper might be when they remember it, with one
 * button to carry on and one to throw it away. Nothing is ever thrown away without that tap.
 */
export default function UnfinishedBills({ mode }: { mode?: VoiceMode }) {
  const nav = useNavigate();
  const drafts = useDrafts().filter((d) => !mode || d.mode === mode);
  if (drafts.length === 0) return null;
  return (
    <section className="mb-4 space-y-2">
      <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500">
        Not saved yet · {drafts.length}
      </p>
      {drafts.slice(0, 4).map((d) => {
        const theme = THEME[d.mode];
        return (
          <div key={d.key} className={cx('flex items-center gap-3 rounded-2xl border-2 bg-white p-3 shadow-sm', theme.softBorder)}>
            <span className={cx('h-12 w-1.5 shrink-0 rounded-full', theme.dot)} />
            <button type="button" onClick={() => nav(d.route)} className="min-w-0 flex-1 text-left">
              <p className="truncate text-base font-extrabold text-slate-900">
                {d.mode === 'stock_in' ? 'Stock in' : 'Sale'} · {d.items} item{d.items === 1 ? '' : 's'}
              </p>
              <p className="truncate text-sm text-slate-500">
                {d.total > 0 && <span className="font-bold text-slate-800">{fmtMoney(d.total)} · </span>}
                {ago(d.updatedAt)}
              </p>
              {d.preview && <p className="truncate text-xs text-slate-400">{d.preview}</p>}
            </button>
            <button
              type="button"
              onClick={() => nav(d.route)}
              className={cx('min-h-[48px] shrink-0 rounded-xl px-4 font-bold', theme.solid)}
            >
              Continue
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Delete this unsaved bill?')) clearDraft(d.key);
              }}
              className="flex h-12 w-10 shrink-0 items-center justify-center text-2xl text-slate-400"
              aria-label="Delete unsaved bill"
            >
              ×
            </button>
          </div>
        );
      })}
    </section>
  );
}
