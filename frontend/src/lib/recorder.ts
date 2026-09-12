export type RecorderErrorKind = 'insecure_context' | 'not_supported' | 'permission_denied' | 'no_device' | 'unknown';

export class RecorderError extends Error {
  kind: RecorderErrorKind;
  constructor(kind: RecorderErrorKind, message: string) {
    super(message);
    this.name = 'RecorderError';
    this.kind = kind;
  }
}

const CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

export function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
  return CANDIDATES.find((t) => {
    try {
      return MediaRecorder.isTypeSupported(t);
    } catch {
      return false;
    }
  });
}

export function recordingSupport(): { ok: true } | { ok: false; error: RecorderError } {
  if (typeof window === 'undefined') return { ok: false, error: new RecorderError('not_supported', 'No window') };
  if (!window.isSecureContext) {
    return {
      ok: false,
      error: new RecorderError('insecure_context', 'Microphone needs HTTPS (or localhost). Open this app over https://.'),
    };
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    return { ok: false, error: new RecorderError('not_supported', 'This browser cannot record audio. Try Chrome.') };
  }
  return { ok: true };
}

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

export interface ActiveRecording {
  /** Stop and resolve with the final blob. */
  stop: () => Promise<RecordingResult>;
  /** Abort without producing a result (releases mic). */
  cancel: () => void;
  mimeType: string;
  startedAt: number;
}

export interface StartOptions {
  onLevel?: (level: number) => void; // 0..1 RMS-ish
  onError?: (err: Error) => void;
}

export async function startRecording(opts: StartOptions = {}): Promise<ActiveRecording> {
  const support = recordingSupport();
  if (!support.ok) throw support.error;

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (e) {
    const err = e as DOMException;
    if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
      throw new RecorderError('permission_denied', 'Microphone permission denied. Allow mic access in browser settings.');
    }
    if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
      throw new RecorderError('no_device', 'No microphone found.');
    }
    throw new RecorderError('unknown', err.message || 'Could not start microphone');
  }

  const mimeType = pickMimeType();
  let recorder: MediaRecorder;
  try {
    const init: MediaRecorderOptions = { audioBitsPerSecond: 48000 };
    if (mimeType) init.mimeType = mimeType;
    recorder = new MediaRecorder(stream, init);
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    throw new RecorderError('not_supported', (e as Error).message || 'MediaRecorder failed to start');
  }

  const chunks: Blob[] = [];
  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) chunks.push(ev.data);
  };
  recorder.onerror = (ev) => {
    opts.onError?.((ev as unknown as { error?: Error }).error ?? new Error('Recorder error'));
  };

  // Level metering
  let audioCtx: AudioContext | null = null;
  let raf = 0;
  if (opts.onLevel) {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        audioCtx = new Ctx();
        const src = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.6;
        src.connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        const tick = () => {
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / buf.length);
          // Map RMS (~0..0.5 for speech) to 0..1 with a bit of gain.
          opts.onLevel?.(Math.min(1, rms * 3));
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        if (audioCtx.state === 'suspended') void audioCtx.resume();
      }
    } catch {
      /* metering is best-effort */
    }
  }

  const startedAt = Date.now();
  recorder.start(1000);

  const cleanup = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    stream.getTracks().forEach((t) => t.stop());
    if (audioCtx) {
      void audioCtx.close().catch(() => undefined);
      audioCtx = null;
    }
  };

  let stopped = false;
  const stop = () =>
    new Promise<RecordingResult>((resolve, reject) => {
      if (stopped) {
        reject(new Error('Already stopped'));
        return;
      }
      stopped = true;
      const finish = () => {
        const durationMs = Date.now() - startedAt;
        const type = recorder.mimeType || mimeType || chunks[0]?.type || 'audio/webm';
        const blob = new Blob(chunks, { type });
        cleanup();
        resolve({ blob, mimeType: type, durationMs });
      };
      recorder.onstop = finish;
      if (recorder.state === 'inactive') {
        finish();
      } else {
        try {
          recorder.stop();
        } catch (e) {
          cleanup();
          reject(e);
        }
      }
    });

  const cancel = () => {
    if (stopped) return;
    stopped = true;
    try {
      if (recorder.state !== 'inactive') recorder.stop();
    } catch {
      /* ignore */
    }
    cleanup();
  };

  return { stop, cancel, mimeType: recorder.mimeType || mimeType || '', startedAt };
}
