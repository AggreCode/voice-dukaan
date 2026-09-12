import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ItemRow from '../components/ItemRow';
import ProductPicker from '../components/ProductPicker';
import TranscriptPanel from '../components/TranscriptPanel';
import { useToast } from '../components/Toast';
import { confidenceLevel } from '../components/ConfidenceBadge';
import { api, ApiError } from '../lib/api';
import { auth } from '../lib/auth';
import {
  PickedProduct, ReviewItem, buildReviewItems, defaultUnitPrice, lineTotal, newBlankItem, priceKindFor, round2, toPicked,
} from '../lib/reviewModel';
import { PaymentMode, TransactionIn, VoiceSessionOut, normalizeSession } from '../lib/types';
import { cacheSession, getCachedSession } from '../lib/uploadQueue';
import { cx, fmtMoney } from '../lib/utils';

export default function Review() {
  const { sessionId = '' } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();

  const session = useQuery({
    queryKey: ['session', sessionId],
    queryFn: async (): Promise<VoiceSessionOut> => {
      const cached = await getCachedSession(sessionId);
      if (cached && cached.status !== 'processing') return normalizeSession(cached);
      const fresh = await api.voice.get(sessionId);
      await cacheSession(fresh);
      return fresh;
    },
    enabled: !!sessionId,
    refetchInterval: (q) => (q.state.data?.status === 'processing' ? 2000 : false),
  });

  if (session.isLoading) {
    return <Shell><p className="py-10 text-center text-slate-500">Loading session…</p></Shell>;
  }
  if (session.isError || !session.data) {
    return (
      <Shell>
        <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
          Could not load session: {(session.error as Error)?.message ?? 'unknown'}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => session.refetch()} className="min-h-[44px] flex-1 rounded-lg border border-red-300 bg-white font-medium">Retry</button>
            <Link to="/" className="flex min-h-[44px] flex-1 items-center justify-center rounded-lg bg-primary font-semibold text-white">Record again</Link>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <ReviewForm
      key={session.data.session_id + ':' + session.data.status}
      session={session.data}
      onSaved={(r) => {
        void qc.invalidateQueries({ queryKey: ['transactions'] });
        void qc.invalidateQueries({ queryKey: ['products'] });
        void cacheSession({ ...session.data!, status: 'saved' });
        if (r.type === 'purchase') {
          toast.success(`Stock added: ${r.count} item${r.count === 1 ? '' : 's'}`);
          nav('/products', { replace: true });
        } else {
          toast.success(`Bill saved: ${fmtMoney(r.total)}`);
          nav('/ledger', { replace: true });
        }
      }}
    />
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-md px-4 pb-6 pt-4">{children}</div>;
}

type SavedInfo = { id: string; total: number; type: 'sale' | 'purchase'; count: number };

function ReviewForm({ session, onSaved }: { session: VoiceSessionOut; onSaved: (r: SavedInfo) => void }) {
  const toast = useToast();
  const ext = session.extraction;
  const isStockIn = session.mode === 'stock_in';
  // Stock-in recordings are always purchases, whatever the extraction thought.
  const initialIntent: 'sale' | 'purchase' = isStockIn || ext?.intent === 'purchase' ? 'purchase' : 'sale';
  const intentHint = !isStockIn && ext && (ext.intent === 'stock_query' || ext.intent === 'unknown');

  const [intent, setIntentState] = useState<'sale' | 'purchase'>(initialIntent);
  const priceKind = priceKindFor(intent);
  const [items, setItems] = useState<ReviewItem[]>(() => buildReviewItems(session, priceKindFor(initialIntent)));
  const [deleted, setDeleted] = useState<number[]>([]);
  const [payment, setPayment] = useState<PaymentMode>(ext?.payment_mode === 'upi' || ext?.payment_mode === 'credit' ? ext.payment_mode : 'cash');
  const [customer, setCustomer] = useState(ext?.customer_name ?? '');
  const [notes, setNotes] = useState(ext?.notes ?? '');
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [debug, setDebug] = useState(auth.isDebug());
  const [confirmAnyway, setConfirmAnyway] = useState(false);

  useEffect(() => {
    const h = () => setDebug(auth.isDebug());
    window.addEventListener('vd:debug', h);
    return () => window.removeEventListener('vd:debug', h);
  }, []);

  const knownProducts = useMemo<PickedProduct[]>(() => session.review_products.map(toPicked), [session.review_products]);
  const activeItem = items.find((i) => i.key === activeKey) ?? null;
  const pickerItem = items.find((i) => i.key === pickerFor) ?? null;

  const total = useMemo(() => round2(items.reduce((s, i) => s + lineTotal(i), 0)), [items]);
  const missingProduct = items.some((i) => !i.product);
  const redRows = items.filter((i) => confidenceLevel(i.original?.confidence ?? 1, !!i.product) === 'red').length;
  const canSave = items.length > 0 && !missingProduct;

  /** Switching sale/purchase re-defaults prices the user has not typed (sell vs cost price). */
  const setIntent = (t: 'sale' | 'purchase') => {
    if (t === intent) return;
    setIntentState(t);
    const kind = priceKindFor(t);
    setItems((prev) =>
      prev.map((i) => (i.priceTouched ? i : { ...i, unit_price: defaultUnitPrice(i.product, kind) ?? i.unit_price })),
    );
  };

  const updateItem = (key: string, next: ReviewItem) => setItems((prev) => prev.map((i) => (i.key === key ? next : i)));
  const deleteItem = (it: ReviewItem) => {
    setItems((prev) => prev.filter((i) => i.key !== it.key));
    if (it.item_index !== null) setDeleted((d) => (d.includes(it.item_index!) ? d : [...d, it.item_index!]));
    if (activeKey === it.key) setActiveKey(null);
  };
  const addItem = () => {
    const it = newBlankItem();
    setItems((prev) => [...prev, it]);
    setActiveKey(it.key);
    setPickerFor(it.key);
  };
  const selectProduct = (key: string, p: PickedProduct) => {
    setItems((prev) =>
      prev.map((i) => {
        if (i.key !== key) return i;
        const price = i.priceTouched ? i.unit_price : defaultUnitPrice(p, priceKind) ?? i.unit_price;
        return { ...i, product: p, unit_price: price };
      }),
    );
    setPickerFor(null);
  };

  const save = useMutation({
    mutationFn: () => {
      const body: TransactionIn = {
        voice_session_id: session.session_id,
        type: intent,
        items: items.map((i) => ({
          item_index: i.item_index,
          product_code: i.product!.code,
          qty: Number(i.qty) || 0,
          unit: i.unit,
          unit_price: Number(i.unit_price) || 0,
          spoken_span: i.original?.spoken_span ?? null,
          llm_product_code: i.original?.product_id ?? null,
          llm_confidence: i.original ? i.original.confidence : null,
        })),
        customer_name: customer.trim() || null,
        payment_mode: payment,
        notes: notes.trim() || null,
        deleted_item_indexes: deleted,
        llm_intent: ext?.intent ?? null,
      };
      return api.transactions.create(body);
    },
    onSuccess: (t) => onSaved({ id: t.id, total: t.total_amount, type: intent, count: items.length }),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : (e as Error).message),
  });

  const onSaveClick = () => {
    if (!canSave) return;
    if (redRows > 0 && !confirmAnyway) {
      setConfirmAnyway(true);
      return;
    }
    save.mutate();
  };

  const bad = session.status === 'no_speech' || session.status === 'failed' || session.status === 'needs_manual';

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-56 pt-4">
      <header className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-bold text-primary-dark">{intent === 'purchase' ? 'Review stock in' : 'Review bill'}</h1>
        <Link to={isStockIn ? '/?mode=stock_in' : '/'} className="min-h-[44px] rounded-lg px-2 py-2 text-sm font-medium text-primary">← Record</Link>
      </header>

      {session.status === 'processing' && (
        <div className="mb-3 rounded-xl bg-slate-100 p-3 text-sm text-slate-700">Still processing… refreshing.</div>
      )}
      {session.status === 'saved' && (
        <div className="mb-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">This session was already saved. Saving again will create another bill.</div>
      )}
      {bad && (
        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-semibold">
            {session.status === 'no_speech' && 'No speech detected'}
            {session.status === 'failed' && 'Processing failed'}
            {session.status === 'needs_manual' && 'Could not understand. Please fill in manually.'}
          </p>
          {session.error && <p className="mt-1 break-words text-xs">{session.error}</p>}
          <Link to={isStockIn ? '/?mode=stock_in' : '/'} className="mt-2 flex min-h-[44px] items-center justify-center rounded-lg bg-primary font-semibold text-white">
            Record again
          </Link>
        </div>
      )}
      {session.low_language_confidence && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Language detection was unsure ({session.transcript_language ?? '?'}
          {typeof session.language_probability === 'number' ? ` · ${Math.round(session.language_probability * 100)}%` : ''}). Check the transcript carefully.
        </div>
      )}

      <TranscriptPanel
        transcript={session.transcript}
        language={session.transcript_language}
        languageProbability={session.language_probability}
        highlightSpan={activeItem?.original?.spoken_span ?? null}
      />

      <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
        {(['sale', 'purchase'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setIntent(t)}
            className={cx('min-h-[44px] rounded-lg text-sm font-semibold', intent === t ? 'bg-white text-primary shadow' : 'text-slate-600')}
          >
            {t === 'sale' ? 'Sale' : 'Purchase'}
          </button>
        ))}
      </div>
      {intentHint && (
        <p className="mt-1 text-xs text-amber-700">Heard as “{ext?.intent}” — defaulted to Sale. Change if this is a purchase.</p>
      )}

      <ul className="mt-3 space-y-2">
        {items.map((it) => (
          <ItemRow
            key={it.key}
            item={it}
            active={it.key === activeKey}
            onActivate={() => setActiveKey(it.key)}
            onChange={(n) => updateItem(it.key, n)}
            onDelete={() => deleteItem(it)}
            onPickProduct={() => setPickerFor(it.key)}
            priceKind={priceKind}
          />
        ))}
      </ul>
      {items.length === 0 && <p className="mt-3 rounded-xl bg-slate-100 p-3 text-center text-sm text-slate-600">No items. Add one below.</p>}
      <button type="button" onClick={addItem} className="mt-3 min-h-[48px] w-full rounded-xl border-2 border-dashed border-primary/50 font-semibold text-primary">
        + Add item
      </button>

      {debug && (
        <section className="mt-4 rounded-xl border border-slate-200 bg-white p-3 text-xs">
          <p className="mb-1 font-semibold text-slate-600">Debug</p>
          <p className="text-slate-500">session {session.session_id} · client {session.client_session_id} · {session.status}</p>
          {Object.keys(session.latencies).length > 0 && (
            <div className="mt-2">
              <p className="font-semibold text-slate-600">Latencies (ms)</p>
              <ul className="grid grid-cols-2 gap-x-3">
                {Object.entries(session.latencies).map(([k, v]) => (
                  <li key={k} className="flex justify-between"><span className="text-slate-500">{k}</span><span className="font-mono">{Math.round(Number(v))}</span></li>
                ))}
              </ul>
            </div>
          )}
          {Object.keys(session.secondary_views).length > 0 && (
            <div className="mt-2">
              <p className="font-semibold text-slate-600">Secondary views</p>
              {Object.entries(session.secondary_views).map(([k, v]) => (
                <div key={k} className="mt-1">
                  <span className="rounded bg-slate-100 px-1 font-medium">{k}</span>
                  <p className="whitespace-pre-wrap break-words text-slate-700">{v}</p>
                </div>
              ))}
            </div>
          )}
          {ext && (
            <details className="mt-2">
              <summary className="cursor-pointer font-semibold text-slate-600">Raw extraction</summary>
              <pre className="mt-1 max-h-60 overflow-auto rounded bg-slate-50 p-2 text-[10px]">{JSON.stringify(ext, null, 2)}</pre>
            </details>
          )}
        </section>
      )}

      {/* Footer */}
      <div className="fixed inset-x-0 bottom-[60px] z-30 border-t border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-2">
          <div className="flex gap-2">
            <input
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              placeholder={intent === 'purchase' ? 'Supplier name (optional)' : 'Customer name (optional)'}
              aria-label={intent === 'purchase' ? 'Supplier name (optional)' : 'Customer name (optional)'}
              className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-slate-300 px-3 text-sm focus:border-primary focus:outline-none"
            />
            <div className="flex gap-1">
              {(['cash', 'upi', 'credit'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPayment(m)}
                  className={cx(
                    'min-h-[44px] rounded-lg border px-2.5 text-xs font-semibold uppercase',
                    payment === m ? 'border-primary bg-primary text-white' : 'border-slate-300 bg-white text-slate-600',
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          {debug && (
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" className="mt-2 min-h-[40px] w-full rounded-lg border border-slate-300 px-3 text-sm" />
          )}
          <div className="mt-2 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Total · {items.length} item{items.length === 1 ? '' : 's'}</div>
              <div className="text-2xl font-bold text-slate-900">{fmtMoney(total)}</div>
            </div>
            {confirmAnyway ? (
              <div className="flex gap-1">
                <button type="button" onClick={() => setConfirmAnyway(false)} className="min-h-[52px] rounded-xl border border-slate-300 px-3 text-sm font-medium">Back</button>
                <button
                  type="button"
                  onClick={() => save.mutate()}
                  disabled={save.isPending}
                  className="min-h-[52px] rounded-xl bg-red-600 px-4 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {save.isPending ? 'Saving…' : `Save anyway (${redRows} red)`}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onSaveClick}
                disabled={!canSave || save.isPending}
                title={missingProduct ? 'Pick a product for every row' : undefined}
                className="min-h-[52px] rounded-xl bg-primary px-6 text-base font-semibold text-white disabled:bg-slate-300"
              >
                {save.isPending ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
          {missingProduct && <p className="mt-1 text-[11px] text-red-600">Every row needs a product before saving.</p>}
        </div>
      </div>

      <ProductPicker
        open={!!pickerItem}
        onClose={() => setPickerFor(null)}
        onSelect={(p) => pickerItem && selectProduct(pickerItem.key, p)}
        alternatives={pickerItem?.original?.alternatives ?? []}
        knownProducts={knownProducts}
        currentCode={pickerItem?.product?.code ?? null}
        initialQuery={pickerItem && !pickerItem.product ? pickerItem.original?.product_name_guess ?? '' : ''}
      />
    </div>
  );
}
