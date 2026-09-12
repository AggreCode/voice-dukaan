import { cx } from '../lib/utils';

export type ConfidenceLevel = 'green' | 'amber' | 'red';

export function confidenceLevel(confidence: number, hasProduct: boolean): ConfidenceLevel {
  if (!hasProduct) return 'red';
  if (confidence >= 0.9) return 'green';
  if (confidence >= 0.75) return 'amber';
  return 'red';
}

export default function ConfidenceBadge({
  confidence,
  hasProduct,
  className,
}: {
  confidence: number;
  hasProduct: boolean;
  className?: string;
}) {
  const level = confidenceLevel(confidence, hasProduct);
  const pct = Math.round(Math.max(0, Math.min(1, confidence)) * 100);
  return (
    <span
      title={hasProduct ? `Confidence ${pct}%` : 'No product matched'}
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
        level === 'green' && 'bg-emerald-100 text-emerald-800',
        level === 'amber' && 'bg-amber-100 text-amber-800',
        level === 'red' && 'bg-red-100 text-red-800',
        className,
      )}
    >
      <span
        className={cx(
          'h-2 w-2 rounded-full',
          level === 'green' && 'bg-emerald-500',
          level === 'amber' && 'bg-amber-500',
          level === 'red' && 'bg-red-500',
        )}
      />
      {hasProduct ? `${pct}%` : '?'}
    </span>
  );
}
