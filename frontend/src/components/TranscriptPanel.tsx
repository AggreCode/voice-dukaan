import { useMemo, useState } from 'react';
import { cx } from '../lib/utils';

interface Props {
  transcript: string | null;
  language?: string | null;
  languageProbability?: number | null;
  highlightSpan?: string | null;
  defaultOpen?: boolean;
  /** Panel heading. A photographed list is not a "transcript" to the person holding the phone. */
  title?: string;
  /** For a scan: the lines as read, shown one per row instead of one run-on paragraph. */
  lines?: string[];
  /** Lines the reader itself was unsure of, marked so the shopkeeper looks at them first. */
  unclearLines?: string[];
  /** Whatever was on the page that is not an item: a total, struck-out items, "no list here". */
  notes?: string;
}

/** Case-insensitive, whitespace-tolerant search for the span in the transcript. */
function findSpan(text: string, span: string): [number, number] | null {
  if (!span) return null;
  const lower = text.toLowerCase();
  const s = span.toLowerCase().trim();
  let i = lower.indexOf(s);
  if (i >= 0) return [i, i + s.length];
  // whitespace-tolerant: build a regex where any whitespace matches \s+
  const esc = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  try {
    const m = new RegExp(esc, 'i').exec(text);
    if (m) return [m.index, m.index + m[0].length];
  } catch {
    /* ignore */
  }
  // fallback: first word
  const first = s.split(/\s+/)[0];
  if (first && first.length > 2) {
    i = lower.indexOf(first);
    if (i >= 0) return [i, i + first.length];
  }
  return null;
}

export default function TranscriptPanel({
  transcript, language, languageProbability, highlightSpan, defaultOpen = true,
  title = 'Transcript', lines, unclearLines = [], notes = '',
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const unclear = new Set(unclearLines.map((l) => l.trim()));

  const parts = useMemo(() => {
    const text = transcript ?? '';
    if (!highlightSpan) return [{ text, hl: false }];
    const r = findSpan(text, highlightSpan);
    if (!r) return [{ text, hl: false }];
    return [
      { text: text.slice(0, r[0]), hl: false },
      { text: text.slice(r[0], r[1]), hl: true },
      { text: text.slice(r[1]), hl: false },
    ];
  }, [transcript, highlightSpan]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-[44px] w-full items-center justify-between px-4 py-2 text-left"
        aria-expanded={open}
      >
        <span className="text-sm font-semibold text-slate-700">
          {title}
          {language && (
            <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
              {language}
              {typeof languageProbability === 'number' ? ` · ${Math.round(languageProbability * 100)}%` : ''}
            </span>
          )}
        </span>
        <span className="text-slate-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && lines && lines.length > 0 && (
        <div className="border-t border-slate-100 px-4 py-3">
          <ol className="space-y-1">
            {lines.map((line, i) => {
              const hl = !!highlightSpan && findSpan(line, highlightSpan) !== null;
              return (
                <li
                  key={i}
                  className={cx(
                    'flex gap-2 rounded px-1.5 py-1 text-[15px] leading-snug',
                    hl ? 'bg-yellow-100 text-slate-900' : 'text-slate-800',
                  )}
                >
                  <span className="w-4 shrink-0 text-right text-xs text-slate-400">{i + 1}</span>
                  <span className="min-w-0 break-words">{line}</span>
                  {unclear.has(line.trim()) && (
                    <span className="ml-auto shrink-0 self-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                      unclear
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          {notes && <p className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-500">{notes}</p>}
        </div>
      )}
      {open && (!lines || lines.length === 0) && (
        <div className="border-t border-slate-100 px-4 py-3 text-[15px] leading-relaxed text-slate-800">
          {transcript ? (
            parts.map((p, i) =>
              p.hl ? (
                <mark key={i} className="rounded bg-yellow-200 px-0.5 text-slate-900">
                  {p.text}
                </mark>
              ) : (
                <span key={i}>{p.text}</span>
              ),
            )
          ) : (
            <span className="text-slate-400">Nothing was read.</span>
          )}
          {notes && <p className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-500">{notes}</p>}
        </div>
      )}
    </section>
  );
}
