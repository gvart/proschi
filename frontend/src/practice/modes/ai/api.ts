import { api, ApiError, apiEnabled } from '../../../services/api';
import { loadJson, saveJson } from '../../../services/storage';
import { PHASES, PHASE_SHARE, type Duration, type Phase } from '../session';

/**
 * The AI interviewer's API (backend/src/interviews.ts) and what this browser
 * remembers about it: the session in progress per problem, so a reload
 * resumes it, and the one-time consent to send the interview to the AI
 * provider. The transcript itself lives on the server (90 days).
 */

export type HintKind = 'focus' | 'improve' | 'wrapup';
export interface Hint {
  kind: HintKind;
  text: string;
}

export const SKILLS = ['requirements', 'estimation', 'design', 'tradeoffs', 'communication'] as const;
export type Skill = (typeof SKILLS)[number];

export interface Verdict {
  passed: boolean;
  scores: Record<Skill, number>;
  wentWell: { skill: Skill; text: string }[];
  wentWrong: { skill: Skill; text: string }[];
  nextSteps: string[];
}

export interface AiMessage {
  role: 'interviewer' | 'candidate';
  text: string;
  /** Unix ms. */
  at: number;
  hint?: Hint;
  /** The candidate's turn sent the design. */
  design?: boolean;
}

export type AiStatus = 'active' | 'finishing' | 'finished' | 'failed' | 'abandoned';

export interface AiInterview {
  id: string;
  problem: string;
  minutes: Duration;
  status: AiStatus;
  startedAt: number;
  endedAt?: number;
  verdict?: Verdict;
  phase?: Phase;
  turns?: number;
  /** No turn after this (the 60-minute wall clock). */
  deadline?: number;
  messages?: AiMessage[];
}

export interface Credits {
  total: number;
  monthly: number;
  trial: number;
  pack: number;
  period: string;
}

/** GET /api/interviews; undefined when the server has no AI key (501) or the call fails. */
export async function listInterviews(): Promise<{ interviews: AiInterview[]; credits: Credits } | undefined> {
  try {
    return await api<{ interviews: AiInterview[]; credits: Credits }>('/api/interviews');
  } catch {
    return undefined;
  }
}

/** Starts one; `replace` ends the open one first (its credit is not returned). */
export const startInterview = (problem: string, minutes: Duration, replace = false) =>
  api<{ interview: AiInterview; credits: Credits }>('/api/interviews', { method: 'POST', body: { problem, minutes, ...(replace ? { replace: true } : {}) } });
export const getInterview = (id: string) => api<{ interview: AiInterview }>(`/api/interviews/${encodeURIComponent(id)}`);
export const finishInterview = (id: string) => api<{ interview: AiInterview }>(`/api/interviews/${encodeURIComponent(id)}/finish`, { method: 'POST' });

export interface SseEvent {
  event: string;
  data: unknown;
}

