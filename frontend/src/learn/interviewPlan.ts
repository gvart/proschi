import { percent } from './mastery';
import { MINUTES, nextSteps, type NextStepsInput } from './nextSteps';
import { daysBetween, isDay } from './review';

/**
 * The interview-date plan (feature `interview_plan`, Max;
 * docs/design/paid-plans.md P54): a day-by-day schedule from today to the
 * interview, built from the rule-based next steps (nextSteps.ts) and the
 * roadmap's order. Pure and deterministic like the rest of src/learn, so the
 * page builds it and the Worker's reminder (backend/src/reminders.ts) reads
 * the same phases.
 *
 * The days from the plan's `start` (the day the date was set) to the
 * interview split into phases, fixed for the plan (phaseSplit):
 *
 *   learn      the first half or so: due cards, then problems for the
 *              weakest skills (nextSteps' retry, practise and finish), then
 *              the roadmap's next unsolved problems, to the day's minutes;
 *   mock       about 30% (1 to MAX_MOCK days): a solo mock interview on an
 *              unsolved medium or hard problem, then cards and a problem if
 *              the minutes allow;
 *   review     about 20% (1 to MAX_REVIEW days): the due cards and two
 *              topics' cards, weakest first, a different pair each day;
 *   rest       the day before: a light recap, nothing new;
 *   interview  the day itself.
 *
 * Re-flow: only today is built from today's real state, and each later day
 * as if every problem planned before it were solved. Today's list is fixed
 * once made (`pinned`), so its ticks stay put. On a new day the problems of
 * the last day's list still unsolved (`carry`) come first, so falling behind
 * pushes the rest of the plan along rather than dropping it; the phases keep
 * their dates, so the mock interviews and the review still happen in time.
 */

export type PlanPhase = 'learn' | 'mock' | 'review' | 'rest' | 'interview';
export type PlanItemKind = 'problem' | 'cards' | 'topic' | 'interview' | 'recap';

export interface PlanItem {
  kind: PlanItemKind;
  /** Unique within a day, e.g. `problem:chat`. */
  key: string;
  title: string;
  reason: string;
  minutes: number;
  /** A problem id for problem and interview items. */
  problem?: string;
  /** A topic id for topic items. */
  topic?: string;
  /** For cards: how many are due, when known (today). */
  count?: number;
  /** Planned on an earlier day and still open. */
  carried?: boolean;
}

export interface PlanDay {
  /** `YYYY-MM-DD`, local. */
  day: string;
  phase: PlanPhase;
  items: PlanItem[];
}

export interface PlanSettings {
  /** The interview, `YYYY-MM-DD`. */
  date: string;
  /** Minutes a day. */
  minutes: number;
  /** When the date was set: the phases count from it. */
  start: string;
}

export interface PlanInput extends Pick<NextStepsInput, 'topics' | 'due' | 'problems' | 'solved' | 'attempted' | 'mistakes'> {
  today: string;
  settings: PlanSettings;
  /** Problem ids in the roadmap's order. */
  roadmap: readonly string[];
  /** Problems on the last day's list still unsolved: first today. */
  carry?: readonly string[];
  /** Today's list when it was made earlier today: kept as is. */
  pinned?: readonly PlanItem[];
}

export const DEFAULT_MINUTES = 45;
export const MIN_MINUTES = 15;
export const MAX_MINUTES = 240;
/** The furthest interview date, in days from today. */
export const MAX_DAYS = 180;
/** A solo mock interview's default length (practice/modes/session.ts DEFAULT_DURATION). */
export const MOCK_MINUTES = 45;
export const MAX_MOCK = 10;
export const MAX_REVIEW = 5;
/** Minutes for a topic's cards, and for the day before's recap. */
export const TOPIC_MINUTES = 10;
export const RECAP_MINUTES = 15;
/** At most this many carried problems lead a day. */
export const MAX_CARRY = 2;

/** `day` plus `n` days, `YYYY-MM-DD`. */
export function addDays(day: string, n: number): string {
  const d = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + n));
  return d.toISOString().slice(0, 10);
}

/** The settings read back from storage or a request; undefined when anything is off. */
export function readPlanSettings(raw: unknown): PlanSettings | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const { date, minutes, start } = raw as Record<string, unknown>;
  if (!isDay(date) || !isDay(start) || start > date) return undefined;
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES) return undefined;
  return { date, minutes, start };
}

/** Whether `date` can be picked on `today`: tomorrow to MAX_DAYS ahead. */
export const pickable = (date: string, today: string): boolean => isDay(date) && date > today && daysBetween(today, date) <= MAX_DAYS;

