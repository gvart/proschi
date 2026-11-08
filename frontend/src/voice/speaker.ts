import { useCallback, useEffect, useState } from 'react';

/**
 * Spoken replies (docs/design/paid-plans.md P39): the browser's own
 * speechSynthesis reads text aloud, free, in the most natural English voice
 * the device has. `useSpeaker` keeps the on/off choice (off by default) in
 * localStorage.
 */

const KEY = 'proschi.interview.speaker';

/** Voice names that are the good ones on each platform (neural, natural, enhanced), best first. */
const PREFERRED = [/natural/i, /neural/i, /premium/i, /enhanced/i, /^google (us|uk) english/i, /^samantha/i, /^ava/i, /^daniel/i, /^karen/i, /^serena/i, /^aria/i, /^jenny/i, /^guy/i];

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

/** The most natural English voice among `voices`: a preferred name in the page's language, then any English one. */
export function pickVoice(voices: readonly SpeechSynthesisVoice[], lang = 'en-US'): SpeechSynthesisVoice | undefined {
  const english = voices.filter((v) => v.lang?.toLowerCase().startsWith('en'));
  const rank = (v: SpeechSynthesisVoice) => {
    const i = PREFERRED.findIndex((re) => re.test(v.name));
    return (i < 0 ? PREFERRED.length : i) * 4 + (v.lang === lang ? 0 : v.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()) ? 1 : 2) + (v.localService ? 0 : 0.5);
  };
  return [...english].sort((a, b) => rank(a) - rank(b))[0];
}

/**
 * The utterance being read. Kept referenced: Chrome drops an utterance that
 * nothing holds and then never fires its end, which left the interview
 * room's mic waiting for good.
 */
let reading: SpeechSynthesisUtterance | undefined;
let watchdog: ReturnType<typeof setTimeout> | undefined;

/** The longest `text` can take to read aloud (slow speech, plus slack); past it `onEnd` runs even if the browser never says it ended. */
export function speakingLimitMs(text: string): number {
  return 5000 + text.trim().split(/\s+/).length * 600;
}

/** Reads `text` aloud, cutting off anything still being read; `onEnd` runs once it is done (or fails, or stalls), never for a reading cut off by a newer one. */
export function speak(text: string, lang = 'en-US', onEnd?: () => void): void {
  if (!speechSupported() || !text.trim()) return;
  const synth = window.speechSynthesis;
  clearTimeout(watchdog);
  // Set first: the cut-off reading's error event then finds it is no longer current.
  const u = new SpeechSynthesisUtterance(text);
  reading = u;
  synth.cancel();
  const voice = pickVoice(synth.getVoices(), lang);
  if (voice) u.voice = voice;
  u.lang = voice?.lang ?? lang;
  u.rate = 1.02;
  let ended = false;
  const end = () => {
    if (ended || reading !== u) return;
    ended = true;
    clearTimeout(watchdog);
    reading = undefined;
    onEnd?.();
  };
  u.onend = end;
  u.onerror = end;
  watchdog = setTimeout(end, speakingLimitMs(text));
  synth.speak(u);
}

/** Stops reading. */
export function stopSpeaking(): void {
  if (speechSupported()) window.speechSynthesis.cancel();
}

function readOn(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

/** The speaker toggle: whether replies are read aloud (remembered), and `say`, which reads one when it is on. */
export function useSpeaker(): { supported: boolean; on: boolean; setOn(on: boolean): void; say(text: string): void; stop(): void } {
  const [supported] = useState(speechSupported);
  const [on, set] = useState(() => supported && readOn());
  useEffect(() => {
    if (!supported) return;
    // Voices load late in Chrome: asking once makes them arrive before the first reply.
    window.speechSynthesis.getVoices();
    return () => stopSpeaking();
  }, [supported]);
  const setOn = useCallback((next: boolean) => {
    set(next);
    try {
      localStorage.setItem(KEY, next ? 'on' : 'off');
    } catch {
      // Not remembered in a private window; it still works now.
    }
    if (!next) stopSpeaking();
  }, []);
  const say = useCallback((text: string) => {
    if (on) speak(text);
  }, [on]);
  return { supported, on, setOn, say, stop: stopSpeaking };
}
