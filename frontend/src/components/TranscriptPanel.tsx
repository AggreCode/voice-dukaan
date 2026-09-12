import { useMemo, useState } from 'react';

interface Props {
  transcript: string | null;
  language?: string | null;
  languageProbability?: number | null;
  highlightSpan?: string | null;
  defaultOpen?: boolean;
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

export default function TranscriptPanel({ transcript, language, languageProbability, highlightSpan, defaultOpen = true }: Props) {
  const [open, setOpen] = useState(defaultOpen);

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
          Transcript
          {language && (
            <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
              {language}
              {typeof languageProbability === 'number' ? ` · ${Math.round(languageProbability * 100)}%` : ''}
            </span>
          )}
        </span>
        <span className="text-slate-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
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
            <span className="text-slate-400">No transcript.</span>
          )}
        </div>
      )}
    </section>
  );
}
