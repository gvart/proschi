/**
 * The interview room's sound effects (docs/design/paid-plans.md P45),
 * synthesized with the Web Audio API: no audio files. Each cue is a few
 * short, quiet notes with a soft attack and a quick decay. The room plays
 * them only while sound is on (prefs.ts); each one played is also announced
 * as a `proschi:cue` event on window, for the tests.
 */

export type Cue = 'phase' | 'warn5' | 'warn1' | 'hint' | 'reply' | 'pass' | 'fail' | 'finish';

export interface Note {
  /** Hz. */
  freq: number;
  /** Seconds after the cue starts. */
  at: number;
  /** Seconds. */
  dur: number;
  wave?: OscillatorType;
  /** 0..1 of the cue's level. */
  gain?: number;
}

const C5 = 523.25;
const D5 = 587.33;
const E5 = 659.25;
const G5 = 783.99;
const A5 = 880;
const C6 = 1046.5;
const E6 = 1318.51;
const G6 = 1567.98;
const E4 = 329.63;
const C4 = 261.63;

export const CUES: Record<Cue, Note[]> = {
  // A new phase: a rising fifth.
  phase: [
    { freq: C5, at: 0, dur: 0.16, wave: 'triangle' },
    { freq: G5, at: 0.11, dur: 0.22, wave: 'triangle' },
  ],
  // Five minutes left: two calm beats.
  warn5: [
    { freq: E5, at: 0, dur: 0.14 },
    { freq: E5, at: 0.22, dur: 0.18 },
  ],
  // One minute left: three quicker, higher beats.
  warn1: [
    { freq: A5, at: 0, dur: 0.09 },
    { freq: A5, at: 0.14, dur: 0.09 },
    { freq: A5, at: 0.28, dur: 0.14 },
  ],
  // A coaching hint: a light sparkle.
  hint: [
    { freq: G6, at: 0, dur: 0.08, gain: 0.6 },
    { freq: C6 * 2, at: 0.07, dur: 0.16, gain: 0.5 },
  ],
  // The interviewer replied while the tab was hidden.
  reply: [
    { freq: D5, at: 0, dur: 0.12 },
    { freq: A5, at: 0.09, dur: 0.18, gain: 0.7 },
  ],
  pass: [
    { freq: C5, at: 0, dur: 0.12, wave: 'triangle' },
    { freq: E5, at: 0.09, dur: 0.12, wave: 'triangle' },
    { freq: G5, at: 0.18, dur: 0.12, wave: 'triangle' },
    { freq: C6, at: 0.27, dur: 0.28, wave: 'triangle' },
  ],
  fail: [
    { freq: E4, at: 0, dur: 0.16, wave: 'triangle' },
    { freq: C4, at: 0.14, dur: 0.3, wave: 'triangle' },
  ],
  // The interview is over.
  finish: [
    { freq: C5, at: 0, dur: 0.2, wave: 'triangle' },
    { freq: G5, at: 0.16, dur: 0.2, wave: 'triangle' },
    { freq: C6, at: 0.32, dur: 0.2, wave: 'triangle' },
    { freq: E6, at: 0.48, dur: 0.4, wave: 'triangle', gain: 0.8 },
  ],
};

/** The loudest a cue gets: quiet, under speech. */
const LEVEL = 0.07;

let context: AudioContext | undefined;

function audio(): AudioContext | undefined {
  if (typeof window === 'undefined') return undefined;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return undefined;
  try {
    context ??= new Ctor();
  } catch {
    return undefined;
  }
  // Browsers start it suspended until the page was interacted with.
  if (context.state === 'suspended') void context.resume().catch(() => undefined);
  return context;
}

/** Plays a cue now. Silent where there is no Web Audio. */
export function playCue(cue: Cue): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('proschi:cue', { detail: cue }));
  const ctx = audio();
  if (!ctx) return;
  const start = ctx.currentTime + 0.01;
  for (const note of CUES[cue]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = note.wave ?? 'sine';
    osc.frequency.value = note.freq;
    const t = start + note.at;
    const peak = LEVEL * (note.gain ?? 1);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + note.dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + note.dur + 0.02);
  }
}
