import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Dictation through the browser's speech recognition (the Web Speech API,
 * docs/design/paid-plans.md P7): `supported` is false where the browser has
 * none, and the mic button is hidden there. Each final phrase goes to
 * `onPhrase`; the interviewer still answers in text.
 */

interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function useDictation(onPhrase: (text: string) => void): { supported: boolean; listening: boolean; toggle: () => void; stop: () => void } {
  const [supported] = useState(() => recognitionCtor() !== undefined);
  const [listening, setListening] = useState(false);
  const recognition = useRef<Recognition | undefined>(undefined);
  const phrase = useRef(onPhrase);
  useEffect(() => {
    phrase.current = onPhrase;
  }, [onPhrase]);

  const stop = useCallback(() => {
    recognition.current?.stop();
    recognition.current = undefined;
    setListening(false);
  }, []);

  const toggle = useCallback(() => {
    if (recognition.current) return stop();
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = false;
    r.lang = document.documentElement.lang || 'en-US';
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal && result[0].transcript.trim()) phrase.current(result[0].transcript.trim());
      }
    };
    r.onend = () => {
      if (recognition.current === r) recognition.current = undefined;
      setListening(false);
    };
    r.onerror = r.onend;
    recognition.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      recognition.current = undefined;
    }
  }, [stop]);

  useEffect(() => () => recognition.current?.stop(), []);
  return { supported, listening, toggle, stop };
}
