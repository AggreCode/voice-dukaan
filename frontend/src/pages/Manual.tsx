import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { blankSession } from '../lib/reviewModel';
import { SIDE } from '../lib/theme';
import { VoiceMode } from '../lib/types';
import { ReviewForm } from './Review';

/**
 * Writing a bill by hand.
 *
 * The same editor a recording or a photograph lands in, started with one empty line. Speech fails at
 * a noisy counter, a customer may hand over nothing at all, and some bills are two lines quicker to
 * type than to say. None of that should mean a different screen, a different save or different prices.
 * Like every bill, it is kept on the phone until it is saved or deleted.
 */
export default function Manual({ mode }: { mode: VoiceMode }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const session = useMemo(() => blankSession(mode), [mode]);
  const side = SIDE[mode];

  return (
    <ReviewForm
      key={mode}
      session={session}
      backTo={`/${side}`}
      onSaved={(r) => {
        void qc.invalidateQueries({ queryKey: ['transactions'] });
        void qc.invalidateQueries({ queryKey: ['products'] });
        void qc.invalidateQueries({ queryKey: ['analytics'] });
        nav(`/${side}?saved=${r.total}&n=${r.count}`, { replace: true });
      }}
    />
  );
}
