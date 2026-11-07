import { useCallback, useEffect, useRef, useState } from 'react';
import { createSession, decide as postDecision, getSession, NoCreditsError, sendTurn, SignedOutError, TurnInProgressError } from './api';
import type { Intent, PartnerContext, Turn, TurnRequest } from './contract';
import { reportBalance } from '../services/useCredits';
import { loadStored, saveStored, type Decision } from './store';

/** Why the last send did not get an answer. */
export type PartnerProblem =
  | { kind: 'no_credits'; needed: number; balance: number }
  | { kind: 'signed_out' }
  /** 409: another answer of this conversation is being written; the page polls until it shows. */
  | { kind: 'busy' }
  | { kind: 'error'; message: string };

export interface PartnerState {
  sessionId?: string;
  /** Whether the open conversation runs Deep (fixed when it starts). */
  sessionDeep: boolean;
  turns: Turn[];
  /** What each partner turn cost, by turn id (this page's answers only). */
  charges: Record<string, number>;
  balance?: number;
  /** `resuming`: reading the stored conversation; `sending`: waiting for an answer. */
  status: 'idle' | 'resuming' | 'sending';
  /** The intent being answered while sending. */
  sending?: Intent;
  problem?: PartnerProblem;
  decisions: Record<string, Decision>;
}

interface Options {
  /** `editor:<docId>` or `practice:<problemId>`. */
  storeKey: string;
  context: PartnerContext;
  /** Signed in with the feature: only then is the stored conversation read. */
  enabled: boolean;
  getSource: () => string;
  getFiles?: () => { name: string; source: string }[] | undefined;
  /** A turn came with assisted: true (practice). */
  onAssisted?: () => void;
}

const POLL_MS = 2500;
const POLL_FOR_MS = 120_000;

const EMPTY: PartnerState = { sessionDeep: false, turns: [], charges: {}, status: 'idle', decisions: {} };

