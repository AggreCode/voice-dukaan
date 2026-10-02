import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import TopBar from '../components/TopBar';
import { api } from '../lib/api';
import { useLocal } from '../lib/labels';
import { AnalyticsOut, DayPoint } from '../lib/types';
import { cx, fmtMoney } from '../lib/utils';

const PERIODS = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
] as const;

/** The one hue for every sales magnitude on this screen. Validated: 3.8:1 on white, in band, in chroma. */
const SALES_HUE = 'bg-[#059669]';

/**
 * The shop's hisaab, answering the three questions a shopkeeper actually asks: what earns me the most,
 * what sells most often, and what gives me the best margin. Plus the one they ask first of all: how
 * much did I sell.
 *
 * Every chart here has one series, so none needs a legend; each title names what it shows. Values are
 * written in ink beside every bar, so nothing depends on colour alone, and the daily chart reads out the
 * day you tap instead of floating a tooltip a thumb would cover.
 */
export default function Report() {
  const word = useLocal();
  const [days, setDays] = useState<number>(7);
  const report = useQuery({ queryKey: ['analytics', days], queryFn: () => api.analytics(days), staleTime: 30_000 });
  const a = report.data;
  const period = PERIODS.find((p) => p.days === days)?.label.toLowerCase() ?? '';

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-28">
      <TopBar title="Report" subtitle={word('report')} back="/" />

      <div className="mb-4 grid grid-cols-3 gap-1 rounded-2xl bg-slate-200/70 p-1">
        {PERIODS.map((p) => (
          <button
            key={p.days}
            type="button"
            onClick={() => setDays(p.days)}
            aria-pressed={days === p.days}
            className={cx(
              'min-h-[48px] rounded-xl text-base font-bold',
              days === p.days ? 'bg-white text-slate-900 shadow' : 'text-slate-600',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {report.isLoading && <p className="py-12 text-center text-slate-500">Adding it all up…</p>}
      {report.isError && (
        <div className="rounded-2xl bg-red-50 p-4 font-semibold text-red-800">
          {(report.error as Error).message}
          <button type="button" onClick={() => report.refetch()} className="ml-2 underline">Try again</button>
        </div>
      )}

      {a && (
        <>
          <section className="grid grid-cols-2 gap-3">
            <Tile label={`Sold ${period}`} value={fmtMoney(a.totals.sales)} note={`${a.totals.bills} bill${a.totals.bills === 1 ? '' : 's'}`} big />
            <Tile
              label="You earned"
              value={a.totals.sales > 0 ? `≈ ${fmtMoney(a.totals.profit)}` : fmtMoney(0)}
              note={
                a.totals.sales === 0
                  ? 'after cost'
                  : a.totals.profit_coverage >= 0.99
                    ? 'after cost'
                    : `on ${Math.round(a.totals.profit_coverage * 100)}% of sales with a cost price`
              }
              big
              tone="good"
            />
            <Tile label={`Bought ${period}`} value={fmtMoney(a.totals.purchases)} note={`${a.totals.purchase_bills} stock-in${a.totals.purchase_bills === 1 ? '' : 's'}`} />
            <Tile label="Stock worth" value={fmtMoney(a.stock_value.at_cost)} note={`sells for ${fmtMoney(a.stock_value.at_sell)}`} />
          </section>

          {days > 1 && <DailyChart data={a.daily} />}

          {a.totals.bills === 0 ? (
            <section className="mt-5 rounded-3xl border-2 border-dashed border-slate-200 bg-white p-6 text-center">
              <p className="text-lg font-extrabold text-slate-800">No sales {period === 'today' ? 'yet today' : `in the last ${period}`}</p>
              <p className="mt-1 text-slate-500">This page fills itself in as you make bills.</p>
              <Link to="/sell" className="mt-4 inline-flex min-h-[56px] items-center rounded-2xl bg-emerald-600 px-6 text-lg font-extrabold text-white">
                Make a bill
              </Link>
            </section>
          ) : (
            <>
              <Ranked
                title="Earns you the most money"
                hint={`by sales value, ${period}`}
                rows={a.top_revenue.map((s) => ({
                  key: s.code, name: s.name, local: s.local_name, value: s.revenue,
                  text: fmtMoney(s.revenue), sub: `${trim(s.qty)} ${s.unit} sold`,
                }))}
              />
              <Ranked
                title="Sells most often"
                hint={`by number of bills, ${period}`}
                rows={a.top_frequency.map((s) => ({
                  key: s.code, name: s.name, local: s.local_name, value: s.times,
                  text: `${s.times} bill${s.times === 1 ? '' : 's'}`, sub: `${trim(s.qty)} ${s.unit} in all`,
                }))}
              />
            </>
          )}

          <Ranked
            title="Best margin"
            hint="profit on each sale, at your current prices"
            empty={
              a.stock_value.missing_prices > 0
                ? `Add a cost price to your items to see this. ${a.stock_value.missing_prices} item${a.stock_value.missing_prices === 1 ? ' is' : 's are'} missing one.`
                : 'Add items with both prices to see this.'
            }
            rows={a.top_margin.map((m) => ({
              key: m.code, name: m.name, local: m.local_name, value: m.margin_pct,
              text: `${m.margin_pct.toFixed(0)}%`, sub: `${fmtMoney(m.margin)} on each ${m.unit} · sells ${fmtMoney(m.sell_price)}`,
            }))}
          />

          {a.low_stock.length > 0 && (
            <section className="mt-5 rounded-3xl border-2 border-amber-200 bg-amber-50 p-4">
              <h2 className="text-lg font-extrabold text-amber-900">⚠ Running low</h2>
              <ul className="mt-2 divide-y divide-amber-200/70">
                {a.low_stock.slice(0, 6).map((l) => (
                  <li key={l.code} className="flex items-center justify-between py-2">
                    <span className="truncate font-bold text-slate-900">{l.name}</span>
                    <span className="shrink-0 font-extrabold tabular-nums text-amber-800">{trim(l.stock_qty)} {l.unit} left</span>
                  </li>
                ))}
              </ul>
              <Link to="/buy" className="mt-2 flex min-h-[52px] items-center justify-center rounded-2xl bg-blue-600 font-extrabold text-white">
                Buy more stock
              </Link>
            </section>
          )}

          <Link
            to="/bills"
            className="mt-5 flex min-h-[60px] items-center justify-between rounded-2xl border-2 border-slate-200 bg-white px-4 text-lg font-bold text-slate-800"
          >
            <span>See every bill</span>
            <span className="text-slate-400">→</span>
          </Link>
        </>
      )}
    </div>
  );
}

function trim(n: number): string {
  return String(Number(n.toFixed(2)));
}

function Tile({ label, value, note, big = false, tone }: { label: string; value: string; note: string; big?: boolean; tone?: 'good' }) {
  return (
    <div className={cx('rounded-3xl p-4 shadow-sm', big ? 'bg-slate-900 text-white' : 'bg-white')}>
      <p className={cx('text-xs font-bold uppercase tracking-wide', big ? 'text-white/60' : 'text-slate-500')}>{label}</p>
      <p className={cx('mt-0.5 font-extrabold tabular-nums leading-tight', big ? 'text-2xl' : 'text-xl text-slate-900', tone === 'good' && 'text-emerald-300')}>
        {value}
      </p>
      <p className={cx('mt-0.5 text-xs', big ? 'text-white/60' : 'text-slate-500')}>{note}</p>
    </div>
  );
}

/**
 * Sales per day: one series, so the title names it and there is no legend. Bars are anchored to the
 * baseline with rounded tops and a 2px gap between them. Tapping a day reads it out above the chart,
 * where a thumb does not cover it, and the same numbers are one tap away as a table.
 */
function DailyChart({ data }: { data: DayPoint[] }) {
  const [sel, setSel] = useState<number>(data.length - 1);
  const [asTable, setAsTable] = useState(false);
  const max = Math.max(1, ...data.map((d) => d.sales));
  const nice = niceMax(max);
  const picked = data[Math.min(sel, data.length - 1)];
  const label = (iso: string, short = false) =>
    new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', short ? { day: 'numeric' } : { weekday: 'short', day: 'numeric', month: 'short' });
  const ticks = data.length <= 7 ? data.map((_, i) => i) : [0, Math.floor((data.length - 1) / 2), data.length - 1];

  return (
    <section className="mt-5 rounded-3xl bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-extrabold text-slate-900">Sales each day</h2>
        <button type="button" onClick={() => setAsTable((v) => !v)} className="min-h-[40px] text-sm font-semibold text-slate-500 underline">
          {asTable ? 'Show chart' : 'Show as table'}
        </button>
      </div>

      {asTable ? (
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-bold uppercase text-slate-500"><th className="py-1">Day</th><th className="text-right">Sales</th><th className="text-right">Bills</th></tr>
          </thead>
          <tbody>
            {[...data].reverse().map((d) => (
              <tr key={d.date} className="border-t border-slate-100">
                <td className="py-1.5">{label(d.date)}</td>
                <td className="text-right font-bold tabular-nums">{fmtMoney(d.sales)}</td>
                <td className="text-right tabular-nums text-slate-600">{d.bills}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <>
          <p className="mt-1 min-h-[28px] text-base text-slate-600" aria-live="polite">
            <span className="font-semibold">{label(picked.date)}</span> ·{' '}
            <span className="font-extrabold text-slate-900">{fmtMoney(picked.sales)}</span> · {picked.bills} bill{picked.bills === 1 ? '' : 's'}
          </p>
          <div className="relative mt-2 h-44">
            {/* recessive gridlines, labelled on the left */}
            {[1, 0.5].map((f) => (
              <div key={f} className="absolute inset-x-0 border-t border-dashed border-slate-200" style={{ bottom: `${f * 100}%` }}>
                <span className="absolute -top-2.5 left-0 bg-white pr-1 text-[10px] font-semibold tabular-nums text-slate-400">
                  {fmtMoney(nice * f)}
                </span>
              </div>
            ))}
            <div className="absolute inset-x-0 bottom-0 border-t border-slate-300" />
            <div className="absolute inset-0 flex items-end gap-[2px] pl-10">
              {data.map((d, i) => (
                <button
                  key={d.date}
                  type="button"
                  onClick={() => setSel(i)}
                  onPointerEnter={() => setSel(i)}
                  aria-label={`${label(d.date)}: ${fmtMoney(d.sales)}`}
                  className="flex h-full flex-1 items-end"
                >
                  <span
                    className={cx('w-full rounded-t-[4px]', SALES_HUE, i === sel ? 'opacity-100' : 'opacity-60')}
                    style={{ height: d.sales > 0 ? `max(${(d.sales / nice) * 100}%, 3px)` : '0px' }}
                  />
                </button>
              ))}
            </div>
          </div>
          <div className="mt-1 flex pl-10 text-[11px] font-semibold text-slate-400">
            {data.map((d, i) => (
              <span key={d.date} className="flex-1 text-center">
                {ticks.includes(i) ? (data.length <= 7 ? new Date(d.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short' }) : label(d.date, true)) : ''}
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function niceMax(v: number): number {
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const step of [1, 2, 2.5, 5, 10]) if (v <= step * mag) return step * mag;
  return 10 * mag;
}

interface RankRow {
  key: string;
  name: string;
  local: string | null;
  value: number;
  text: string;
  sub: string;
}

/** A ranked list with a bar under each name: one hue, length is the only thing it encodes. */
function Ranked({ title, hint, rows, empty }: { title: string; hint: string; rows: RankRow[]; empty?: string }) {
  const max = Math.max(1e-9, ...rows.map((r) => r.value));
  return (
    <section className="mt-5 rounded-3xl bg-white p-4 shadow-sm">
      <h2 className="text-lg font-extrabold text-slate-900">{title}</h2>
      <p className="text-xs text-slate-500">{hint}</p>
      {rows.length === 0 ? (
        <p className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm font-semibold text-slate-600">{empty ?? 'Nothing yet.'}</p>
      ) : (
        <ol className="mt-3 space-y-3">
          {rows.map((r, i) => (
            <li key={r.key} className="flex items-center gap-3">
              <span
                className={cx(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-extrabold',
                  i === 0 ? 'bg-amber-400 text-amber-950' : 'bg-slate-100 text-slate-600',
                )}
              >
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-base font-bold text-slate-900">{r.name}</span>
                  <span className="shrink-0 text-base font-extrabold tabular-nums text-slate-900">{r.text}</span>
                </div>
                <div className="mt-1 h-2.5 w-full rounded-full bg-slate-100">
                  <div className={cx('h-full rounded-full', SALES_HUE)} style={{ width: `${Math.max(4, (r.value / max) * 100)}%` }} />
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-500">{r.local ? `${r.local} · ` : ''}{r.sub}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export type { AnalyticsOut };