/** Splits Server-Sent Events text into complete events; returns them and the unfinished rest. */
export function parseSse(buffer: string): { events: SseEvent[]; rest: string } {
  const events: SseEvent[] = [];
  const chunks = buffer.replace(/\r\n?/g, '\n').split('\n\n');
  const rest = chunks.pop() ?? '';
  for (const chunk of chunks) {
    let event = 'message';
    const data: string[] = [];
    for (const line of chunk.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (!data.length) continue;
    try {
      events.push({ event, data: JSON.parse(data.join('\n')) as unknown });
    } catch {
      // A broken event is skipped; the turn's done or error event decides.
    }
  }
  return { events, rest };
}

export interface TurnInput {
  message: string;
  design?: string;
  advance?: boolean;
}

export interface TurnDone {
  reply: string;
  phase: Phase;
  elapsedMs: number;
  turns: number;
  hint?: Hint;
  grade?: { passed: number; total: number; solved: boolean; blocked?: string };
}

/** A turn that failed after the reply started, or before it as JSON. `refunded`: the credit came back and the session ended. */
export class TurnError extends Error {
  readonly code: string;
  readonly refunded: boolean;
  readonly status?: number;
  constructor(code: string, refunded: boolean, status?: number) {
    super(code);
    this.name = 'TurnError';
    this.code = code;
    this.refunded = refunded;
    this.status = status;
  }
}

/** POST /api/interviews/<id>/turn: the reply streams into `onText`; resolves once `done` arrives. */
export async function sendTurn(id: string, input: TurnInput, onText: (text: string) => void): Promise<TurnDone> {
  const response = await fetch(`/api/interviews/${encodeURIComponent(id)}/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    credentials: 'same-origin',
  });
  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => ({}))) as { error?: string; refunded?: boolean };
    throw new TurnError(body.error ?? `http_${response.status}`, body.refunded === true, response.status);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let hint: Hint | undefined;
  let grade: TurnDone['grade'];
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += value;
    const parsed = parseSse(done ? `${buffer}\n\n` : buffer);
    buffer = parsed.rest;
    for (const e of parsed.events) {
      const d = e.data as Record<string, unknown>;
      if (e.event === 'text' && typeof d.text === 'string') onText(d.text);
      else if (e.event === 'hint') hint = d as unknown as Hint;
      else if (e.event === 'grade') grade = d as unknown as TurnDone['grade'];
      else if (e.event === 'done') return { ...(d as unknown as TurnDone), ...(hint ? { hint } : {}), ...(grade ? { grade } : {}) };
      else if (e.event === 'error') throw new TurnError(String(d.error ?? 'failed'), d.refunded === true);
    }
    if (done) throw new TurnError('network', false);
  }
}

/** Why a start was refused, for the start screen. */
export function startError(e: unknown): { code: 'no_credits'; credits?: Credits } | { code: 'active_session'; id: string; problem: string } | { code: 'other'; message: string } {
  if (e instanceof ApiError && e.status === 402) return { code: 'no_credits', credits: (e.body as { credits?: Credits } | undefined)?.credits };
  const open = e instanceof ApiError && e.status === 409 ? (e.body as { error?: string; id?: unknown; problem?: unknown } | undefined) : undefined;
  if (open?.error === 'active_session' && typeof open.id === 'string' && typeof open.problem === 'string') return { code: 'active_session', id: open.id, problem: open.problem };
  return { code: 'other', message: e instanceof Error ? e.message : String(e) };
}

const ACTIVE_KEY = (problem: string) => `proschi.aiInterview.${problem}`;
const CONSENT_KEY = 'proschi.aiInterview.consent';

export function loadActive(problem: string): string | undefined {
  const id = loadJson<unknown>(ACTIVE_KEY(problem), undefined);
  return typeof id === 'string' && id ? id : undefined;
}

export function saveActive(problem: string, id: string | undefined): void {
  if (id) saveJson(ACTIVE_KEY(problem), id);
  else {
    try {
      localStorage.removeItem(ACTIVE_KEY(problem));
    } catch {
      // Storage unavailable: nothing was stored.
    }
  }
}

/** Whether an AI interview is open for the problem in this browser, so the page opens interview mode on load. */
export const hasAiInterview = (problem: string): boolean => apiEnabled && loadActive(problem) !== undefined;

const phaseIndex = (p: Phase) => PHASES.findIndex((x) => x.id === p);

/** The phase to show: the clock's (the server's 10/10/70/10 split of the chosen length), or a later one the session moved on to. */
export function shownPhase(interview: Pick<AiInterview, 'minutes' | 'startedAt' | 'phase'>, now: number): Phase {
  let end = 0;
  const elapsed = now - interview.startedAt;
  const byClock = PHASES.find((p) => elapsed < (end += PHASE_SHARE[p.id] * interview.minutes * 60_000))?.id ?? 'wrapup';
  const server = interview.phase ?? 'clarify';
  return phaseIndex(byClock) > phaseIndex(server) ? byClock : server;
}

export const hasConsent =(): boolean => loadJson<unknown>(CONSENT_KEY, false) === true;
export const giveConsent = (): void => saveJson(CONSENT_KEY, true);
