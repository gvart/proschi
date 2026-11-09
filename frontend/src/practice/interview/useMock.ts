import { useCallback, useEffect, useRef, useState } from 'react';
import { refreshCredits } from '../../services/useCredits';
import { finishInterview, getInterview, sendTurn, TurnError, type AiInterview, type AiMessage, type TurnDone, type TurnInput } from '../modes/ai/api';

/**
 * A mock interview's session (backend/src/interviews.ts), for the room: the
 * transcript, the reply streaming in, one turn at a time, and the verdict.
 * The session lives on the server, so a reload picks it up again.
 */

export type MockBusy = 'turn' | 'finish';

export interface MockSession {
  interview?: AiInterview;
  loadError?: string;
  messages: AiMessage[];
  /** The reply as it streams in; undefined between turns. */
  streaming?: string;
  busy?: MockBusy;
  error?: string;
  /** A turn was refused for want of credits: the server moved the interview to its wrap-up. */
  outOfCredits: boolean;
  /** Sends a turn; false when it was not kept (the message should go back to the box). */
  send(input: TurnInput): Promise<boolean>;
  finish(): Promise<void>;
}

export function turnErrorText(e: unknown): string {
  if (e instanceof TurnError) {
    if (e.code === 'time') return 'The interview has reached its 60 minutes. Get the verdict.';
    if (e.code === 'budget' || e.code === 'turns') return 'This interview has used what one session may. Get the verdict.';
    if (e.code === 'message') return 'Say something first, at most 4,000 characters.';
    if (e.code === 'design') return 'The design is too large to send (at most 64 KiB).';
    if (e.code === 'turn_in_progress') return 'Still answering your last message.';
    if (e.status === 429) return 'Too many messages; wait a minute.';
  }
  return 'The interviewer did not answer. Send it again in a moment.';
}

export function useMockInterview(id: string, onReply: (done: TurnDone) => void): MockSession {
  const [interview, setInterview] = useState<AiInterview>();
  const [loadError, setLoadError] = useState<string>();
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [streaming, setStreaming] = useState<string>();
  const [busy, setBusy] = useState<MockBusy>();
  const [error, setError] = useState<string>();
  const [outOfCredits, setOutOfCredits] = useState(false);
  const replied = useRef(onReply);
  useEffect(() => {
    replied.current = onReply;
  }, [onReply]);
  const state = useRef({ interview });
  useEffect(() => {
    state.current = { interview };
  }, [interview]);

  useEffect(() => {
    let live = true;
    getInterview(id).then(
      ({ interview }) => {
        if (!live) return;
        setInterview(interview);
        setMessages(interview.messages ?? []);
      },
      (e: unknown) => live && setLoadError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [id]);

  /** Set at once, so a second send in the same moment is refused before the state catches up. */
  const inFlight = useRef(false);
  const send = useCallback(async (input: TurnInput) => {
    const { interview } = state.current;
    if (inFlight.current || interview?.status !== 'active') return false;
    inFlight.current = true;
    setBusy('turn');
    setError(undefined);
    const sentAt = Date.now();
    const stage = input.stage ? { stage: input.stage } : {};
    setMessages((m) => [...m, { role: 'candidate', text: input.message, at: sentAt, ...stage, ...(input.design !== undefined ? { design: true } : {}) }]);
    let text = '';
    setStreaming('');
    try {
      const done = await sendTurn(interview.id, input, (piece) => {
        text += piece;
        setStreaming(text);
      });
      setMessages((m) => [...m, { role: 'interviewer', text: done.reply, at: Date.now(), ...stage, ...(done.hint ? { hint: done.hint } : {}) }]);
      setInterview((i) => i && { ...i, phase: done.phase, turns: done.turns, ...(done.known ? { known: done.known } : {}) });
      replied.current(done);
      return true;
    } catch (e) {
      // The turn was not kept.
      setMessages((m) => m.filter((x) => x.at !== sentAt));
      if (e instanceof TurnError && e.refunded) setInterview((i) => i && { ...i, status: 'failed' });
      else if (e instanceof TurnError && (e.code === 'no_credits' || e.status === 402)) setOutOfCredits(true);
      else setError(turnErrorText(e));
      return false;
    } finally {
      inFlight.current = false;
      setStreaming(undefined);
      setBusy(undefined);
      refreshCredits();
    }
  }, []);

  const finish = useCallback(async () => {
    const { interview } = state.current;
    if (inFlight.current || !interview) return;
    inFlight.current = true;
    setBusy('finish');
    setError(undefined);
    try {
      const { interview: done } = await finishInterview(interview.id);
      setInterview((i) => i && { ...i, ...done });
    } catch (e) {
      setError(`The verdict could not be written (${e instanceof Error ? e.message : String(e)}). Try again in a moment.`);
    } finally {
      inFlight.current = false;
      setBusy(undefined);
      refreshCredits();
    }
  }, []);

  return { interview, loadError, messages, streaming, busy, error, outOfCredits, send, finish };
}
