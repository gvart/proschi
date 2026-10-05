/**
 * The Arcade's sounds: tiny blips synthesised with WebAudio, no files. Off
 * by default (the settings switch them on), and silent where the browser has
 * no AudioContext.
 */

export type Cue = 'place' | 'wire' | 'remove' | 'deploy' | 'tick' | 'breach' | 'cash' | 'card' | 'boss' | 'win' | 'lose' | 'error';

let ctx: AudioContext | undefined;
let enabled = false;

export function setSound(on: boolean): void {
  enabled = on;
}

type Note = [freq: number, at: number, dur: number, type?: OscillatorType, gain?: number];

const CUES: Record<Cue, Note[]> = {
  place: [[520, 0, 0.07, 'square', 0.05], [780, 0.05, 0.08, 'square', 0.04]],
  wire: [[880, 0, 0.05, 'triangle', 0.05]],
  remove: [[300, 0, 0.08, 'square', 0.04], [200, 0.06, 0.1, 'square', 0.03]],
  deploy: [[330, 0, 0.09, 'sawtooth', 0.04], [440, 0.08, 0.09, 'sawtooth', 0.04], [660, 0.16, 0.14, 'sawtooth', 0.04]],
  tick: [[1200, 0, 0.025, 'sine', 0.02]],
  breach: [[140, 0, 0.18, 'sawtooth', 0.06], [110, 0.12, 0.2, 'sawtooth', 0.05]],
  cash: [[988, 0, 0.06, 'square', 0.035], [1319, 0.06, 0.1, 'square', 0.035]],
  card: [[660, 0, 0.08, 'triangle', 0.05], [990, 0.07, 0.08, 'triangle', 0.05], [1320, 0.14, 0.12, 'triangle', 0.05]],
  boss: [[220, 0, 0.25, 'sawtooth', 0.05], [233, 0.25, 0.25, 'sawtooth', 0.05], [220, 0.5, 0.25, 'sawtooth', 0.05]],
  win: [[523, 0, 0.12, 'square', 0.05], [659, 0.12, 0.12, 'square', 0.05], [784, 0.24, 0.12, 'square', 0.05], [1047, 0.36, 0.3, 'square', 0.05]],
  lose: [[392, 0, 0.2, 'triangle', 0.06], [330, 0.2, 0.2, 'triangle', 0.06], [262, 0.4, 0.4, 'triangle', 0.06]],
  error: [[180, 0, 0.12, 'square', 0.05]],
};

export function play(cue: Cue): void {
  if (!enabled || typeof window === 'undefined') return;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  try {
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime;
    for (const [freq, at, dur, type = 'square', gain = 0.04] of CUES[cue]) {
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0 + at);
      amp.gain.setValueAtTime(gain, t0 + at);
      amp.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      osc.connect(amp).connect(ctx.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + dur + 0.02);
    }
  } catch {
    // Audio is a garnish; never let it break the game.
  }
}

/** A short buzz on phones that have it (overload, boss); part of the sound setting. */
export function buzz(ms = 30): void {
  if (enabled && typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(ms);
}
