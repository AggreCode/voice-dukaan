import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ItemRow from '../components/ItemRow';
import { PlusIcon } from '../components/Icons';
import ProductPicker from '../components/ProductPicker';
import TopBar from '../components/TopBar';
import TranscriptPanel from '../components/TranscriptPanel';
import { useToast } from '../components/Toast';
import { api, ApiError } from '../lib/api';
import { auth } from '../lib/auth';
import { DraftSource, clearDraft, loadDraft, saveDraft } from '../lib/drafts';
import { doneCue } from '../lib/haptics';
import {
  Missing, PickedProduct, ReviewItem, buildReviewItems, defaultUnitPrice, intentFor, lineTotal, missingFields,
  newBlankItem, newItemName, priceKindFor, round2, toPicked,
} from '../lib/reviewModel';
import { SIDE, THEME } from '../lib/theme';
import { PaymentMode, TransactionIn, VoiceSessionOut, normalizeSession } from '../lib/types';
import { cacheSession, getCachedSession } from '../lib/uploadQueue';
import { cx, fmtMoney } from '../lib/utils';

export default function Review() {
  const { sessionId = '' } = useParams();
  const nav = useNavigate();
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
    return (
      <div className="mx-auto w-full max-w-md px-4 pt-4">
        <TopBar title="Opening bill…" back="/" />
        <p className="py-10 text-center text-slate-500">Opening your bill…</p>
      </div>
    );
  }
  if (session.isError || !session.data) {
    return (
      <div className="mx-auto w-full max-w-md px-4 pt-4">
        <TopBar title="Bill" back="/" />
        <div className="rounded-2xl bg-red-50 p-4 text-red-800">
          <p className="font-bold">This bill could not be opened.</p>
          <p className="mt-1 text-sm">{(session.error as Error)?.message ?? 'Unknown problem'}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => session.refetch()} className="min-h-[52px] flex-1 rounded-xl border-2 border-red-300 bg-white font-bold">Try again</button>
            <Link to="/" className="flex min-h-[52px] flex-1 items-center justify-center rounded-xl bg-slate-900 font-bold text-white">Home</Link>
          </div>
        </div>
      </div>
    );
  }

  const side = SIDE[session.data.mode];
  return (
    <ReviewForm
      key={session.data.session_id + ':' + session.data.status}
      session={session.data}
      backTo={`/${side}`}
      onSaved={(r) => {
        void qc.invalidateQueries({ queryKey: ['transactions'] });
        void qc.invalidateQueries({ queryKey: ['products'] });
        void qc.invalidateQueries({ queryKey: ['analytics'] });
        void cacheSession({ ...session.data!, status: 'saved' });
        nav(`/${side}?saved=${r.total}&n=${r.count}`, { replace: true });
      }}
    />
  );
}

export type SavedInfo = { id: string; total: number; type: 'sale' | 'purchase'; count: number };

const PAYMENT: { value: PaymentMode; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'credit', label: 'Udhaar' },
];

const MISSING_WORDS: Record<Missing, string> = {
  product: 'item',
  qty: 'quantity',
  unit: 'unit',
  price: 'price',
  sell: 'selling price',
};

