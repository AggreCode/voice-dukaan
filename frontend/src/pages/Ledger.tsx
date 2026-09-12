import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { TransactionOut } from '../lib/types';
import { cx, fmtDate, fmtMoney, fmtQty, fmtTime, todayISO } from '../lib/utils';
import { useToast } from '../components/Toast';

export default function Ledger() {
  const [day, setDay] = useState(todayISO());
  const [open, setOpen] = useState<string | null>(null);
  const qc = useQueryClient();
  const toast = useToast();

  const tx = useQuery({
    queryKey: ['transactions', day],
    queryFn: () => api.transactions.list(day, 200),
  });

  const voidTx = useMutation({
    mutationFn: (id: string) => api.transactions.void(id),
    onSuccess: () => {
      toast.success('Voided');
      void qc.invalidateQueries({ queryKey: ['transactions'] });
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : (e as Error).message),
  });

  const groups = useMemo(() => {
    const m = new Map<string, TransactionOut[]>();
    (tx.data ?? []).forEach((t) => {
      const k = todayISO(new Date(t.created_at));
      const arr = m.get(k) ?? [];
      arr.push(t);
      m.set(k, arr);
    });
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [tx.data]);

  const shiftDay = (delta: number) => {
    const d = new Date(day + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    setDay(todayISO(d));
  };

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-6 pt-4">
      <h1 className="mb-3 text-lg font-bold text-primary-dark">Ledger</h1>

      <div className="mb-3 flex items-center gap-2">
        <button type="button" onClick={() => shiftDay(-1)} className="min-h-[44px] min-w-[44px] rounded-lg border border-slate-300 bg-white text-lg" aria-label="Previous day">‹</button>
        <input
          type="date"
          value={day}
          max={todayISO()}
          onChange={(e) => e.target.value && setDay(e.target.value)}
          className="min-h-[44px] flex-1 rounded-lg border border-slate-300 bg-white px-3 text-base"
        />
        <button type="button" onClick={() => shiftDay(1)} disabled={day >= todayISO()} className="min-h-[44px] min-w-[44px] rounded-lg border border-slate-300 bg-white text-lg disabled:opacity-40" aria-label="Next day">›</button>
        <button type="button" onClick={() => setDay(todayISO())} className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium">Today</button>
      </div>

      {tx.isLoading && <p className="py-6 text-center text-sm text-slate-500">Loading…</p>}
      {tx.isError && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {(tx.error as Error).message} <button type="button" className="underline" onClick={() => tx.refetch()}>Retry</button>
        </p>
      )}
      {tx.data && tx.data.length === 0 && <p className="rounded-xl bg-slate-100 p-4 text-center text-sm text-slate-600">No bills on this day.</p>}

      {groups.map(([d, list]) => {
        const active = list.filter((t) => t.status !== 'void' && t.status !== 'voided');
        const sales = active.filter((t) => t.type === 'sale').reduce((s, t) => s + t.total_amount, 0);
        const purchases = active.filter((t) => t.type === 'purchase').reduce((s, t) => s + t.total_amount, 0);
        return (
          <section key={d} className="mb-4">
            <div className="mb-2 flex items-end justify-between">
              <h2 className="text-sm font-semibold text-slate-700">{fmtDate(d + 'T00:00:00')}</h2>
              <div className="text-right text-xs text-slate-500">
                <div>Sales <span className="font-semibold text-emerald-700">{fmtMoney(sales)}</span></div>
                {purchases > 0 && <div>Purchases <span className="font-semibold text-blue-700">{fmtMoney(purchases)}</span></div>}
              </div>
            </div>
            <ul className="space-y-2">
              {list.map((t) => {
                const isVoid = t.status === 'void' || t.status === 'voided';
                const expanded = open === t.id;
                return (
                  <li key={t.id} className={cx('rounded-xl border bg-white', isVoid ? 'border-slate-200 opacity-60' : 'border-slate-200')}>
                    <button type="button" onClick={() => setOpen(expanded ? null : t.id)} className="flex min-h-[56px] w-full items-center gap-3 px-3 py-2 text-left">
                      <span className={cx('rounded px-1.5 py-0.5 text-[10px] font-bold uppercase', t.type === 'sale' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800')}>
                        {t.type}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {t.type === 'purchase' ? (
                            t.customer_name ? (
                              <>
                                <span className="font-normal text-slate-500">Supplier: </span>
                                {t.customer_name}
                              </>
                            ) : (
                              'Supplier'
                            )
                          ) : (
                            t.customer_name || 'Walk-in customer'
                          )}
                          {isVoid && <span className="ml-2 text-xs font-semibold text-red-600">VOID</span>}
                        </div>
                        <div className="text-xs text-slate-500">
                          {fmtTime(t.created_at)} · {t.items.length} item{t.items.length === 1 ? '' : 's'} · {t.payment_mode}
                        </div>
                      </div>
                      <div className={cx('text-base font-bold', isVoid && 'line-through')}>{fmtMoney(t.total_amount)}</div>
                    </button>
                    {expanded && (
                      <div className="border-t border-slate-100 px-3 py-2">
                        <table className="w-full text-sm">
                          <tbody>
                            {t.items.map((it) => (
                              <tr key={it.id} className="border-b border-slate-50 last:border-0">
                                <td className="py-1.5 pr-2">
                                  <div className="font-medium">{it.product_name}</div>
                                  {it.product_local_name && <div className="text-xs text-slate-500">{it.product_local_name}</div>}
                                  <div className="text-[11px] text-slate-500">
                                    {it.product_code}
                                    {it.was_corrected && <span className="ml-1 rounded bg-amber-100 px-1 text-amber-800">corrected</span>}
                                  </div>
                                </td>
                                <td className="whitespace-nowrap py-1.5 text-right text-slate-600">
                                  {fmtQty(it.qty)} {it.unit} × {fmtMoney(it.unit_price)}
                                </td>
                                <td className="whitespace-nowrap py-1.5 pl-2 text-right font-semibold">{fmtMoney(it.line_total)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {t.notes && <p className="mt-1 text-xs text-slate-500">Note: {t.notes}</p>}
                        {!isVoid && (
                          <button
                            type="button"
                            disabled={voidTx.isPending}
                            onClick={() => {
                              if (window.confirm(`Void this ${t.type} of ${fmtMoney(t.total_amount)}? Stock will be reversed.`)) voidTx.mutate(t.id);
                            }}
                            className="mt-2 min-h-[44px] w-full rounded-lg border border-red-300 bg-red-50 text-sm font-semibold text-red-700 disabled:opacity-60"
                          >
                            Void
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
