import { PHASES, PHASE_SHARE, type Duration, type Phase } from '../../../frontend/src/practice/modes/session';
import { addUsage, emptyUsage, MAX_DESIGN_CHARS, MAX_MESSAGE_CHARS, MAX_TURNS, turnFits, VERDICT_RESERVE, WALL_CLOCK_MS, billedTokens, TOKEN_CAP, type SessionUsage } from './budget';
import { AiError, collect, HAIKU, SONNET, type ClaudeClient, type MessageParam, type MessageRequest, type TextBlock } from './client';
import { approxTokens, gradeDesign, type DesignGrade, type ProblemContext } from './context';
import { fence, HINT_PROMPT, INTERVIEWER_PROMPT, VERDICT_PROMPT } from './prompts';

/**
 * The AI interviewer as a state machine over a JSON-serialisable state, so
 * the route can keep it in D1 between requests. The clock is always passed
 * in (`now`, epoch milliseconds) and the model is an injected client: the
 * tests drive both.
 *
 *   start   → the opening message (no model call) and the first state
 *   turn    → Sonnet's reply (streamed through `onText`), the new state and a
 *             coaching hint from Haiku
 *   verdict → pass or fail with scores per skill, as validated JSON
 *
 * The phases follow interview mode's (frontend/src/practice/modes/session.ts)
 * with the same shares of the chosen duration, 10/10/70/10: the clock moves
 * the session on, and the candidate can move on earlier. The history is
 * append-only, each candidate turn rendered once and kept, so every request
 * of a session shares the cached prefix of the one before.
 */

export const SKILLS = ['requirements', 'estimation', 'design', 'tradeoffs', 'communication'] as const;
export type Skill = (typeof SKILLS)[number];
export type HintKind = 'focus' | 'improve' | 'wrapup';

export interface Hint {
  kind: HintKind;
  text: string;
}

export interface Entry {
  role: 'interviewer' | 'candidate';
  /** The interviewer's words, or the candidate's turn as sent to the model (fenced, with its phase and time). */
  text: string;
  /** The candidate's own words, for the transcript. */
  said?: string;
  phase: Phase;
  /** Milliseconds since the start. */
  at: number;
}

export interface InterviewState {
  version: 1;
  problemId: string;
  durationMin: Duration;
  /** Epoch milliseconds. */
  startedAt: number;
  phase: Phase;
  /** When each phase started, in milliseconds since the start. */
  phaseStarts: Partial<Record<Phase, number>>;
  transcript: Entry[];
  /** Topic ids (ProblemContext.topics) the candidate has covered. */
  covered: string[];
  turns: number;
  usage: SessionUsage;
  /** The last design sent and the server's run of it. */
  design?: { source: string; grade: DesignGrade };
  /** Set by verdict(). */
  finished?: true;
}

export type LimitReason = 'time' | 'budget' | 'turns' | 'finished' | 'message' | 'design' | 'problem';

/** A turn or verdict that the session's limits or its input refuse; nothing was sent to the model. */
export class InterviewLimitError extends Error {
  readonly reason: LimitReason;
  constructor(reason: LimitReason, message: string) {
    super(message);
    this.name = 'InterviewLimitError';
    this.reason = reason;
  }
}

export interface Deps {
  client: ClaudeClient;
  context: ProblemContext;
  /** Epoch milliseconds. */
  now: number;
}

const REPLY_MAX_TOKENS = 1_024;
const HINT_MAX_TOKENS = 400;
const VERDICT_MAX_TOKENS = 16_000;
/** Entries of the transcript the hint sees. */
const HINT_WINDOW = 6;