/** How many of `total` prep days (start to the day before the interview) each phase gets. */
export function phaseSplit(total: number): Record<Exclude<PlanPhase, 'interview'>, number> {
  if (total <= 0) return { learn: 0, mock: 0, review: 0, rest: 0 };
  if (total === 1) return { learn: 0, mock: 0, review: 0, rest: 1 };
  const prep = total - 1;
  const review = prep >= 2 ? Math.min(MAX_REVIEW, Math.max(1, Math.round(prep * 0.2))) : 0;
  const mock = prep >= 3 ? Math.min(MAX_MOCK, Math.max(1, Math.round(prep * 0.3))) : 0;
  return { learn: prep - review - mock, mock, review, rest: 1 };
}

/** The phase of `day`, or undefined after the interview. A start after `day` counts from `day`. */
export function phaseOf(settings: Pick<PlanSettings, 'date' | 'start'>, day: string): PlanPhase | undefined {
  if (day > settings.date) return undefined;
  if (day === settings.date) return 'interview';
  const start = settings.start <= day ? settings.start : day;
  const i = daysBetween(start, day);
  const s = phaseSplit(daysBetween(start, settings.date));
  if (i < s.learn) return 'learn';
  if (i < s.learn + s.mock) return 'mock';
  if (i < s.learn + s.mock + s.review) return 'review';
  return 'rest';
}

/** Days from `today` to the interview (0 on the day). */
export const daysLeft = (settings: Pick<PlanSettings, 'date'>, today: string): number => daysBetween(today, settings.date);

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The day by day plan from `today` to the interview; empty once it is past. */
export function buildPlan(input: PlanInput): PlanDay[] {
  const { today, settings } = input;
  if (!isDay(today) || today > settings.date) return [];
  const start = settings.start <= today ? settings.start : today;
  const byId = new Map(input.problems.map((p) => [p.id, p]));
  const solved = new Set(input.solved);
  /** Problems on a day before: done by then, as far as later days know. */
  const planned = new Set<string>();
  const interviewed = new Set<string>();
  const weakest = [...input.topics].map((t, i) => ({ t, i })).sort((a, b) => a.t.mastery - b.t.mastery || a.i - b.i).map(({ t }) => t);
  const open = (id: string) => byId.has(id) && !solved.has(id) && !planned.has(id);
  const problemItem = (id: string, reason: string, extra: Partial<PlanItem> = {}): PlanItem => {
    const p = byId.get(id)!;
    return { kind: 'problem', key: `problem:${id}`, problem: id, title: p.title, reason, minutes: MINUTES[p.difficulty], ...extra };
  };

  /** Problems for the weakest skills, then the roadmap's next ones, in order. */
  const learning = (): PlanItem[] => {
    const steps = nextSteps({
      ...input,
      solved: [...solved, ...planned],
      exclude: [...planned],
      omit: ['review', 'challenge'],
      limit: 6,
    }).filter((s) => s.problem && open(s.problem));
    const items = steps.map((s) => problemItem(s.problem!, s.reason, { title: s.title }));
    const seen = new Set(items.map((i) => i.problem));
    for (const id of input.roadmap) {
      if (items.length >= 6) break;
      if (open(id) && !seen.has(id)) items.push(problemItem(id, 'Next on the roadmap.', { title: `Try ${byId.get(id)!.title}` }));
    }
    return items;
  };

  const cardsToday = (): PlanItem | undefined => {
    const n = input.due.total;
    if (n <= 0) return undefined;
    return { kind: 'cards', key: 'cards:due', title: `Review ${plural(n, 'due card')}`, reason: 'They are due today; a review now keeps them from fading.', minutes: Math.max(2, Math.ceil(n * MINUTES.card)), count: n };
  };

  const carried = (day: string): PlanItem[] =>
    day !== today
      ? []
      : (input.carry ?? [])
          .filter(open)
          .slice(0, MAX_CARRY)
          .map((id) => problemItem(id, 'Carried over: still open from your last plan day.', { title: `Finish ${byId.get(id)!.title}`, carried: true }));

  /** Adds `candidates` in order while they fit the day's minutes; the first always goes in. */
  const fill = (items: PlanItem[], candidates: readonly (PlanItem | undefined)[]): PlanItem[] => {
    let used = items.reduce((n, i) => n + i.minutes, 0);
    for (const c of candidates) {
      if (!c || items.some((i) => i.key === c.key)) continue;
      if (items.length > 0 && used + c.minutes > settings.minutes) continue;
      items.push(c);
      used += c.minutes;
    }
    return items;
  };

  const mockProblem = (): string | undefined => {
    const fits = (id: string) => byId.get(id)!.difficulty !== 'easy' && !interviewed.has(id);
    for (const t of weakest) {
      const id = t.related.find((r) => open(r) && fits(r));
      if (id) return id;
    }
    return input.roadmap.find((id) => open(id) && fits(id)) ?? input.roadmap.find((id) => byId.has(id) && fits(id));
  };

  let reviewDay = 0;
  /** The due cards and two topics' cards, weakest first, the next pair each time. */
  const revision = (day: string): PlanItem[] => {
    const cards: PlanItem = cardsToday() ?? { kind: 'cards', key: 'cards:due', title: 'Review the cards due', reason: 'Keep what you learned fresh for the day.', minutes: TOPIC_MINUTES };
    const n = weakest.length;
    const pair = n ? [weakest[(reviewDay * 2) % n], weakest[(reviewDay * 2 + 1) % n]].filter((t, i, a) => a.indexOf(t) === i) : [];
    reviewDay++;
    const topics = pair.map(
      (t): PlanItem => ({ kind: 'topic', key: `topic:${t.id}`, topic: t.id, title: `Revise ${t.title}`, reason: `Go through the ${t.title} cards once more (${percent(t.mastery)}% mastered).`, minutes: TOPIC_MINUTES }),
    );
    return fill([], [day === today && input.due.total === 0 ? undefined : cards, ...topics]);
  };
  const days: PlanDay[] = [];
  for (let day = today; day <= settings.date; day = addDays(day, 1)) {
    const phase = phaseOf({ date: settings.date, start }, day)!;
    let items: PlanItem[];
    if (day === today && input.pinned) {
      items = [...input.pinned];
    } else if (phase === 'learn') {
      items = fill([], [...carried(day), day === today ? cardsToday() : undefined, ...learning()]);
      // Nothing left to learn: revise instead.
      if (!items.length) items = revision(day);
    } else if (phase === 'mock') {
      const id = mockProblem();
      const mock: PlanItem | undefined = id && {
        kind: 'interview',
        key: `interview:${id}`,
        problem: id,
        title: `Mock interview: ${byId.get(id)!.title}`,
        reason: 'A timed interview on your own: clarify, estimate, design and wrap up, as on the day.',
        minutes: MOCK_MINUTES,
      };
      if (id) interviewed.add(id);
      items = fill([], [mock, ...carried(day), day === today ? cardsToday() : undefined, ...learning().slice(0, 1)]);
    } else if (phase === 'review') {
      items = revision(day);
    } else if (phase === 'rest') {
      items = [{ kind: 'recap', key: 'recap', title: 'Light recap, then rest', reason: 'Skim your skill map and the designs you solved. Nothing new today; sleep well.', minutes: RECAP_MINUTES }];
    } else {
      items = [];
    }
    for (const i of items) if (i.kind === 'problem' && i.problem) planned.add(i.problem);
    days.push({ day, phase, items });
  }
  return days;
}

