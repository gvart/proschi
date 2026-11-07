import { api, ApiError } from '../services/api';
import { noCredits } from '../services/credits';
import { parseSession, parseTurnAnswer, type PartnerContext, type Session, type TurnAnswer, type TurnRequest } from './contract';

/** Design partner's endpoints (backend/README.md "Design partner"). */

/** 402 `no_credits`: the turn needs about `needed`, the account has `balance`. */
export class NoCreditsError extends Error {
  readonly needed: number;
  readonly balance: number;
  constructor(needed: number, balance: number) {
    super('Not enough credits');
    this.name = 'NoCreditsError';
    this.needed = needed;
    this.balance = balance;
  }
}

/** 409 `turn_in_progress`: another turn of this session is still being answered. */
export class TurnInProgressError extends Error {
  constructor() {
    super('Another answer is still being written');
    this.name = 'TurnInProgressError';
  }
}

/** 401: the session cookie is gone. */
export class SignedOutError extends Error {
  constructor() {
    super('Signed out');
    this.name = 'SignedOutError';
  }
}

const body = (e: ApiError) => (e.body && typeof e.body === 'object' ? (e.body as Record<string, unknown>) : {});

function translate(e: unknown): never {
  const short = noCredits(e);
  if (short) throw new NoCreditsError(short.needed, short.balance);
  if (e instanceof ApiError) {
    const b = body(e);
    if (e.status === 409 && b.error === 'turn_in_progress') throw new TurnInProgressError();
    if (e.status === 401) throw new SignedOutError();
  }
  throw e;
}

export async function createSession(context: PartnerContext, deep: boolean): Promise<string> {
  const answer = await api<{ id?: unknown }>('/api/partner/sessions', { method: 'POST', body: { context, ...(deep ? { deep: true } : {}) } }).catch(translate);
  if (typeof answer?.id !== 'string') throw new Error('The server did not start a conversation');
  return answer.id;
}

/** The session, or undefined when the server no longer has it (404). */
export async function getSession(id: string): Promise<Session | undefined> {
  try {
    return parseSession(await api<unknown>(`/api/partner/sessions/${encodeURIComponent(id)}`));
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) return undefined;
    return translate(e);
  }
}

export async function sendTurn(id: string, request: TurnRequest): Promise<TurnAnswer> {
  const answer = parseTurnAnswer(await api<unknown>(`/api/partner/sessions/${encodeURIComponent(id)}/turns`, { method: 'POST', body: request }).catch(translate));
  if (!answer) throw new Error('The answer could not be read');
  return answer;
}

/** Feedback for the next turn; free, and a failure is not worth telling anyone about. */
export function decide(id: string, changeId: string, decision: 'accepted' | 'rejected'): Promise<void> {
  return api<void>(`/api/partner/sessions/${encodeURIComponent(id)}/changes/${encodeURIComponent(changeId)}`, { method: 'POST', body: { decision } }).then(
    () => undefined,
    () => undefined,
  );
}
