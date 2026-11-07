import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serverRecognizer, TranscribeError, webSpeechRecognizer, type MicState, type SpeechRecognitionLike } from './recognizer';
import { pickVoice } from './speaker';

class FakeRecognition implements SpeechRecognitionLike {
  static all: FakeRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = '';
  onresult: SpeechRecognitionLike['onresult'] = null;
  onend: SpeechRecognitionLike['onend'] = null;
  onerror: SpeechRecognitionLike['onerror'] = null;
  onstart: SpeechRecognitionLike['onstart'] = null;
  started = false;
  constructor() {
    FakeRecognition.all.push(this);
  }
  start() {
    this.started = true;
    this.onstart?.();
  }
  stop() {
    this.onend?.();
  }
  abort() {
    this.onend?.();
  }
  say(parts: [string, boolean][]) {
    this.onresult?.({ resultIndex: 0, results: parts.map(([t, isFinal]) => ({ isFinal, 0: { transcript: t } })) });
  }
}

function recorder() {
  const texts: [string, boolean][] = [];
  const states: MicState[] = [];
  return { texts, states, events: { onText: (t: string, f: boolean) => texts.push([t, f]), onState: (s: MicState) => states.push(s) } };
}

describe('Web Speech recognizer', () => {
  beforeEach(() => (FakeRecognition.all = []));

  it('listens continuously with interim text, and starts again when the browser ends a session', () => {
    const { texts, states, events } = recorder();
    const r = webSpeechRecognizer(FakeRecognition, events, 'en-GB');
    r.start();
    const first = FakeRecognition.all[0];
    expect(first).toMatchObject({ continuous: true, interimResults: true, lang: 'en-GB', started: true });
    first.say([['how many', false]]);
    first.say([['how many redirects', false]]);
    first.say([['How many redirects a second?', true]]);
    // The browser stops after a pause: listening goes on in a new session.
    first.onend!();
    expect(FakeRecognition.all).toHaveLength(2);
    expect(states).toEqual(['starting', 'listening', 'listening']);
    r.stop();
    expect(states.at(-1)).toBe('idle');
    expect(texts).toEqual([
      ['how many', false],
      ['how many redirects', false],
      // A final phrase clears the interim one: no empty interim follows it.
      ['How many redirects a second?', true],
    ]);
  });

  it('keeps an unfinished phrase when the session ends', () => {
    const { texts, events } = recorder();
    const r = webSpeechRecognizer(FakeRecognition, events, 'en-US');
    r.start();
    FakeRecognition.all[0].say([['is there a budget', false]]);
    r.stop();
    expect(texts.at(-1)).toEqual(['is there a budget', true]);
  });

  it('reports a blocked microphone and does not start again', () => {
    const { states, events } = recorder();
    const r = webSpeechRecognizer(FakeRecognition, events, 'en-US');
    r.start();
    FakeRecognition.all[0].onerror!({ error: 'not-allowed' });
    FakeRecognition.all[0].onend!();
    expect(states.at(-1)).toBe('denied');
    expect(FakeRecognition.all).toHaveLength(1);
  });

  it('gives up after sessions that end at once without a word', () => {
    const { states, events } = recorder();
    webSpeechRecognizer(FakeRecognition, events, 'en-US').start();
    for (let i = 0; i < 6; i++) FakeRecognition.all.at(-1)!.onend!();
    expect(states.at(-1)).toBe('error');
    expect(FakeRecognition.all).toHaveLength(6);
  });
});

class FakeRecorder {
  static all: FakeRecorder[] = [];
  static isTypeSupported = (t: string) => t === 'audio/mp4';
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_s: MediaStream, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? '';
    FakeRecorder.all.push(this);
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['x'.repeat(100)]) });
    this.onstop?.();
  }
}

describe('server recognizer', () => {
  let clock = 0;
  beforeEach(() => {
    vi.useFakeTimers();
    clock = 0;
    FakeRecorder.all = [];
  });
  afterEach(() => vi.useRealTimers());

  const stream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
  const tick = async (ms: number) => {
    for (let t = 0; t < ms; t += 100) {
      clock += 100;
      await vi.advanceTimersByTimeAsync(100);
    }
  };

  it('records a chunk until a pause, sends only chunks with speech, and goes on until stopped', async () => {
    let level = 0;
    const transcribe = vi.fn<(b: Blob, s: number) => Promise<string>>(async () => 'Is there a budget?');
    const { texts, states, events } = recorder();
    const r = serverRecognizer(
      { getUserMedia: async () => stream, Recorder: FakeRecorder as unknown as typeof MediaRecorder, transcribe, meter: () => ({ level: () => level, close: () => {} }), now: () => clock },
      events,
      'en',
    );
    r.start();
    await tick(100);
    expect(states).toEqual(['starting', 'listening']);
    expect(FakeRecorder.all[0].mimeType).toBe('audio/mp4');
    // Silence alone is never cut at a pause (only at 15 s), and a silent chunk is never sent.
    await tick(3000);
    expect(FakeRecorder.all).toHaveLength(1);
    level = 0.2;
    await tick(1000);
    level = 0;
    await tick(800);
    // Cut at the pause and sent; the next chunk is recording.
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(transcribe.mock.calls[0][1]).toBeCloseTo(4.9, 0);
    expect(FakeRecorder.all).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(texts).toEqual([['Is there a budget?', true]]);
    expect(states).toContain('transcribing');
    // Stopping with a silent chunk sends nothing more.
    r.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toBe('idle');
  });

  it('reports a blocked microphone, and stops on no credits', async () => {
    const { states, events } = recorder();
    const denied = serverRecognizer({ getUserMedia: () => Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' })), Recorder: FakeRecorder as unknown as typeof MediaRecorder, transcribe: vi.fn() }, events, 'en');
    denied.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)).toBe('denied');

    const poor = recorder();
    const r = serverRecognizer(
      { getUserMedia: async () => stream, Recorder: FakeRecorder as unknown as typeof MediaRecorder, transcribe: () => Promise.reject(new TranscribeError(402, 'no')), now: () => clock },
      poor.events,
      'en',
    );
    r.start();
    await tick(100);
    // Without a level meter every chunk is sent; at 15 s it is cut.
    await tick(15_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(poor.states.at(-1)).toBe('error');
  });
});

describe('pickVoice', () => {
  const v = (name: string, lang: string, localService = true) => ({ name, lang, localService, default: false, voiceURI: name }) as SpeechSynthesisVoice;
  it('prefers a natural English voice in the page language', () => {
    expect(pickVoice([v('Thomas', 'fr-FR'), v('Fred', 'en-US'), v('Microsoft Aria Online (Natural) - English (United States)', 'en-US', false), v('Samantha', 'en-US')])?.name).toContain('Natural');
    expect(pickVoice([v('Fred', 'en-US'), v('Samantha', 'en-US')])?.name).toBe('Samantha');
    expect(pickVoice([v('Thomas', 'fr-FR')])).toBeUndefined();
  });
});