export function ReviewForm({
  session,
  onSaved,
  backTo,
}: {
  session: VoiceSessionOut;
  onSaved: (r: SavedInfo) => void;
  /** Where Back goes: the Buy or Sell screen this bill was started from. */
  backTo: string;
}) {
  const toast = useToast();
  const nav = useNavigate();
  const mode = session.mode;
  const theme = THEME[mode];
  const intent = intentFor(mode);
  const buying = intent === 'purchase';
  const kind = priceKindFor(intent);
  const ext = session.extraction;
  const manual = !session.session_id;
  const source: DraftSource = manual ? 'manual' : session.input_kind === 'image' ? 'photo' : 'voice';
  const draftKey = session.session_id || `manual-${mode}`;
  const draftRoute = manual ? `/${SIDE[mode]}/type` : `/review/${session.session_id}`;
  const editable = manual || session.status === 'extracted' || session.status === 'needs_manual';

  // A bill left half-done comes back exactly as it was, whichever way it was started.
  const restored = useMemo(() => (session.status === 'saved' ? null : loadDraft(draftKey)), [draftKey, session.status]);

  const [items, setItems] = useState<ReviewItem[]>(
    () => restored?.items ?? (manual ? [newBlankItem()] : buildReviewItems(session, kind)),
  );
  const [deleted, setDeleted] = useState<number[]>(() => restored?.deleted ?? []);
  const [payment, setPayment] = useState<PaymentMode>(
    () => restored?.payment ?? (ext?.payment_mode === 'upi' || ext?.payment_mode === 'credit' ? ext.payment_mode : 'cash'),
  );
  const [customer, setCustomer] = useState(() => restored?.customer ?? ext?.customer_name ?? '');
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [debug, setDebug] = useState(auth.isDebug());
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const h = () => setDebug(auth.isDebug());
    window.addEventListener('vd:debug', h);
    return () => window.removeEventListener('vd:debug', h);
  }, []);

  const total = useMemo(() => round2(items.reduce((s, i) => s + lineTotal(i), 0)), [items]);

  // ---- keep the bill on the phone while it is being worked on ----
  useEffect(() => {
    if (session.status === 'failed' || session.status === 'no_speech' || session.status === 'no_text') {
      clearDraft(draftKey);
      return;
    }
    if (!editable) return;
    const t = window.setTimeout(() => {
      const touched = items.some((i) => i.product || newItemName(i) || i.qty || i.unit_price) || customer.trim();
      if (manual && !touched) {
        clearDraft(draftKey);
        return;
      }
      const names = items.map((i) => i.product?.name || newItemName(i)).filter(Boolean);
      saveDraft(
        {
          key: draftKey, route: draftRoute, mode, source, items: items.length, total,
          preview: names.slice(0, 3).join(', ') + (names.length > 3 ? '…' : ''), updatedAt: Date.now(),
        },
        { items, deleted, payment, customer },
      );
    }, 300);
    return () => window.clearTimeout(t);
  }, [items, deleted, payment, customer, total, draftKey, draftRoute, mode, source, manual, editable, session.status]);

  // ---- what is left to fill ----
  const newKeys = new Set(buying ? items.filter((i) => !i.product && !!newItemName(i)).map((i) => i.key) : []);
  const gaps = items.map((i) => missingFields(i, intent));
  const gapCount = gaps.reduce((s, g) => s + g.length, 0);
  const gapKinds = Array.from(new Set(gaps.flat()));
  const newCount = newKeys.size;

  const knownProducts = useMemo<PickedProduct[]>(() => session.review_products.map(toPicked), [session.review_products]);
  const activeItem = items.find((i) => i.key === activeKey) ?? null;
  const pickerItem = items.find((i) => i.key === pickerFor) ?? null;

  /**
   * Before anything is created, ask the shop's own inventory whether these names are already on the
   * shelf under different wording. The wholesaler writes "Rice (Premium) 25kg", the shop calls it
   * "Rice", and stocking in must add to the one that exists rather than start a second row for it.
   */
  const newNames = useMemo(
    () => Array.from(new Set(items.filter((i) => newKeys.has(i.key)).map(newItemName).filter(Boolean))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, buying],
  );
  const suggestions = useQuery({
    queryKey: ['product-match', newNames],
    queryFn: () => api.products.match(newNames),
    enabled: buying && newNames.length > 0,
    staleTime: 60_000,
  });
  const suggestionFor = (it: ReviewItem): PickedProduct | null => {
    const best = suggestions.data?.find((m) => m.name === newItemName(it))?.candidates[0];
    return best ? toPicked(best) : null;
  };

  /** The products a line could mean, resolved to real catalog rows, each with the shop's own price. */
  const choicesFor = (it: ReviewItem): PickedProduct[] => {
    const codes = (it.original?.alternatives ?? []).map((a) => a.product_id);
    if (it.product) codes.unshift(it.product.code);
    const seen = new Set<string>();
    return codes
      .filter((c) => !seen.has(c) && seen.add(c))
      .map((code) => knownProducts.find((p) => p.code === code))
      .filter((p): p is PickedProduct => !!p);
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
        return {
          ...i,
          product: p,
          newName: undefined,
          unit: i.unit || p.unit,
          unit_price: i.priceTouched && i.unit_price ? i.unit_price : defaultUnitPrice(p, kind),
          sell_price: buying ? i.sell_price ?? defaultUnitPrice(p, 'sell') : null,
        };
      }),
    );
    setPickerFor(null);
  };
  const nameNewItem = (key: string, name: string) => {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, product: null, newName: name } : i)));
    setPickerFor(null);
  };

  /**
   * Create every new product this bill introduces. Opening stock stays at zero: the purchase being
   * saved is what puts the stock on the shelf, so counting it here as well would double it.
   */
  const createNewProducts = async (rows: ReviewItem[]): Promise<ReviewItem[]> => {
    const out = [...rows];
    for (let idx = 0; idx < out.length; idx += 1) {
      const row = out[idx];
      if (row.product) continue;
      const name = newItemName(row);
      if (!name) continue;
      let created: PickedProduct;
      try {
        created = toPicked(
          await api.products.create({
            name,
            unit: row.unit.trim() || 'piece',
            cost_price: Number(row.unit_price) || null,
            sell_price: Number(row.sell_price) || 0,
            opening_stock: 0,
          }),
        );
      } catch (e) {
        // Two lines of one bill can name the same new product; the second create is a duplicate.
        const existing = (await api.products.list(name)).find(
          (p) => p.name.trim().toLowerCase() === name.trim().toLowerCase(),
        );
        if (!existing) throw e;
        created = toPicked(existing);
      }
      out[idx] = { ...row, product: created, newName: undefined };
    }
    return out;
  };

  const save = useMutation({
    mutationFn: async () => {
      let rows = items;
      if (newCount > 0) {
        rows = await createNewProducts(items);
        setItems(rows);
      }
      const body: TransactionIn = {
        voice_session_id: session.session_id || null,
        type: intent,
        items: rows.map((i) => ({
          item_index: i.item_index,
          product_code: i.product!.code,
          qty: Number(i.qty),
          unit: i.unit.trim() || i.product!.unit,
          unit_price: Number(i.unit_price),
          sell_price: buying ? Number(i.sell_price) : null,
          spoken_span: i.original?.spoken_span ?? null,
          llm_product_code: i.original?.product_id ?? null,
          llm_confidence: i.original ? i.original.confidence : null,
        })),
        customer_name: customer.trim() || null,
        payment_mode: payment,
        notes: null,
        deleted_item_indexes: deleted,
        llm_intent: ext?.intent ?? null,
      };
      return api.transactions.create(body);
    },
    onSuccess: (t) => {
      clearDraft(draftKey);
      doneCue();
      onSaved({ id: t.id, total: t.total_amount, type: intent, count: items.length });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : (e as Error).message),
  });

  const onSave = () => {
    if (items.length === 0) {
      toast.show('Add at least one item first.');
      return;
    }
    if (gapCount > 0) {
      setShowErrors(true);
      const first = items[gaps.findIndex((g) => g.length > 0)];
      document.getElementById(`row-${first.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast.show(`Fill the red boxes first (${gapCount}).`);
      return;
    }
    save.mutate();
  };

  const discard = () => {
    if (!window.confirm('Delete this whole bill? It will not be saved.')) return;
    clearDraft(draftKey);
    nav(backTo, { replace: true });
  };

  const bad = session.status === 'no_speech' || session.status === 'no_text' || session.status === 'failed' ||
    session.status === 'needs_manual';
  const fromPhoto = session.input_kind === 'image';
  const againTo = `/${SIDE[mode]}/${fromPhoto ? 'photo' : 'voice'}`;

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-72">
      <TopBar
        title={buying ? 'Stock in' : 'Sell bill'}
        subtitle={manual ? 'Typed by hand' : fromPhoto ? 'From your photo' : 'From your voice'}
        back={backTo}
        mode={mode}
      />

      {restored && editable && (
        <div className="mb-3 flex items-center justify-between gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-white">
          <p className="text-sm font-semibold">Your unsaved bill is back, as you left it.</p>
          <button type="button" onClick={discard} className="min-h-[40px] shrink-0 rounded-lg bg-white/15 px-3 text-sm font-bold">
            Start over
          </button>
        </div>
      )}

      {session.status === 'processing' && (
        <div className="mb-3 flex items-center gap-3 rounded-2xl bg-slate-100 p-4 text-slate-700">
          <span className="h-6 w-6 animate-spin rounded-full border-4 border-slate-300 border-t-slate-700" />
          <span className="font-semibold">Still reading… one moment.</span>
        </div>
      )}
      {session.status === 'saved' && (
        <div className="mb-3 rounded-2xl bg-emerald-50 p-4 font-semibold text-emerald-800">
          This bill is already saved. Saving again would make a second bill.
        </div>
      )}
      {bad && (
        <div className="mb-3 rounded-2xl border-2 border-red-200 bg-red-50 p-4 text-red-800">
          <p className="text-lg font-bold">
            {session.status === 'no_speech' && 'We could not hear anything'}
            {session.status === 'no_text' && 'No list in the photo'}
            {session.status === 'failed' && (fromPhoto ? 'Could not read the photo' : 'Could not understand that')}
            {session.status === 'needs_manual' && 'Please fill this one in by hand'}
          </p>
          <p className="mt-1 text-sm">
            {session.status === 'no_text'
              ? 'Hold the phone straight over the paper, fill the frame with it, and keep your shadow off it.'
              : session.status === 'no_speech'
                ? 'Hold the phone a little closer and speak after the beep.'
                : session.error ?? ''}
          </p>
          {session.status !== 'needs_manual' && (
            <Link to={againTo} className={cx('mt-3 flex min-h-[52px] items-center justify-center rounded-xl font-bold', theme.solid)}>
              {fromPhoto ? 'Take the photo again' : 'Speak again'}
            </Link>
          )}
        </div>
      )}

      {editable && items.length > 0 && (
        <div className={cx('mb-3 rounded-2xl border-2 p-4', gapCount > 0 ? 'border-amber-200 bg-amber-50' : cx(theme.softBorder, theme.soft))}>
          <p className={cx('text-lg font-extrabold', gapCount > 0 ? 'text-amber-900' : theme.textDark)}>
            {manual ? `${items.length} item${items.length === 1 ? '' : 's'}` : `We found ${items.length} item${items.length === 1 ? '' : 's'}`}
          </p>
          <p className={cx('text-sm', gapCount > 0 ? 'text-amber-800' : theme.text)}>
            {gapCount > 0
              ? `Fill the ${showErrors ? 'red' : 'yellow'} boxes: ${gapKinds.map((k) => (buying && k === 'price' ? 'cost price' : MISSING_WORDS[k])).join(', ')}.`
              : 'Everything is filled in. Check and press Save.'}
            {buying && newCount > 0 && ` ${newCount} new item${newCount === 1 ? '' : 's'} will be added to your stock.`}
          </p>
        </div>
      )}

      {!manual && (session.transcript || session.ocr_lines.length > 0) && (
        <div className="mb-3">
          <TranscriptPanel
            title={fromPhoto ? 'What the photo said' : 'What we heard'}
            transcript={session.transcript}
            lines={fromPhoto ? session.ocr_lines : undefined}
            unclearLines={session.ocr_unclear_lines}
            columns={fromPhoto ? session.ocr_columns : []}
            notes={fromPhoto ? session.ocr_notes : ''}
            language={null}
            highlightSpan={activeItem?.original?.spoken_span ?? null}
            defaultOpen={false}
          />
        </div>
      )}

      {editable && (
        <>
          <ul ref={listRef} className="space-y-3">
            {items.map((it, idx) => (
              <div key={it.key} id={`row-${it.key}`}>
                <ItemRow
                  item={it}
                  index={idx}
                  intent={intent}
                  active={it.key === activeKey}
                  onActivate={() => setActiveKey(it.key)}
                  onChange={(n) => updateItem(it.key, n)}
                  onDelete={() => deleteItem(it)}
                  onPickProduct={() => setPickerFor(it.key)}
                  source={manual ? 'manual' : fromPhoto ? 'image' : 'voice'}
                  newItemOk={newKeys.has(it.key)}
                  suggestion={newKeys.has(it.key) ? suggestionFor(it) : null}
                  onUseSuggestion={() => {
                    const p = suggestionFor(it);
                    if (p) selectProduct(it.key, p);
                  }}
                  choices={choicesFor(it)}
                  onChoose={(p) => selectProduct(it.key, p)}
                  showErrors={showErrors}
                />
              </div>
            ))}
          </ul>

          <button
            type="button"
            onClick={addItem}
            className={cx(
              'mt-3 flex min-h-[64px] w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed text-lg font-bold',
              theme.softBorder, theme.text,
            )}
          >
            <PlusIcon className="h-6 w-6" /> Add an item
          </button>

          <button type="button" onClick={discard} className="mt-4 min-h-[48px] w-full text-sm font-semibold text-red-600">
            Delete this bill
          </button>
        </>
      )}

      {debug && (
        <section className="mt-4 rounded-xl border border-slate-200 bg-white p-3 text-xs">
          <p className="mb-1 font-semibold text-slate-600">Debug</p>
          <p className="text-slate-500">session {session.session_id || '(manual)'} · {session.status} · draft {draftKey}</p>
          {Object.keys(session.latencies).length > 0 && (
            <ul className="mt-2 grid grid-cols-2 gap-x-3">
              {Object.entries(session.latencies).map(([k, v]) => (
                <li key={k} className="flex justify-between"><span className="text-slate-500">{k}</span><span className="font-mono">{Math.round(Number(v))}</span></li>
              ))}
            </ul>
          )}
          {ext && (
            <details className="mt-2">
              <summary className="cursor-pointer font-semibold text-slate-600">Raw extraction</summary>
              <pre className="mt-1 max-h-60 overflow-auto rounded bg-slate-50 p-2 text-[10px]">{JSON.stringify(ext, null, 2)}</pre>
            </details>
          )}
        </section>
      )}

      {/* ---- the save bar, always within reach ---- */}
      {editable && (
        <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 border-t border-slate-200 bg-white/95 shadow-[0_-8px_24px_rgba(0,0,0,0.06)] backdrop-blur">
          <div className="mx-auto w-full max-w-md px-4 py-2.5">
            <div className="flex gap-2">
              <input
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
                placeholder={buying ? 'Wholesaler name (optional)' : 'Customer name (optional)'}
                className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-slate-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
              <div className="flex gap-1">
                {PAYMENT.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setPayment(m.value)}
                    className={cx(
                      'min-h-[44px] rounded-xl border px-2.5 text-xs font-bold',
                      payment === m.value ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-600',
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  {buying ? 'Total cost' : 'Total'} · {items.length} item{items.length === 1 ? '' : 's'}
                </div>
                <div className="text-3xl font-extrabold tabular-nums text-slate-900">{fmtMoney(total)}</div>
              </div>
              <button
                type="button"
                onClick={onSave}
                disabled={save.isPending}
                className={cx(
                  'min-h-[60px] min-w-[136px] rounded-2xl px-6 text-xl font-extrabold shadow-lg disabled:opacity-60',
                  gapCount > 0 ? 'bg-slate-300 text-slate-700' : cx(theme.solid, theme.solidActive),
                )}
              >
                {save.isPending ? 'Saving…' : buying && newCount > 0 ? 'Save & add' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ProductPicker
        open={!!pickerItem}
        onClose={() => setPickerFor(null)}
        onSelect={(p) => pickerItem && selectProduct(pickerItem.key, p)}
        onNewName={buying ? (name) => pickerItem && nameNewItem(pickerItem.key, name) : undefined}
        alternatives={pickerItem?.original?.alternatives ?? []}
        knownProducts={knownProducts}
        currentCode={pickerItem?.product?.code ?? null}
        initialQuery={pickerItem && !pickerItem.product ? newItemName(pickerItem) : ''}
      />
    </div>
  );
}
