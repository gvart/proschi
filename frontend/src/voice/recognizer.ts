/**
 * Hands-free voice input (docs/design/paid-plans.md P39), without React: one
 * start() listens until stop().
 *
 * - Web Speech (Chrome, Edge): SpeechRecognition with `continuous` and
 *   `interimResults`; the browser ends a session on its own after a pause or a
 *   minute (or after a 'no-speech' or 'network' error), so it is started
 *   again at once while listening is on, keeping the words so far. Free.
 * - Server (Safari, Firefox): the microphone is recorded with MediaRecorder in
 *   chunks cut at a pause (or at a quiet moment past CHUNK_MAX_MS), each one
 *   starting before the last stops, and each chunk with speech in it is
 *   posted to /api/voice/transcribe (Workers AI Whisper, about 0.1 credit a
 *   minute). Chunks of silence are never sent. While speech is recorded or
 *   written down, the interim text is SPEAKING.
 *
 * Interim text replaces the previous interim text; a final phrase is
 * appended once and clears it.
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

/**
 * Hands-free voice input (the interview room's send on silence, P45) sends a
 * draft after this long with nothing heard, counted from the last words
 * (interim or final), so a pause to think mid-sentence does not send it.
 */
export const SEND_AFTER_SILENCE_MS = 2500;

/** Sessions in a row that end this soon after starting, without a result, are a failure loop (say, offline)… */
const FAST_END_MS = 1000;
/** …and after this many the recognizer gives up. A long silence (Chrome ends a session after a few quiet seconds) never counts. */
const MAX_FAST_ENDS = 5;
/** Errors after which the browser ends the session and a new one is started: they pass. */
const TRANSIENT = new Set(['no-speech', 'aborted', 'network']);

export function webSpeechRecognizer(Ctor: RecognitionCtor, events: RecognizerEvents, lang: string, now: () => number = () => Date.now()): Recognizer {
  let active = false;
  let current: SpeechRecognitionLike | undefined;
  let fastEnds = 0;
  let interim = '';
  /** An error already reported: the end that follows it is not "idle". */
  let failed = false;

  const begin = () => {
    const r = new Ctor();
    const startedAt = now();
    let heard = false;
    r.continuous = true;
    r.interimResults = true;
    r.lang = lang;
    r.onstart = () => events.onState('listening');
    r.onresult = (e) => {
      heard = true;
      fastEnds = 0;
      let words = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const text = result[0].transcript.trim();
        if (!text) continue;
        if (result.isFinal) {
          interim = '';
          events.onText(text, true);
        } else words += (words ? ' ' : '') + text;
      }
      if (words !== interim) {
        interim = words;
        events.onText(words, false);
      }
    };
    r.onerror = (e) => {
      if (TRANSIENT.has(e.error)) return;
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
      fastEnds = !heard && now() - startedAt < FAST_END_MS ? fastEnds + 1 : 0;
      if (active && fastEnds <= MAX_FAST_ENDS) {
        // The browser ended the session (a pause, its time limit, a network blip): listening goes on at once.
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
      fastEnds = 0;
      // Still stopping (stop() waits for the last result): its end starts the next session instead of reporting idle.
      if (current) return;
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
/** …or, past this length, at the first quiet moment (not mid-word)… */
export const CHUNK_MAX_MS = 15_000;
/** …or at this length, whatever is said. */
export const CHUNK_HARD_MS = 20_000;
/** A pause: this long below the speech level. */
export const PAUSE_MS = 700;
/**
 * The interim text while speech is recorded or still being written down
 * (where there is a level meter): the server has no words until a chunk is
 * transcribed, and this tells the composer the user is still talking, so a
 * send on silence waits.
 */
export const SPEAKING = '…';
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
  /** Speech heard in the chunk being recorded (known only with a meter). */
  let speaking = false;
  /** SPEAKING is the interim text now. */
  let shown = false;

  /** Shows SPEAKING while speech is recorded or still being written down, and clears it after. */
  const mark = () => {
    const want = (active && speaking) || pending > 0;
    if (want === shown) return;
    shown = want;
    events.onText(want ? SPEAKING : '', false);
  };

  const release = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    meter?.close();
    meter = undefined;
    stream?.getTracks().forEach((t) => t.stop());
    stream = undefined;
  };

  const settled = () => {
    if (pending !== 0) return;
    // Stopped while the last chunk was being written down: the microphone is let go now.
    if (!active) release();
    events.onState(active ? 'listening' : 'idle');
  };

  /** Records one chunk; when it ends (a pause, its length, or stop) it is sent. While active, the next chunk starts before this one stops, so no audio falls between them. */
  const record = () => {
    if (!stream) return;
    const mime = recorderMime(deps.Recorder);
    const r = new deps.Recorder(stream, mime ? { mimeType: mime } : undefined);
    const parts: Blob[] = [];
    const startedAt = now();
    let lastSpeech = 0;
    const metered = !!meter;
    let spoke = !metered;
    speaking = false;
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
            if (text) {
              // A final phrase replaces the interim text.
              shown = false;
              events.onText(text, true);
            }
          } catch (e) {
            const status = e instanceof TranscribeError ? e.status : 0;
            active = false;
            release();
            pending = 0;
            mark();
            events.onState('error', status === 402 ? 'Out of credits for voice input.' : status === 401 ? 'Sign in to use voice input.' : 'Your speech could not be written down. Try again.');
            return;
          }
          pending--;
          if (metered) mark();
          settled();
        });
      } else if (metered) mark();
      if (!active && !pending) {
        release();
        events.onState('idle');
      }
    };
    recorder = r;
    r.start();
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      const t = now();
      const loud = !!meter && meter.level() > SPEECH_LEVEL;
      if (loud) {
        spoke = true;
        speaking = true;
        lastSpeech = t;
        mark();
      }
      const length = t - startedAt;
      const paused = spoke && t - lastSpeech >= PAUSE_MS;
      if (length >= CHUNK_HARD_MS || (length >= CHUNK_MAX_MS && !loud) || (length >= CHUNK_MIN_MS && paused)) {
        if (timer) clearInterval(timer);
        timer = undefined;
        // The next chunk is already recording when this one stops.
        if (active) record();
        if (r.state !== 'inactive') r.stop();
      }
    }, 100);
  };

  return {
    engine: 'server',
    start() {
      if (active) return;
      active = true;
      if (stream) {
        // Stopped a moment ago and still writing the last chunk down: the open microphone goes on recording.
        events.onState(pending ? 'transcribing' : 'listening');
        record();
        return;
      }
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
