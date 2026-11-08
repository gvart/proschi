import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Loader2, Mic, MicOff } from 'lucide-react';
import { createRecognizer, voiceSupported, type MicState, type Recognizer } from './recognizer';

/**
 * The shared mic button (docs/design/paid-plans.md P39): one tap listens
 * hands-free until tapped again. Where the browser has speech recognition it
 * is free and shows the words as they are spoken; elsewhere (Safari,
 * Firefox) the speech is written down on the server, a phrase at a time, for
 * about 0.1 credit a minute. While listening, the button turns red with a
 * pulsing ring (static with reduced motion) and keeps its 36x36 size: the
 * word Listening is in its label and status, never in the button. A blocked
 * or missing microphone says so above it.
 *
 *   <MicButton onText={(text, final) => …} onState={(s) => …} ref={mic} />
 *
 * `onText(text, false)` is the phrase being spoken (replace the last one),
 * `onText(text, true)` a finished phrase (append it). `ref.current.stop()`
 * stops listening (say, on send). Hidden where neither way works.
 */

export interface MicButtonHandle {
  stop(): void;
  /** Starts listening, as a tap would (the interview room's voice mode); nothing while already on. */
  start(): void;
}

interface Props {
  onText(text: string, final: boolean): void;
  onState?(state: MicState): void;
  disabled?: boolean;
  /** BCP 47; the page's language when unset. */
  lang?: string;
  /** False: only the browser's own recognition, never the server's (it costs credits). */
  server?: boolean;
  className?: string;
  ref?: Ref<MicButtonHandle>;
}

const LABEL: Record<MicState, string> = {
  idle: 'Start voice input',
  starting: 'Starting the microphone…',
  listening: 'Listening. Stop voice input',
  transcribing: 'Writing down what you said. Stop voice input',
  denied: 'Microphone blocked',
  unavailable: 'No microphone',
  error: 'Start voice input',
};

export const DENIED_TEXT = 'The microphone is blocked. Allow it for this site in the browser’s settings (the icon by the address), then tap the mic again.';

export default function MicButton({ onText, onState, disabled, lang, server = true, className = '', ref }: Props) {
  const [state, setState] = useState<MicState>('idle');
  const [message, setMessage] = useState<string>();
  const recognizer = useRef<Recognizer | undefined>(undefined);
  const callbacks = useRef({ onText, onState });
  useEffect(() => {
    callbacks.current = { onText, onState };
  }, [onText, onState]);

  const [supported] = useState(() => voiceSupported(server));

  const get = useCallback((): Recognizer | undefined => {
    if (!recognizer.current) {
      recognizer.current = createRecognizer(
        {
          onText: (text, final) => callbacks.current.onText(text, final),
          onState: (s, m) => {
            setState(s);
            setMessage(m);
            callbacks.current.onState?.(s);
          },
        },
        lang || (typeof document !== 'undefined' && document.documentElement.lang) || 'en-US',
        { server },
      );
    }
    return recognizer.current;
  }, [lang, server]);

  const on = state === 'starting' || state === 'listening' || state === 'transcribing';
  const toggle = () => {
    const r = get();
    if (!r) return;
    if (on) r.stop();
    else r.start();
  };

  useImperativeHandle(
    ref,
    () => ({
      stop: () => recognizer.current?.stop(),
      // Not guarded by `on`: right after stop() the state still reads listening until the browser ends the session, and a start then must not be lost.
      start: () => get()?.start(),
    }),
    [get],
  );
  useEffect(() => () => recognizer.current?.stop(), []);
  useEffect(() => {
    if (disabled && on) recognizer.current?.stop();
  }, [disabled, on]);

  if (!supported) return null;
  const note = state === 'denied' ? DENIED_TEXT : state === 'unavailable' || state === 'error' ? message : undefined;
  const busy = state === 'starting' || state === 'transcribing';
  return (
    <span className={`relative inline-flex ${className}`}>
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-pressed={on}
        aria-label={LABEL[state]}
        title={LABEL[state]}
        data-testid="mic-button"
        data-state={state}
        className={`relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border-bw-1 p-0 transition-colors disabled:opacity-50 ${
          on ? 'border-ink bg-red-600 text-white dark:bg-red-500' : state === 'denied' ? 'border-ink bg-pop-yellow/40 text-ink' : 'border-ink bg-surface text-ink hover:bg-pop-yellow/30'
        }`}
      >
        {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : state === 'denied' || state === 'unavailable' ? <MicOff size={16} aria-hidden="true" /> : <Mic size={16} aria-hidden="true" />}
        {/* Recording: a ring just outside the button, pulsing (static with reduced motion). Absolute, so the button never changes size. */}
        {on && <span data-testid="mic-ring" aria-hidden="true" className="pointer-events-none absolute -inset-[3px] rounded-[7px] border-2 border-red-500 animate-pulse motion-reduce:animate-none dark:border-red-400" />}
      </button>
      <span role="status" className="sr-only">
        {state === 'listening' ? 'Listening' : state === 'transcribing' ? 'Writing down what you said' : ''}
      </span>
      {note && (
        <span role="alert" data-testid="mic-note" className="absolute bottom-full right-0 z-20 mb-2 w-64 rounded-sm border-bw-1 border-ink bg-paper px-2.5 py-1.5 text-xs text-ink shadow-brutal-sm">
          {note}
        </span>
      )}
    </span>
  );
}