const minutes = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`;
const phaseIndex = (p: Phase) => PHASES.findIndex((x) => x.id === p);

/** When each phase ends by the clock, in milliseconds since the start. */
export function phaseEnds(durationMin: Duration): Record<Phase, number> {
  let at = 0;
  const ends = {} as Record<Phase, number>;
  for (const p of PHASES) ends[p.id] = at += PHASE_SHARE[p.id] * durationMin * 60_000;
  return ends;
}

/** The phase the clock is in; past the chosen duration it stays in the wrap-up. */
export function clockPhase(durationMin: Duration, elapsedMs: number): Phase {
  const ends = phaseEnds(durationMin);
  return PHASES.find((p) => elapsedMs < ends[p.id])?.id ?? 'wrapup';
}

/** The session's phase at `elapsedMs`: the clock's, or a later one the candidate moved on to. */
export function currentPhase(state: InterviewState, elapsedMs: number): Phase {
  const byClock = clockPhase(state.durationMin, elapsedMs);
  return phaseIndex(byClock) > phaseIndex(state.phase) ? byClock : state.phase;
}

function systemBlocks(prompt: string, context: ProblemContext): TextBlock[] {
  // The context is the large, stable part: cached for an hour, since a design phase can go quiet for longer than 5 minutes.
  return [
    { type: 'text', text: prompt },
    { type: 'text', text: context.text, cache_control: { type: 'ephemeral', ttl: '1h' } },
  ];
}

const SESSION_OPENING = (durationMin: Duration) =>
  `<session_start duration_minutes="${durationMin}">The candidate opened the interview. The next message is your greeting; the interview starts in the clarify phase.</session_start>`;

/** The interviewer's first message and the first state. No model call: the greeting is the same every time. */
export function start(context: ProblemContext, durationMin: Duration, now: number): { state: InterviewState; opening: string } {
  const p = context.problem;
  const share = (phase: Phase) => Math.round(PHASE_SHARE[phase] * durationMin);
  const opening =
    `Hi, I'll be your interviewer. Today we'll design ${p.title}: ${p.summary.replace(/\.$/, '')}. ` +
    `We have ${durationMin} minutes: about ${share('clarify')} to clarify the requirements, ${share('estimate')} to estimate, ${share('design')} to design and ${share('wrapup')} to wrap up. ` +
    `The statement leaves out the scale and the constraints, so start by asking me what you need to know.`;
  const state: InterviewState = {
    version: 1,
    problemId: p.id,
    durationMin,
    startedAt: now,
    phase: 'clarify',
    phaseStarts: { clarify: 0 },
    transcript: [{ role: 'interviewer', text: opening, phase: 'clarify', at: 0 }],
    covered: [],
    turns: 0,
    usage: emptyUsage(),
  };
  return { state, opening };
}

function testResultsText(grade: DesignGrade): string {
  const lines = [grade.blocked === 'errors' ? `The design has errors, so no test ran:\n${grade.errors.join('\n')}` : `${grade.passed} of ${grade.total} tests pass${grade.solved ? ' (solved)' : ''}.`];
  for (const r of grade.results) lines.push(`- ${r.passed ? 'PASS' : 'FAIL'} ${r.name} (${r.category}): ${r.message}`);
  return lines.join('\n');
}

/** The candidate's turn as the model sees it. Rendered once and stored, so the history never changes. */
function renderTurn(state: InterviewState, phase: Phase, elapsed: number, message: string, design?: { source: string; grade: DesignGrade }): string {
  const ends = phaseEnds(state.durationMin);
  const attrs = `phase="${phase}" elapsed="${minutes(elapsed)}" phase_left="${minutes(Math.max(0, ends[phase] - elapsed))}" total_left="${minutes(Math.max(0, state.durationMin * 60_000 - elapsed))}"`;
  const parts = [
    ...(phase !== state.phase ? [`The phase changed from ${state.phase} to ${phase}.`] : []),
    fence('candidate_message', message),
    ...(design ? [fence('candidate_design', design.source), fence('test_results', testResultsText(design.grade))] : []),
  ];
  return `<turn ${attrs}>\n${parts.join('\n')}\n</turn>`;
}

/** The conversation for Sonnet: a fixed first user message, then the transcript, with the cache breakpoint on the newest turn. */
function conversation(state: InterviewState, durationMin: Duration): MessageParam[] {
  const messages: MessageParam[] = [{ role: 'user', content: SESSION_OPENING(durationMin) }];
  for (const e of state.transcript) messages.push({ role: e.role === 'interviewer' ? 'assistant' : 'user', content: e.text });
  const last = messages[messages.length - 1];
  messages[messages.length - 1] = { role: last.role, content: [{ type: 'text', text: last.content as string, cache_control: { type: 'ephemeral' } }] };
  return messages;
}

export interface TurnInput {
  message: string;
  /** The design's source as the candidate has it now; the server grades it (P6). */
  design?: string;
  /** The candidate moves on to the next phase before the clock does. */
  advance?: boolean;
  /** Receives the reply as it streams. */
  onText?: (text: string) => void;
}

export interface TurnResult {
  reply: string;
  state: InterviewState;
  /** Absent when the coaching call failed; the turn stands without it. */
  hint?: Hint;
  /** The server's run of the design sent with this turn. */
  grade?: DesignGrade;
  elapsedMs: number;
}

/** Refuses a turn the limits do not allow; returns the elapsed time. */
function checkLimits(state: InterviewState, now: number, input: TurnInput): number {
  const elapsed = now - state.startedAt;
  if (state.finished) throw new InterviewLimitError('finished', 'The interview is over');
  if (elapsed >= WALL_CLOCK_MS) throw new InterviewLimitError('time', 'The interview has reached its 60 minutes');
  if (state.turns >= MAX_TURNS) throw new InterviewLimitError('turns', `At most ${MAX_TURNS} turns`);
  if (!input.message.trim() && input.design === undefined) throw new InterviewLimitError('message', 'Say something or send the design');
  if (input.message.length > MAX_MESSAGE_CHARS) throw new InterviewLimitError('message', `A message is at most ${MAX_MESSAGE_CHARS} characters`);
  if (input.design !== undefined && input.design.length > MAX_DESIGN_CHARS) throw new InterviewLimitError('design', `A design is at most ${MAX_DESIGN_CHARS / 1024} KiB`);
  return elapsed;
}

export async function turn(deps: Deps, state: InterviewState, input: TurnInput): Promise<TurnResult> {
  const { client, context, now } = deps;
  if (context.problem.id !== state.problemId) throw new InterviewLimitError('problem', 'The context is of another problem');
  const elapsed = checkLimits(state, now, input);

  let phase = currentPhase(state, elapsed);
  if (input.advance && phase !== 'wrapup') phase = PHASES[phaseIndex(phase) + 1].id;
  const design = input.design !== undefined ? { source: input.design, grade: gradeDesign(context.problem, input.design) } : undefined;
  const rendered = renderTurn(state, phase, elapsed, input.message, design);

  // Sonnet sees the new turn and the reply; Haiku sees them again in its window.
  const estimate = 2 * approxTokens(rendered) + REPLY_MAX_TOKENS + HINT_MAX_TOKENS + 2_000;
  if (!turnFits(state.usage, estimate)) throw new InterviewLimitError('budget', 'The interview has used its token budget; ask for the verdict');

  let next: InterviewState = {
    ...state,
    phase,
    phaseStarts: state.phaseStarts[phase] === undefined ? { ...state.phaseStarts, [phase]: elapsed } : state.phaseStarts,
    transcript: [...state.transcript, { role: 'candidate', text: rendered, said: input.message, phase, at: elapsed }],
    turns: state.turns + 1,
    ...(design ? { design } : {}),
  };

  const request: MessageRequest = {
    model: SONNET,
    max_tokens: REPLY_MAX_TOKENS,
    system: systemBlocks(INTERVIEWER_PROMPT, context),
    messages: conversation(next, state.durationMin),
    // A conversational turn needs no extended thinking; it keeps replies quick and the history free of thinking blocks.
    thinking: { type: 'between_tools' },
    output_config: { effort: 'medium' },
  };
  const result = await collect(client.stream(request), input.onText);
  const reply = result.text.trim();
  next = {
    ...next,
    usage: addUsage(next.usage, SONNET, result.usage),
    transcript: [...next.transcript, { role: 'interviewer', text: reply, phase, at: elapsed }],
  };

  let hint: Hint | undefined;
  try {
    const coached = await coach(client, context, next, elapsed);
    next = { ...next, usage: addUsage(next.usage, HAIKU, coached.usage), covered: [...new Set([...next.covered, ...coached.covered])] };
    hint = coached.hint;
  } catch (e) {
    // The hint is a nicety: the turn stands without it, but its tokens still count.
    if (!(e instanceof AiError)) throw e;
    next = { ...next, usage: addUsage(next.usage, HAIKU, e.usage) };
  }
  return { reply, state: next, ...(hint ? { hint } : {}), ...(design ? { grade: design.grade } : {}), elapsedMs: elapsed };
}

/** The hint kind the clock asks for: wrap-up in the last quarter of a phase (at least the last minute), else the model picks. */
export function forcedHintKind(state: InterviewState, elapsed: number): HintKind | undefined {
  const ends = phaseEnds(state.durationMin);
  const end = ends[state.phase];
  const length = PHASE_SHARE[state.phase] * state.durationMin * 60_000;
  return end - elapsed <= Math.max(60_000, length / 4) ? 'wrapup' : undefined;
}

const HINT_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['focus', 'improve', 'wrapup'] },
    text: { type: 'string' },
    covered: { type: 'array', items: { type: 'string' } },
  },
  required: ['kind', 'text', 'covered'],
  additionalProperties: false,
} as const;

async function coach(client: ClaudeClient, context: ProblemContext, state: InterviewState, elapsed: number) {
  const forced = forcedHintKind(state, elapsed);
  const open = context.topics.filter((t) => !state.covered.includes(t.id));
  const recent = state.transcript.slice(-HINT_WINDOW).map((e) => (e.role === 'interviewer' ? `Interviewer: ${e.text}` : `Candidate: ${e.said ?? ''}`));
  const user = [
    `Phase: ${state.phase}. Time left in the phase: ${minutes(Math.max(0, phaseEnds(state.durationMin)[state.phase] - elapsed))}.`,
    `Hint kind: ${forced ?? 'focus or improve, whichever helps more now'}.`,
    `Topics not covered yet:\n${open.map((t) => `- [${t.id}] (${t.kind}) ${t.label}`).join('\n') || '- none'}`,
    ...(state.design ? [fence('test_results', testResultsText(state.design.grade))] : []),
    fence('transcript', recent.join('\n\n')),
  ].join('\n\n');
  const result = await client.create({
    model: HAIKU,
    max_tokens: HINT_MAX_TOKENS,
    system: systemBlocks(HINT_PROMPT, context),
    messages: [{ role: 'user', content: user }],
    thinking: { type: 'disabled' },
    output_config: { effort: 'low', format: { type: 'json_schema', schema: HINT_SCHEMA } },
  });
  const parsed = parseHint(result.text, new Set(context.topics.map((t) => t.id)));
  if (!parsed) throw new AiError('malformed', 'The hint is not valid JSON', { usage: result.usage });
  // Only the clock asks for a wrap-up hint; one the model picks on its own is a focus hint.
  const kind = forced ?? (parsed.kind === 'wrapup' ? 'focus' : parsed.kind);
  return { hint: { kind, text: parsed.text }, covered: parsed.covered, usage: result.usage };
}

/** Haiku's JSON, checked; topic ids it made up are dropped. */
export function parseHint(text: string, topicIds: ReadonlySet<string>): (Hint & { covered: string[] }) | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  const h = raw as { kind?: unknown; text?: unknown; covered?: unknown };
  if (!h || typeof h !== 'object' || !['focus', 'improve', 'wrapup'].includes(h.kind as string) || typeof h.text !== 'string' || !h.text.trim() || !Array.isArray(h.covered)) return undefined;
  return { kind: h.kind as HintKind, text: h.text.trim().slice(0, 300), covered: h.covered.filter((id): id is string => typeof id === 'string' && topicIds.has(id)) };
}

export interface SkillNote {
  skill: Skill;
  text: string;
}

export interface InterviewVerdict {
  passed: boolean;
  scores: Record<Skill, number>;
  wentWell: SkillNote[];
  wentWrong: SkillNote[];
  nextSteps: string[];
}

const NOTE_SCHEMA = {
  type: 'array',
  items: { type: 'object', properties: { skill: { type: 'string', enum: [...SKILLS] }, text: { type: 'string' } }, required: ['skill', 'text'], additionalProperties: false },
};

export const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    passed: { type: 'boolean' },
    scores: { type: 'object', properties: Object.fromEntries(SKILLS.map((s) => [s, { type: 'integer' }])), required: [...SKILLS], additionalProperties: false },
    wentWell: NOTE_SCHEMA,
    wentWrong: NOTE_SCHEMA,
    nextSteps: { type: 'array', items: { type: 'string' } },
  },
  required: ['passed', 'scores', 'wentWell', 'wentWrong', 'nextSteps'],
  additionalProperties: false,
};

const MAX_NOTES = 8;
const MAX_NOTE_CHARS = 600;

/** The verdict JSON, checked against what the schema cannot say (score range, sizes); undefined when it does not hold. */
export function parseVerdict(text: string): InterviewVerdict | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  const v = raw as Partial<Record<keyof InterviewVerdict, unknown>>;
  if (!v || typeof v !== 'object' || typeof v.passed !== 'boolean' || !v.scores || typeof v.scores !== 'object') return undefined;
  const scores = {} as Record<Skill, number>;
  for (const s of SKILLS) {
    const n = (v.scores as Record<string, unknown>)[s];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 5) return undefined;
    scores[s] = n;
  }
  const notes = (x: unknown): SkillNote[] | undefined => {
    if (!Array.isArray(x) || x.length > MAX_NOTES) return undefined;
    const out: SkillNote[] = [];
    for (const n of x as { skill?: unknown; text?: unknown }[]) {
      if (!n || !SKILLS.includes(n.skill as Skill) || typeof n.text !== 'string' || !n.text.trim()) return undefined;
      out.push({ skill: n.skill as Skill, text: n.text.trim().slice(0, MAX_NOTE_CHARS) });
    }
    return out;
  };
  const wentWell = notes(v.wentWell);
  const wentWrong = notes(v.wentWrong);
  const steps = v.nextSteps;
  if (!wentWell || !wentWrong || !Array.isArray(steps) || steps.length > 5 || !steps.every((s) => typeof s === 'string' && s.trim())) return undefined;
  return { passed: v.passed, scores, wentWell, wentWrong, nextSteps: (steps as string[]).map((s) => s.trim().slice(0, MAX_NOTE_CHARS)) };
}

/** The whole session for the verdict, as one block of data. */
function sessionReport(context: ProblemContext, state: InterviewState, now: number): string {
  const elapsed = Math.min(now - state.startedAt, WALL_CLOCK_MS);
  const starts = PHASES.map((p) => state.phaseStarts[p.id]);
  const phaseTimes = PHASES.map((p, i) => {
    const s = starts[i];
    if (s === undefined) return `${p.id} not reached`;
    const end = starts.slice(i + 1).find((x) => x !== undefined) ?? elapsed;
    return `${p.id} ${minutes(end - s)}`;
  });
  const covered = context.topics.filter((t) => state.covered.includes(t.id));
  const missed = context.topics.filter((t) => !state.covered.includes(t.id));
  const transcript = state.transcript.map((e) => `[${e.phase} ${minutes(e.at)}] ${e.role === 'interviewer' ? 'Interviewer' : 'Candidate'}: ${e.role === 'interviewer' ? e.text : e.said ?? ''}`);
  return [
    `Session: ${state.durationMin} minutes planned, ${minutes(elapsed)} used, ${state.turns} candidate turns. Time per phase: ${phaseTimes.join(', ')}.`,
    `Topics covered:\n${covered.map((t) => `- [${t.id}] ${t.label}`).join('\n') || '- none'}`,
    `Topics not covered:\n${missed.map((t) => `- [${t.id}] ${t.label}`).join('\n') || '- none'}`,
    state.design ? `${fence('candidate_design', state.design.source)}\n${fence('test_results', testResultsText(state.design.grade))}` : 'The candidate never sent a design.',
    fence('transcript', transcript.join('\n\n')),
    'Write the verdict.',
  ].join('\n\n');
}

/**
 * The verdict, Sonnet with adaptive thinking and a JSON schema. A response
 * that does not validate is asked for once more, then is an AiError
 * ('malformed'). Returns the state, finished and with the tokens counted.
 */
export async function verdict(deps: Deps, state: InterviewState): Promise<{ verdict: InterviewVerdict; state: InterviewState }> {
  const { client, context, now } = deps;
  if (context.problem.id !== state.problemId) throw new InterviewLimitError('problem', 'The context is of another problem');
  if (state.finished) throw new InterviewLimitError('finished', 'The interview is over');
  // The reserve is kept for this call; past the cap entirely (it cannot happen through turn()), refuse.
  if (billedTokens(state.usage) > TOKEN_CAP - VERDICT_RESERVE / 4) throw new InterviewLimitError('budget', 'The interview has used its token budget');
  const request: MessageRequest = {
    model: SONNET,
    max_tokens: VERDICT_MAX_TOKENS,
    system: systemBlocks(VERDICT_PROMPT, context),
    messages: [{ role: 'user', content: sessionReport(context, state, now) }],
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: { type: 'json_schema', schema: VERDICT_SCHEMA } },
  };
  let spent = emptyUsage();
  for (let attempt = 0; ; attempt++) {
    const result = await client.create(request);
    spent = addUsage(spent, SONNET, result.usage);
    const parsed = parseVerdict(result.text);
    if (parsed) return { verdict: parsed, state: { ...state, usage: addUsage(state.usage, SONNET, spent[SONNET]), finished: true } };
    if (attempt >= 1) throw new AiError('malformed', 'The verdict did not validate twice', { usage: spent[SONNET] });
  }
}
