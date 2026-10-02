import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import BigChoice from '../components/BigChoice';
import { CameraIcon, CheckIcon, ListIcon, MicIcon, PenIcon } from '../components/Icons';
import TopBar from '../components/TopBar';
import UnfinishedBills from '../components/UnfinishedBills';
import { useLocal } from '../lib/labels';
import { SIDE, THEME } from '../lib/theme';
import { VoiceMode } from '../lib/types';
import { cx, fmtMoney } from '../lib/utils';

/**
 * Sell or Buy, chosen. Now: how do the items come in?
 *
 * The same three ways on both sides, in the same order, with the same pictures, so learning one side
 * teaches the other. The tip under them says the one thing that matters most to someone nervous about
 * getting it right: just the names are enough, the numbers can come after.
 */
export default function Hub({ mode }: { mode: VoiceMode }) {
  const nav = useNavigate();
  const word = useLocal();
  const [params, setParams] = useSearchParams();
  const theme = THEME[mode];
  const side = SIDE[mode];
  const selling = mode === 'sale';

  // "Saved!" after a bill, then out of the way.
  const savedTotal = params.get('saved');
  const savedCount = params.get('n');
  const [showSaved, setShowSaved] = useState(savedTotal !== null);
  useEffect(() => {
    if (savedTotal === null) return;
    setShowSaved(true);
    const t = window.setTimeout(() => {
      setShowSaved(false);
      setParams({}, { replace: true });
    }, 6000);
    return () => window.clearTimeout(t);
  }, [savedTotal, setParams]);

  const soft = selling ? 'sale-soft' : 'stock_in-soft';

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-28">
      <TopBar
        title={selling ? 'Sell' : 'Buy'}
        subtitle={[word(selling ? 'sell' : 'buy'), selling ? 'Bill for a customer' : 'Stock from the wholesaler'].filter(Boolean).join(' · ')}
        back="/"
        mode={mode}
      />

      {showSaved && (
        <div className={cx('mb-4 flex items-center gap-4 rounded-3xl p-4 shadow-lg', theme.gradient)}>
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/25">
            <CheckIcon className="h-8 w-8" />
          </span>
          <div>
            <p className="text-xl font-extrabold">{selling ? 'Bill saved!' : 'Stock added!'}</p>
            <p className="text-sm font-semibold text-white/90">
              {savedCount} item{savedCount === '1' ? '' : 's'} · {fmtMoney(Number(savedTotal) || 0)}
              {selling ? ' · ready for the next customer' : ' · prices updated'}
            </p>
          </div>
        </div>
      )}

      <UnfinishedBills mode={mode} />

      <h2 className={cx('mb-3 text-xl font-extrabold', theme.textDark)}>
        {selling ? 'How do you want to make the bill?' : 'How did the stock come?'}
      </h2>

      <div className="space-y-3">
        <BigChoice
          tone={soft}
          onClick={() => nav(`/${side}/voice`)}
          icon={<MicIcon className="h-9 w-9" />}
          title="Speak"
          local={word('speak')}
          detail={selling ? 'Say the items, like you tell a helper' : 'Read out what arrived'}
        />
        <BigChoice
          tone={soft}
          onClick={() => nav(`/${side}/photo`)}
          icon={<CameraIcon className="h-9 w-9" />}
          title="Photo"
          local={word('photo')}
          detail={selling ? "Take a photo of the customer's list" : "Take a photo of the wholesaler's bill"}
        />
        <BigChoice
          tone={soft}
          onClick={() => nav(`/${side}/type`)}
          icon={<PenIcon className="h-9 w-9" />}
          title="Type"
          local={word('type')}
          detail="Write the items yourself"
        />
      </div>

      <p className={cx('mt-4 rounded-2xl p-3 text-sm font-semibold', theme.soft, theme.textDark)}>
        💡 Just the names are enough — like “basmati, marigold, tiger biscuit”. You can fill quantity and price after.
      </p>

      <div className="mt-5">
        {selling ? (
          <BigChoice
            onClick={() => nav('/bills')}
            icon={<ListIcon className="h-8 w-8" />}
            title="Today's bills"
            local={word('bills')}
            detail="See every bill you made"
          />
        ) : (
          <BigChoice
            onClick={() => nav('/stock?from=buy')}
            icon={<ListIcon className="h-8 w-8" />}
            title="See my stock"
            local={word('stock')}
            detail="Quantity, prices and margin of every item"
          />
        )}
      </div>
    </div>
  );
}