/** What was done today, to tick today's items off. */
export interface PlanActivity {
  solved: ReadonlySet<string>;
  /** Cards due now. */
  dueNow: number;
  /** Cards reviewed today. */
  reviewsToday: number;
  /** Topics with a card reviewed today. */
  topicsReviewed: ReadonlySet<string>;
  /** Mock interviews on your own finished today. */
  interviews: number;
  /** Items ticked by hand (the recap). */
  ticked: ReadonlySet<string>;
}

/** Whether `item` is done: its problem solved, its cards reviewed, an interview finished or (the recap) ticked by hand. */
export function itemDone(item: PlanItem, a: PlanActivity): boolean {
  switch (item.kind) {
    case 'problem':
      return !!item.problem && a.solved.has(item.problem);
    case 'cards':
      return a.dueNow === 0 || (item.count !== undefined && a.reviewsToday >= item.count);
    case 'topic':
      return !!item.topic && a.topicsReviewed.has(item.topic);
    case 'interview':
      return a.interviews > 0;
    case 'recap':
      return a.ticked.has(item.key);
  }
}

/** The problems of the last plan day's list (`last`, before `today`) still unsolved: today's `carry`. */
export function carryOver(last: { day: string; items: readonly PlanItem[] } | undefined, today: string, solved: ReadonlySet<string>): string[] {
  if (!last || last.day >= today) return [];
  return last.items.filter((i) => i.kind === 'problem' && i.problem && !solved.has(i.problem)).map((i) => i.problem!);
}
