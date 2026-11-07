/**
 * Hands-free voice input (docs/design/paid-plans.md P39), without React: one
 * start() listens until stop().
 *
 * - Web Speech (Chrome, Edge): SpeechRecognition with `continuous` and
 *   `interimResults`; the browser ends a session on its own after a pause or a
 *   minute, so it is started again while listening is on. Free.
 * - Server (Safari, Firefox): the microphone is recorded with MediaRecorder in
 *   chunks cut at a pause (or every CHUNK_MAX_MS), and each chunk with speech
 *   in it is posted to /api/voice/transcribe (Workers AI Whisper, about 0.1
 *   credit a minute). Chunks of silence are never sent.
 *
 * Interim text (Web Speech only) replaces the previous interim text; a final
 * phrase is appended once and clears it.
 */

export type MicState = 'idle' | 'starting' | 'listening' | 'transcribing' | 'denied' | 'unavailable' | 'error';

export interface RecognizerEvents {
  /** `final` false: the words so far of the phrase being spoken (replace the last interim); true: a finished phrase (append). */
  onText(text: string, final: boolean): void;
  onState(state: MicState, message?: string): void;
}

export interface Recognizer {
  readonly engine: 'webspeech' | 'server';
  start(): void;
  stop(): void;
}

// --- Web Speech ---------------------------------------------------------------

interface SpeechAlternative {
  transcript: string;
}
interface SpeechResult {
  isFinal: boolean;
  0: SpeechAlternative;
}
export interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<SpeechResult> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onstart: (() => void) | null;
}
type RecognitionCtor = new () => SpeechRecognitionLike;

export function speechRecognitionCtor(): RecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/** Restarts in a row without a result before giving up (a recognizer that ends at once, say offline). */
const MAX_EMPTY_RESTARTS = 5;

export function webSpeechRecognizer(Ctor: RecognitionCtor, events: RecognizerEvents, lang: string): Recognizer {
  let active = false;
  let current: SpeechRecognitionLike | undefined;
  let emptyRestarts = 0;
  let interim = '';
  /** An error already reported: the end that follows it is not "idle". */
  let failed = false;

  const begin = () => {
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = lang;
    r.onstart = () => events.onState('listening');
    r.onresult = (e) => {
      emptyRestarts = 0;
      let now = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const text = result[0].transcript.trim();
        if (!text) continue;
        if (result.isFinal) {
          interim = '';
          events.onText(text, true);
        } else now += (now ? ' ' : '') + text;
      }
      if (now !== interim) {
        interim = now;
        events.onText(now, false);
      }
    };
    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      active = false;
      failed = true;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') events.onState('denied');
      else if (e.error === 'audio-capture') events.onState('unavailable', 'No microphone was found.');
      else events.onState('error', `Speech recognition stopped (${e.error}).`);
    };
    r.onend = () => {
      if (current !== r) return;
      if (interim) {
        // A phrase the browser never finalised is kept.
        events.onText(interim, true);
        interim = '';
      }
      if (active && ++emptyRestarts <= MAX_EMPTY_RESTARTS) {
        begin();
        return;
      }
      current = undefined;
      if (active) {
        active = false;
        events.onState('error', 'Speech recognition keeps stopping. Try again.');
      } else if (!failed) events.onState('idle');
    };
    current = r;
    try {
      r.start();
    } catch {
      current = undefined;
      active = false;
      events.onState('error', 'Speech recognition could not start.');
    }
  };

  return {
    engine: 'webspeech',
    start() {
      if (active) return;
      active = true;
      failed = false;
      emptyRestarts = 0;
      events.onState('starting');
      begin();
    },
    stop() {
      active = false;
      // stop() lets the last result arrive, then onend reports idle.
      if (current) current.stop();
      else events.onState('idle');
    },
  };
}

// --- Server (MediaRecorder + /api/voice/transcribe) ----------------------------------

/** A chunk ends at a pause after at least this much… */
export const CHUNK_MIN_MS = 2500;
/** …or at this length, whatever is said. */
export const CHUNK_MAX_MS = 15_000;
/** A pause: this long below the speech level. */
export const PAUSE_MS = 700;
/** RMS of the signal (0–1) that counts as speech. */
const SPEECH_LEVEL = 0.02;

export interface ServerDeps {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  Recorder: typeof MediaRecorder;
  /** Posts a chunk; resolves with its text. Throws a TranscribeError. */
  transcribe(audio: Blob, seconds: number, lang: string): Promise<string>;
  /** The signal's level now (0–1), from an AnalyserNode; undefined where there is no Web Audio (every chunk is sent then). */
  meter?(stream: MediaStream): { level(): number; close(): void } | undefined;
  now?: () => number;
}

export class TranscribeError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function recorderMime(Recorder: typeof MediaRecorder): string {
  for (const type of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm']) if (Recorder.isTypeSupported?.(type)) return type;
  return '';
}

export function serverRecognizer(deps: ServerDeps, events: RecognizerEvents, lang: string): Recognizer {
  const now = deps.now ?? (() => Date.now());
  let active = false;
  let stream: MediaStream | undefined;
  let meter: { level(): number; close(): void } | undefined;
  let recorder: MediaRecorder | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let pending = 0;
  let queue: Promise<void> = Promise.resolve();

  const release = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    meter?.close();
    meter = undefined;
    stream?.getTracks().forEach((t) => t.stop());
    stream = undefined;
  };

