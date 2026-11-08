import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { speak, speakingLimitMs, stopSpeaking } from './speaker';

class Utterance {
  voice: unknown;
  lang = '';
  rate = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  text: string;
  constructor(text: string) {
    this.text = text;
  }
}

describe('speak', () => {
  let spoken: Utterance[];
  beforeEach(() => {
    vi.useFakeTimers();
    spoken = [];
    const synth = {
      getVoices: () => [],
      speak: (u: Utterance) => spoken.push(u),
      // As browsers do: cancelling fires the error of what was being read.
      cancel: () => spoken.at(-1)?.onerror?.(),
    };
    vi.stubGlobal('window', { speechSynthesis: synth });
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('ends once, even when the browser never says the reading ended', () => {
    const onEnd = vi.fn();
    speak('A queue between the API and the workers.', 'en-US', onEnd);
    vi.advanceTimersByTime(speakingLimitMs('A queue between the API and the workers.'));
    expect(onEnd).toHaveBeenCalledTimes(1);
    spoken[0].onend!();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('does not end a reading that a newer one cut off, and ends a stopped one', () => {
    const first = vi.fn();
    const second = vi.fn();
    speak('First reply.', 'en-US', first);
    speak('Second reply.', 'en-US', second);
    expect(first).not.toHaveBeenCalled();
    stopSpeaking();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
