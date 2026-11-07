/**
 * Design partner's API types (docs/impl/design-partner.md, "Design partner"
 * and "Credits"; docs/design/paid-plans.md P29–P31) and the parsers that
 * read the server's answers. A malformed field reads as absent rather than
 * breaking the panel.
 */

export type Intent = 'review' | 'build' | 'chat' | 'improve' | 'solve';

export type PartnerContext = { kind: 'editor' } | { kind: 'practice'; problemId: string };

export interface Metrics {
  tests: { passed: number; total: number } | null;
  p99Ms: number | null;
  availability: number | null;
  costPerMonth: number | null;
}

export interface Edit {
  find: string;
  replace: string;
}

export type ChangeResult =
  | { ok: true; source: string; summary: string[]; before: Metrics; after: Metrics }
  | { ok: false; reason: string };

export interface Change {
  id: string;
  title: string;
  why: string;
  edits: Edit[];
  result: ChangeResult;
}

export interface Question {
  id: string;
  text: string;
  options?: string[];
}

export interface Turn {
  id: string;
  role: 'user' | 'partner';
  /** Markdown. */
  message: string;
  questions?: Question[];
  changes?: Change[];
  assisted?: boolean;
  at: number;
}

export interface Session {
  id: string;
  context: PartnerContext;
  deep: boolean;
  turns: Turn[];
}

export interface TurnRequest {
  intent: Intent;
  message: string;
  source: string;
  files?: { name: string; source: string }[];
  changeId?: string;
}

export interface TurnAnswer {
  turn: Turn;
  credits: { charged: number; balance: number };
}

export interface Range {
  min: number;
  max: number;
}

export interface Estimates {
  mock_interview: Range;
  partner_review: Range;
  partner_build: Range;
  partner_turn: Range;
  deepMultiplier: number;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function parseMetrics(v: unknown): Metrics {
  const m = isObject(v) ? v : {};
  const t = isObject(m.tests) ? m.tests : null;
  const passed = t ? num(t.passed) : null;
  const total = t ? num(t.total) : null;
  return {
    tests: passed !== null && total !== null ? { passed, total } : null,
    p99Ms: num(m.p99Ms),
    availability: num(m.availability),
    costPerMonth: num(m.costPerMonth),
  };
}

function parseChange(v: unknown): Change | undefined {
  if (!isObject(v)) return undefined;
  const id = str(v.id);
  if (!id) return undefined;
  const edits = Array.isArray(v.edits)
    ? v.edits.flatMap((e) => (isObject(e) && typeof e.find === 'string' && typeof e.replace === 'string' ? [{ find: e.find, replace: e.replace }] : []))
    : [];
  const r = isObject(v.result) ? v.result : {};
  const result: ChangeResult =
    r.ok === true && typeof r.source === 'string'
      ? {
          ok: true,
          source: r.source,
          summary: Array.isArray(r.summary) ? r.summary.filter((s): s is string => typeof s === 'string') : [],
          before: parseMetrics(r.before),
          after: parseMetrics(r.after),
        }
      : { ok: false, reason: str(r.reason) ?? 'The change could not be checked.' };
  return { id, title: str(v.title) ?? 'A change', why: str(v.why) ?? '', edits, result };
}

function parseQuestion(v: unknown): Question | undefined {
  if (!isObject(v)) return undefined;
  const id = str(v.id);
  const text = str(v.text);
  if (!id || !text) return undefined;
  const options = Array.isArray(v.options) ? v.options.filter((o): o is string => typeof o === 'string' && o.trim() !== '') : [];
  return { id, text, ...(options.length ? { options } : {}) };
}

export function parseTurn(v: unknown): Turn | undefined {
  if (!isObject(v)) return undefined;
  const id = str(v.id);
  if (!id || (v.role !== 'user' && v.role !== 'partner')) return undefined;
  const questions = Array.isArray(v.questions) ? v.questions.map(parseQuestion).filter((q): q is Question => !!q) : [];
  const changes = Array.isArray(v.changes) ? v.changes.map(parseChange).filter((c): c is Change => !!c) : [];
  return {
    id,
    role: v.role,
    message: str(v.message) ?? '',
    ...(questions.length ? { questions } : {}),
    ...(changes.length ? { changes } : {}),
    ...(v.assisted === true ? { assisted: true } : {}),
    at: num(v.at) ?? Date.now(),
  };
}

export function parseSession(v: unknown): Session | undefined {
  if (!isObject(v)) return undefined;
  const id = str(v.id);
  if (!id) return undefined;
  const c = isObject(v.context) ? v.context : {};
  const context: PartnerContext = c.kind === 'practice' && typeof c.problemId === 'string' ? { kind: 'practice', problemId: c.problemId } : { kind: 'editor' };
  const turns = Array.isArray(v.turns) ? v.turns.map(parseTurn).filter((t): t is Turn => !!t) : [];
  return { id, context, deep: v.deep === true, turns };
}

export function parseTurnAnswer(v: unknown): TurnAnswer | undefined {
  if (!isObject(v)) return undefined;
  const turn = parseTurn(v.turn);
  if (!turn) return undefined;
  const c = isObject(v.credits) ? v.credits : {};
  return { turn, credits: { charged: num(c.charged) ?? 0, balance: num(c.balance) ?? 0 } };
}

function parseRange(v: unknown): Range | undefined {
  if (!isObject(v)) return undefined;
  const min = num(v.min);
  const max = num(v.max);
  return min !== null && max !== null ? { min, max } : undefined;
}

export function parseEstimates(v: unknown): Estimates | undefined {
  if (!isObject(v)) return undefined;
  const review = parseRange(v.partner_review);
  const build = parseRange(v.partner_build);
  const turn = parseRange(v.partner_turn);
  if (!review || !build || !turn) return undefined;
  return {
    mock_interview: parseRange(v.mock_interview) ?? { min: 0, max: 0 },
    partner_review: review,
    partner_build: build,
    partner_turn: turn,
    deepMultiplier: num(v.deepMultiplier) ?? 1,
  };
}

/** The estimate of one intent; Deep multiplies it. */
export function estimateFor(estimates: Estimates, intent: Intent, deep: boolean): Range {
  const base = intent === 'review' ? estimates.partner_review : intent === 'build' ? estimates.partner_build : estimates.partner_turn;
  const k = deep ? estimates.deepMultiplier : 1;
  return { min: base.min * k, max: base.max * k };
}

/** Credits for people: whole numbers from 10 up, one decimal under, two under 1. */
export function formatCredits(n: number): string {
  const places = Math.abs(n) >= 10 ? 0 : Math.abs(n) >= 1 ? 1 : 2;
  return Number(n.toFixed(places)).toLocaleString('en-US');
}

/** "about 5–15 credits". */
export function formatRange({ min, max }: Range): string {
  const lo = formatCredits(Math.max(0, Math.floor(min * 10) / 10));
  const hi = formatCredits(Math.ceil(max));
  return lo === hi ? `about ${hi} credits` : `about ${lo}–${hi} credits`;
}