  const settled = () => {
    if (pending === 0) events.onState(active ? 'listening' : 'idle');
  };

  /** Records one chunk; when it ends (a pause, its length, or stop) it is sent and, while active, the next begins. */
  const record = () => {
    if (!stream) return;
    const mime = recorderMime(deps.Recorder);
    const r = new deps.Recorder(stream, mime ? { mimeType: mime } : undefined);
    const parts: Blob[] = [];
    const startedAt = now();
    let lastSpeech = 0;
    let spoke = !meter;
    r.ondataavailable = (e) => {
      if (e.data.size) parts.push(e.data);
    };
    r.onstop = () => {
      const seconds = (now() - startedAt) / 1000;
      if (spoke && parts.length) {
        const blob = new Blob(parts, { type: (r.mimeType || mime || 'audio/webm').split(';')[0] });
        pending++;
        events.onState('transcribing');
        // In order, one at a time: phrases arrive as they were said.
        queue = queue.then(async () => {
          try {
            const text = (await deps.transcribe(blob, seconds, lang)).trim();
            if (text) events.onText(text, true);
          } catch (e) {
            const status = e instanceof TranscribeError ? e.status : 0;
            active = false;
            release();
            events.onState('error', status === 402 ? 'Out of credits for voice input.' : status === 401 ? 'Sign in to use voice input.' : 'Your speech could not be written down. Try again.');
            pending = 0;
            return;
          }
          pending--;
          settled();
        });
      }
      if (active) record();
      else if (!pending) {
        release();
        events.onState('idle');
      }
    };
    recorder = r;
    r.start();
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      const t = now();
      if (meter && meter.level() > SPEECH_LEVEL) {
        spoke = true;
        lastSpeech = t;
      }
      const length = t - startedAt;
      const paused = spoke && t - lastSpeech >= PAUSE_MS;
      if (length >= CHUNK_MAX_MS || (length >= CHUNK_MIN_MS && paused)) {
        if (timer) clearInterval(timer);
        timer = undefined;
        if (r.state !== 'inactive') r.stop();
      }
    }, 100);
  };

  return {
    engine: 'server',
    start() {
      if (active) return;
      active = true;
      events.onState('starting');
      deps.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(
        (s) => {
          if (!active) {
            s.getTracks().forEach((t) => t.stop());
            return;
          }
          stream = s;
          meter = deps.meter?.(s);
          events.onState('listening');
          record();
        },
        (e: unknown) => {
          active = false;
          const name = (e as { name?: string } | null)?.name;
          if (name === 'NotAllowedError' || name === 'SecurityError') events.onState('denied');
          else if (name === 'NotFoundError' || name === 'OverconstrainedError') events.onState('unavailable', 'No microphone was found.');
          else events.onState('error', 'The microphone could not be opened.');
        },
      );
    },
    stop() {
      if (!active) return;
      active = false;
      if (timer) clearInterval(timer);
      timer = undefined;
      // The chunk being recorded is sent; its onstop reports idle once nothing is pending.
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      else {
        release();
        events.onState(pending ? 'transcribing' : 'idle');
      }
    },
  };
}

/** The level meter on a stream, through Web Audio. */
export function audioMeter(stream: MediaStream): { level(): number; close(): void } | undefined {
  const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return undefined;
  const ctx = new Ctx();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const data = new Float32Array(analyser.fftSize);
  return {
    level() {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const x of data) sum += x * x;
      return Math.sqrt(sum / data.length);
    },
    close() {
      void ctx.close();
    },
  };
}

/** POST /api/voice/transcribe: one chunk's text. */
export async function transcribeChunk(audio: Blob, seconds: number, lang: string): Promise<string> {
  const query = new URLSearchParams({ seconds: seconds.toFixed(1), lang });
  const res = await fetch(`/api/voice/transcribe?${query}`, { method: 'POST', headers: { 'Content-Type': audio.type || 'audio/webm' }, body: audio, credentials: 'same-origin' });
  if (!res.ok) throw new TranscribeError(res.status, `HTTP ${res.status}`);
  return ((await res.json()) as { text?: string }).text ?? '';
}

/** Whether this browser can take voice input at all: its own recognition, or (with `server`) a microphone to record. */
export function voiceSupported(server = true): boolean {
  if (speechRecognitionCtor()) return true;
  return server && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
}

/** The best recognizer this browser has, or undefined when it can do neither (no microphone API). */
export function createRecognizer(events: RecognizerEvents, lang = 'en-US', opts: { server?: boolean } = {}): Recognizer | undefined {
  const Ctor = speechRecognitionCtor();
  if (Ctor) return webSpeechRecognizer(Ctor, events, lang);
  if (opts.server === false || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return undefined;
  return serverRecognizer(
    { getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c), Recorder: MediaRecorder, transcribe: transcribeChunk, meter: audioMeter },
    events,
    lang.slice(0, 2).toLowerCase(),
  );
}