/** Design partner's conversation for one document or problem: resume, send, decide. */
export function usePartner({ storeKey, context, enabled, getSource, getFiles, onAssisted }: Options) {
  const [state, setState] = useState<PartnerState>(EMPTY);
  const stateRef = useRef(state);
  const onAssistedRef = useRef(onAssisted);
  const contextRef = useRef(context);
  const keyRef = useRef(storeKey);
  useEffect(() => {
    keyRef.current = storeKey;
    stateRef.current = state;
    onAssistedRef.current = onAssisted;
    contextRef.current = context;
  });
  const inFlight = useRef(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const noteAssisted = (turns: Turn[]) => {
    if (turns.some((t) => t.assisted)) onAssistedRef.current?.();
  };

  /** After a 409: read the conversation until its running answer is in, then let the user send again. */
  const pollBusy = useCallback(
    (id: string, started = Date.now()) => {
      clearTimeout(pollTimer.current);
      pollTimer.current = setTimeout(async () => {
        const session = await getSession(id).catch(() => undefined);
        if (stateRef.current.sessionId !== id) return;
        const last = session?.turns[session.turns.length - 1];
        if (session && last?.role === 'partner' && session.turns.length > stateRef.current.turns.length) {
          setState((s) => ({ ...s, turns: session.turns, problem: undefined }));
          noteAssisted(session.turns);
          return;
        }
        if (Date.now() - started < POLL_FOR_MS) pollBusy(id, started);
        else setState((s) => (s.problem?.kind === 'busy' ? { ...s, problem: undefined } : s));
      }, POLL_MS);
    },
    [],
  );

  // Another document or problem: its own conversation, read back from the server.
  useEffect(() => {
    clearTimeout(pollTimer.current);
    const stored = enabled ? loadStored(storeKey) : undefined;
    if (!stored) {
      setState(EMPTY);
      return;
    }
    let live = true;
    setState({ ...EMPTY, sessionId: stored.id, decisions: stored.decisions ?? {}, status: 'resuming' });
    getSession(stored.id).then(
      (session) => {
        if (!live) return;
        if (!session) {
          saveStored(storeKey, undefined);
          setState(EMPTY);
          return;
        }
        const waiting = session.turns[session.turns.length - 1]?.role === 'user';
        setState((s) => ({ ...s, status: 'idle', sessionDeep: session.deep, turns: session.turns, ...(waiting ? { problem: { kind: 'busy' as const } } : {}) }));
        noteAssisted(session.turns);
        if (waiting) pollBusy(stored.id);
      },
      (e) => live && setState((s) => ({ ...s, status: 'idle', problem: e instanceof SignedOutError ? { kind: 'signed_out' } : { kind: 'error', message: 'The conversation could not be loaded. Try again in a moment.' } })),
    );
    return () => {
      live = false;
    };
  }, [storeKey, enabled, pollBusy]);

  useEffect(() => () => clearTimeout(pollTimer.current), []);

  /** Sends a turn; resolves true when it was answered (the composer then clears). */
  const send = useCallback(
    async (intent: Intent, message: string, opts: { changeId?: string; deep?: boolean } = {}): Promise<boolean> => {
      const s = stateRef.current;
      if (inFlight.current || s.status !== 'idle') return false;
      inFlight.current = true;
      const local: Turn = { id: `local-${Date.now()}`, role: 'user', message, at: Date.now() };
      setState((x) => ({ ...x, status: 'sending', sending: intent, problem: undefined, turns: [...x.turns, local] }));
      const drop = (problem: PartnerProblem) => setState((x) => ({ ...x, status: 'idle', sending: undefined, problem, turns: x.turns.filter((t) => t.id !== local.id) }));
      let id = s.sessionId;
      try {
        if (!id) {
          const deep = !!opts.deep;
          id = await createSession(contextRef.current, deep);
          saveStored(storeKey, { id, decisions: {} });
          const created = id;
          setState((x) => ({ ...x, sessionId: created, sessionDeep: deep }));
        }
        const files = getFiles?.();
        const request: TurnRequest = { intent, message, source: getSource(), ...(files?.length ? { files } : {}), ...(opts.changeId ? { changeId: opts.changeId } : {}) };
        const answer = await sendTurn(id, request);
        // Another document or problem opened meanwhile: the answer belongs to the conversation left behind.
        if (keyRef.current !== storeKey) return true;
        setState((x) => ({
          ...x,
          status: 'idle',
          sending: undefined,
          turns: [...x.turns, answer.turn],
          charges: { ...x.charges, [answer.turn.id]: answer.credits.charged },
          balance: answer.credits.balance,
        }));
        reportBalance(answer.credits.balance);
        if (answer.turn.assisted) onAssistedRef.current?.();
        return true;
      } catch (e) {
        if (e instanceof NoCreditsError) drop({ kind: 'no_credits', needed: e.needed, balance: e.balance });
        else if (e instanceof SignedOutError) drop({ kind: 'signed_out' });
        else if (e instanceof TurnInProgressError && id) {
          drop({ kind: 'busy' });
          pollBusy(id);
        } else drop({ kind: 'error', message: 'Design partner could not answer just now. Your message is still in the box; try again in a moment.' });
        return false;
      } finally {
        inFlight.current = false;
      }
    },
    [storeKey, getSource, getFiles, pollBusy],
  );

  const decide = useCallback(
    (changeId: string, decision: Decision | undefined) => {
      const id = stateRef.current.sessionId;
      if (!id) return;
      setState((x) => {
        const decisions = { ...x.decisions };
        if (decision) decisions[changeId] = decision;
        else delete decisions[changeId];
        saveStored(storeKey, { id, decisions });
        return { ...x, decisions };
      });
      // Undoing an accepted change tells the server it was turned down after all.
      void postDecision(id, changeId, decision ?? 'rejected');
    },
    [storeKey],
  );

  /** Starts over: the next message opens a new conversation. */
  const reset = useCallback(() => {
    clearTimeout(pollTimer.current);
    saveStored(storeKey, undefined);
    setState(EMPTY);
  }, [storeKey]);

  const dismiss = useCallback(() => setState((x) => ({ ...x, problem: undefined })), []);

  return { state, send, decide, reset, dismiss };
}
