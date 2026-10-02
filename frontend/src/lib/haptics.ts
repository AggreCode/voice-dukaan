/**
 * Confirmation a shopkeeper can feel and hear, not just see.
 *
 * Google's microphone buzzes and chimes when it starts listening, and people have learned that this
 * means "go ahead". Android phones vibrate; iPhones ignore `navigator.vibrate` entirely, so the chime
 * is what tells an iPhone user the same thing. Both are best effort and never throw.
 */

export function buzz(pattern: number | number[]): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
  } catch {
    /* some browsers throw when the page is not focused */
  }
}

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freqs: number[], durationMs: number, gain = 0.07): void {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime;
  const step = durationMs / 1000 / freqs.length;
  freqs.forEach((f, i) => {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = f;
    const start = t0 + i * step;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, start + step);
    osc.connect(g).connect(ac.destination);
    osc.start(start);
    osc.stop(start + step + 0.02);
  });
}

/** Rising two-note chime and a short buzz: listening has started. */
export function startCue(): void {
  buzz(45);
  tone([660, 990], 180);
}

/** Falling chime and a double buzz: listening has stopped. */
export function stopCue(): void {
  buzz([30, 60, 30]);
  tone([990, 660], 180);
}

/** A soft tick for a successful save. */
export function doneCue(): void {
  buzz(25);
  tone([880, 1175, 1568], 240, 0.05);
}

/** Wait long enough for the start chime to finish before the microphone opens, so it is not recorded. */
export function afterCue(ms = 220): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}
