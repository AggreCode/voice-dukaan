import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '../components/Toast';
import { blankSession } from '../lib/reviewModel';
import { VoiceMode } from '../lib/types';
import { fmtMoney } from '../lib/utils';
import { ReviewForm } from './Review';

function parseMode(v: string | null | undefined): VoiceMode {
  return v === 'stock_in' ? 'stock_in' : 'sale';
}

/**
 * Typing a bill in by hand.
 *
 * It is the same editor a recording or a photograph lands in, started empty. Speech fails in a noisy
 * shop, a customer may hand over nothing at all, and some bills are two lines that are quicker to
 * type than to say. None of that should mean a different screen, a different save or a different set
 * of prices.
 */
export default function Manual() {
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const mode = parseMode(searchParams.get('mode'));

  // A new identity per mode, so switching between selling and buying starts a clean bill.
  const session = useMemo(() => blankSession(mode), [mode]);

  return (
    <ReviewForm
      key={mode}
      session={session}
      backTo={{ to: '/', label: 'Home' }}
      onSaved={(r) => {
        void qc.invalidateQueries({ queryKey: ['transactions'] });
        void qc.invalidateQueries({ queryKey: ['products'] });
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
