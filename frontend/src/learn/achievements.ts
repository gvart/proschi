import type { Card } from './cards';
import { CARD_ID } from './cards';
import { isNew, reviewable, type CardStates } from './review';
import { computeStreak, type DailyGoal, type Day, type DayActivity } from './streak';
import type { Rating } from './fsrs';
import { percent, skills, type MasteryInput, type ProblemInfo, type Skills } from './mastery';
import type { ChallengeStats } from './challenge';

/**
 * Achievements: badges for milestones in review and practice, defined as data
 * in frontend/src/practice/achievements.json and checked in CI
 * (checkAchievements below, `proschi achievements check`). Each has a `rule`,
 * a small declarative predicate over a stats snapshot (StatsSnapshot) of the
 * learner, so the Worker, the practice page in a build without accounts and a
 * future mobile app all decide the same way who earned what.
 *
 * Pure TypeScript with no browser or React dependency, like the rest of
 * src/learn.
 */

export const TIERS = ['bronze', 'silver', 'gold'] as const;
export type Tier = (typeof TIERS)[number];

/** The icons a badge can show, by name; the page maps each to a lucide icon, an app to its own. */
export const ICONS = ['layers', 'brain', 'flame', 'trophy', 'check', 'zap', 'coins', 'calculator', 'target', 'map', 'database', 'radio', 'shield', 'star'] as const;
export type Icon = (typeof ICONS)[number];

type Difficulty = ProblemInfo['difficulty'];

/**
 * When a badge is earned. Counts (`min`) are whole numbers from 1;
 * `mastery`'s `min` is a share from 0 to 1.
 */
export type Rule =
  /** Card reviews made, in all. */
  | { kind: 'reviews'; min: number }
  /** Cards mastered: reviewed at their current version with a stability of MASTERED_DAYS or more. */
  | { kind: 'mastered'; min: number }
  /** The longest daily streak (streak.ts): days in a row meeting the daily goal, freezes covering missed days. */
  | { kind: 'streak'; min: number }
  /** Problems solved, optionally only those of one difficulty or with one tag. */
  | { kind: 'solved'; min: number; difficulty?: Difficulty; tag?: string }
  /** Every problem with the tag solved. */
  | { kind: 'all-solved'; tag: string }
  /** Problems solved on the first test run. */
  | { kind: 'first-run'; min: number }
  /** Problems solved with a design cheaper a month than the reference solution. */
  | { kind: 'under-reference'; min: number }
  /** Estimate cards answered right in a row, at best. */
  | { kind: 'estimate-streak'; min: number }
  /** A topic's mastery (mastery.ts) at `min` or more. */
  | { kind: 'mastery'; topic: string; min: number }
  /** Every problem of a roadmap stage solved. */
  | { kind: 'stage'; stage: string }
  /** Daily challenges completed (challenge.ts). */
  | { kind: 'challenges'; min: number }
  /** Daily challenges with every card right. */
  | { kind: 'challenge-perfect'; min: number }
  /** The longest challenge streak: UTC days in a row with a completed daily challenge. */
  | { kind: 'challenge-streak'; min: number };

export type RuleKind = Rule['kind'];

/** Each rule kind's fields besides `kind`: required ones, then optional ones. */
const RULE_FIELDS: Record<RuleKind, { required: string[]; optional: string[] }> = {
  reviews: { required: ['min'], optional: [] },
  mastered: { required: ['min'], optional: [] },
  streak: { required: ['min'], optional: [] },
  solved: { required: ['min'], optional: ['difficulty', 'tag'] },
  'all-solved': { required: ['tag'], optional: [] },
  'first-run': { required: ['min'], optional: [] },
  'under-reference': { required: ['min'], optional: [] },
  'estimate-streak': { required: ['min'], optional: [] },
  mastery: { required: ['topic', 'min'], optional: [] },
  stage: { required: ['stage'], optional: [] },
  challenges: { required: ['min'], optional: [] },
  'challenge-perfect': { required: ['min'], optional: [] },
  'challenge-streak': { required: ['min'], optional: [] },
};
export const RULE_KINDS = Object.keys(RULE_FIELDS) as RuleKind[];

export interface Achievement {
  /** Lowercase words joined by "-", unique; earned badges are stored by it, so it never changes. */
  id: string;
  /** A few words, e.g. "Hundred club". */
  title: string;
  /** One sentence: what earns it. */
  description: string;
  icon: Icon;
  tier?: Tier;
  rule: Rule;
}

/** A card counts as mastered from this stability (days until recall falls to 90%). */
export const MASTERED_DAYS = 21;
/** What a problem solve adds to the snapshot. */
export interface SolvedProblem {
  id: string;
  /** Solved on the first test run. */
  firstRun: boolean;
  /** The cheapest solving design costs less a month than the problem's reference solution. */
  underReference: boolean;
}

/**
 * Everything the rules look at, about one learner. The Worker builds it from
 * the database, the page in a build without accounts from the browser's
 * storage (buildSnapshot).
 */
export interface StatsSnapshot {
  reviews: number;
  mastered: number;
  /** Days: the longest daily streak, from streak.ts's computeStreak (longestStreak below). */
  longestStreak: number;
  estimateStreak: number;
  solved: SolvedProblem[];
  /** Each topic's mastery, by topic id. */
  mastery: Record<string, number>;
  /** The daily challenge: completed, perfect, and the longest challenge streak. */
  challenges: ChallengeStats;
}

/** What rules about problems and stages need: the catalog. */
export interface AchievementContext {
  problems: readonly ProblemInfo[];
  stages: readonly { id: string; problems: readonly string[] }[];
}

/** How far a learner is towards a badge: earned once `current` reaches `target`. */
export interface RuleProgress {
  current: number;
  target: number;
}

/** A rule's progress for a snapshot; mastery is counted in whole percent. An unknown kind is never earned. */
export function ruleProgress(rule: Rule, s: StatsSnapshot, context: AchievementContext): RuleProgress {
  const count = (current: number, target: number) => ({ current: Math.min(current, target), target });
  const solved = new Set(s.solved.map((p) => p.id));
  switch (rule.kind) {
    case 'reviews':
      return count(s.reviews, rule.min);
    case 'mastered':
      return count(s.mastered, rule.min);
    case 'streak':
      return count(s.longestStreak, rule.min);
    case 'solved': {
      const matching = context.problems.filter((p) => solved.has(p.id) && (!rule.difficulty || p.difficulty === rule.difficulty) && (!rule.tag || p.tags.includes(rule.tag)));
      return count(matching.length, rule.min);
    }
    case 'all-solved': {
      const tagged = context.problems.filter((p) => p.tags.includes(rule.tag));
      return { current: tagged.filter((p) => solved.has(p.id)).length, target: Math.max(1, tagged.length) };
    }
    case 'first-run':
      return count(s.solved.filter((p) => p.firstRun).length, rule.min);
    case 'under-reference':
      return count(s.solved.filter((p) => p.underReference).length, rule.min);
    case 'estimate-streak':
      return count(s.estimateStreak, rule.min);
    case 'mastery':
      return count(percent(s.mastery[rule.topic] ?? 0), percent(rule.min));
    case 'challenges':
      return count(s.challenges.completed, rule.min);
    case 'challenge-perfect':
      return count(s.challenges.perfect, rule.min);
    case 'challenge-streak':
      return count(s.challenges.longestStreak, rule.min);
    case 'stage': {
      const known = new Set(context.problems.map((p) => p.id));
      const ids = context.stages.find((st) => st.id === rule.stage)?.problems.filter((id) => known.has(id)) ?? [];
      return { current: ids.filter((id) => solved.has(id)).length, target: Math.max(1, ids.length) };
    }
    default:
      return { current: 0, target: 1 };
  }
}

/** One badge for a learner, as GET /api/me/achievements answers it. */
export interface AchievementStatus extends Achievement, RuleProgress {
  earned: boolean;
  /** Unix seconds; when earned. */
  earnedAt?: number;
  /** Earned and not yet shown: the page celebrates it, then marks it seen. */
  unseen: boolean;
}

/** A badge already earned, as stored: the server's achievements table, or the browser's. */
export interface EarnedRecord {
  earnedAt: number;
  seenAt?: number;
}

/**
 * Every badge's progress, with what was earned before and what the snapshot
 * earns now. `newly` lists the ids earned now, for the caller to store with
 * `now` as their time. A badge once earned stays earned, even when the
 * snapshot falls back below it (mastery decays).
 */
export function achievementStatuses(
  achievements: readonly Achievement[],
  snapshot: StatsSnapshot,
  context: AchievementContext,
  earned: Readonly<Record<string, EarnedRecord>>,
  now: number,
): { statuses: AchievementStatus[]; newly: string[] } {
  const newly: string[] = [];
  const statuses = achievements.map((a): AchievementStatus => {
    const progress = ruleProgress(a.rule, snapshot, context);
    const record = Object.prototype.hasOwnProperty.call(earned, a.id) ? earned[a.id] : undefined;
    if (record) return { ...a, current: progress.target, target: progress.target, earned: true, earnedAt: record.earnedAt, unseen: record.seenAt === undefined };
    if (progress.current >= progress.target) {
      newly.push(a.id);
      return { ...a, ...progress, earned: true, earnedAt: now, unseen: true };
    }
    return { ...a, ...progress, earned: false, unseen: false };
  });
  return { statuses, newly };
}

/**
 * The longest daily streak as of `today`: streak.ts's computeStreak over each
 * day's activity, so a day counts when it meets the user's daily goal (cards
 * reviewed, or a problem solved) and a freeze carries a streak over a missed
 * day, as the streak widget shows it.
 */
export function longestStreak(activity: readonly DayActivity[], today: Day, goal: DailyGoal): number {
  return computeStreak([...activity], today, goal).longest;
}

/** The longest run of right answers (rated above 1) in ratings given oldest first. */
export function longestRightRun(ratings: readonly Rating[]): number {
  let best = 0;
  let run = 0;
  for (const r of ratings) {
    run = r > 1 ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/** Cards mastered: not retired, reviewed at their current version, with a stability of MASTERED_DAYS or more. */
export function masteredCount(cards: readonly Card[], states: CardStates): number {
  return reviewable(cards).filter((c) => !isNew(c, states[c.id]) && states[c.id].stability >= MASTERED_DAYS).length;
}

export interface SnapshotInput extends Omit<MasteryInput, 'solved'> {
  /** Card reviews made, in all. */
  reviews: number;
  longestStreak: number;
  solvedProblems: readonly SolvedProblem[];
  /** The daily challenge's stats; none when absent. */
  challenges?: ChallengeStats;
}

const NO_CHALLENGES: ChallengeStats = { completed: 0, perfect: 0, longestStreak: 0 };

/** The snapshot, and the skill map computed on the way. */
export function buildSnapshot(input: SnapshotInput): { snapshot: StatsSnapshot; skills: Skills } {
  const map = skills({ ...input, solved: input.solvedProblems.map((p) => p.id) });
  return {
    snapshot: {
      reviews: input.reviews,
      mastered: masteredCount(input.cards, input.states),
      longestStreak: input.longestStreak,
      estimateStreak: longestRightRun(input.estimateRatings),
      solved: [...input.solvedProblems],
      mastery: Object.fromEntries(map.topics.map((t) => [t.topic, t.mastery])),
      challenges: input.challenges ?? NO_CHALLENGES,
    },
    skills: map,
  };
}

/** GET /api/me/achievements's answer; a build without accounts builds the same locally. */
export interface AchievementsAnswer {
  achievements: AchievementStatus[];
  skills: { readiness: number; topics: { topic: string; mastery: number }[]; weakest: string[] };
  stats: { reviews: number; mastered: number; longestStreak: number; estimateStreak: number; solved: number };
}

/** The answer from the statuses, the skill map and the snapshot. */
export function achievementsAnswer(statuses: AchievementStatus[], map: Skills, snapshot: StatsSnapshot): AchievementsAnswer {
  return {
    achievements: statuses,
    skills: { readiness: map.readiness, topics: map.topics.map((t) => ({ topic: t.topic, mastery: t.mastery })), weakest: map.weakest },
    stats: {
      reviews: snapshot.reviews,
      mastered: snapshot.mastered,
      longestStreak: snapshot.longestStreak,
      estimateStreak: snapshot.estimateStreak,
      solved: snapshot.solved.length,
    },
  };
}

// --- The check -------------------------------------------------------------

/** What is wrong with an achievements file; `index` is the entry's position (from 0), `id` its id when it has one. */
export interface AchievementViolation {
  index?: number;
  id?: string;
  message: string;
}

/** What the references in rules are checked against. */
export interface AchievementCheckContext {
  /** The practice problems: their tags exist, and a count of solves must be reachable. */
  problems: readonly ProblemInfo[];
  /** Card topics (tags.json). */
  topics: readonly string[];
  /** Roadmap stage ids. */
  stages: readonly string[];
}

/** Lengths that keep a badge readable on a phone. */
export const ACHIEVEMENT_LIMITS = { title: 32, description: 120 } as const;

const FIELDS = ['id', 'title', 'description', 'icon', 'tier', 'rule'];
const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

/**
 * Checks an achievements file's parsed JSON: a list of `{id, title,
 * description, icon, tier?, rule}` with unique ids, known icons, tiers and
 * rule kinds, each rule with exactly its fields, tags, topics and stages
 * that exist, counts of solves there are enough problems for, and no two
 * badges with the same rule. Answers the achievements that read well and every violation.
 */
export function checkAchievements(raw: unknown, context: AchievementCheckContext): { achievements: Achievement[]; violations: AchievementViolation[] } {
  const violations: AchievementViolation[] = [];
  if (!Array.isArray(raw)) return { achievements: [], violations: [{ message: 'Must be a JSON list of {"id", "title", "description", "icon", "tier"?, "rule"}' }] };
  const ids = new Set<string>();
  const rules = new Map<string, string>();
  const achievements: Achievement[] = [];
  raw.forEach((item: unknown, index) => {
    const a = item as Record<string, unknown> | null;
    const id = a && typeof a === 'object' && typeof a.id === 'string' ? a.id : undefined;
    const before = violations.length;
    const fail = (message: string) => violations.push({ index, ...(id !== undefined ? { id } : {}), message });
    if (!a || typeof a !== 'object' || Array.isArray(a)) {
      fail('Must be an object {"id", "title", "description", "icon", "tier"?, "rule"}');
      return;
    }
    for (const key of Object.keys(a)) if (!FIELDS.includes(key)) fail(`Unknown field "${key}" (use ${FIELDS.join(', ')})`);
    if (id === undefined || !CARD_ID.test(id)) fail('"id" must be lowercase words joined by "-"');
    else if (ids.has(id)) fail(`Duplicate id "${id}"`);
    else ids.add(id);
    for (const key of ['title', 'description'] as const) {
      const v = a[key];
      if (typeof v !== 'string' || v.trim() === '') fail(`"${key}" must be a non-empty string`);
      else if (v.length > ACHIEVEMENT_LIMITS[key]) fail(`"${key}" is ${v.length} characters; at most ${ACHIEVEMENT_LIMITS[key]} fit a phone`);
    }
    if (!ICONS.includes(a.icon as Icon)) fail(`"icon" must be one of ${ICONS.join(', ')}`);
    if (a.tier !== undefined && !TIERS.includes(a.tier as Tier)) fail(`"tier" must be one of ${TIERS.join(', ')}`);
    const ruleError = checkRule(a.rule, context);
    if (ruleError) fail(ruleError);
    else {
      const key = JSON.stringify(Object.entries(a.rule as object).sort(([x], [y]) => x.localeCompare(y)));
      const other = rules.get(key);
      if (other !== undefined) fail(`Same rule as "${other}"`);
      else rules.set(key, id ?? `#${index + 1}`);
    }
    if (violations.length === before) achievements.push(a as unknown as Achievement);
  });
  return { achievements, violations };
}

/** What is wrong with one rule, or undefined. */
function checkRule(raw: unknown, context: AchievementCheckContext): string | undefined {
  const rule = raw as Record<string, unknown> | null;
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return '"rule" must be an object {"kind", …}';
  const kind = rule.kind as RuleKind;
  if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(RULE_FIELDS, kind)) return `Unknown rule kind "${String(rule.kind)}" (kinds: ${RULE_KINDS.join(', ')})`;
  const { required, optional } = RULE_FIELDS[kind];
  for (const key of Object.keys(rule)) if (key !== 'kind' && !required.includes(key) && !optional.includes(key)) return `A "${kind}" rule has no field "${key}" (it takes ${[...required, ...optional].join(', ')})`;
  for (const key of required) if (rule[key] === undefined) return `A "${kind}" rule needs "${key}"`;
  if (rule.min !== undefined) {
    const min = rule.min;
    if (kind === 'mastery') {
      if (typeof min !== 'number' || !(min > 0 && min <= 1)) return '"min" of a mastery rule is a share above 0 and at most 1, e.g. 0.8';
    } else if (typeof min !== 'number' || !Number.isInteger(min) || min < 1) return `"min" of a "${kind}" rule must be a whole number from 1`;
  }
  if (rule.difficulty !== undefined && !DIFFICULTIES.includes(rule.difficulty as Difficulty)) return `"difficulty" must be one of ${DIFFICULTIES.join(', ')}`;
  if (rule.tag !== undefined && (typeof rule.tag !== 'string' || !context.problems.some((p) => p.tags.includes(rule.tag as string)))) {
    return `"tag" names "${String(rule.tag)}", which no practice problem has`;
  }
  if (rule.topic !== undefined && (typeof rule.topic !== 'string' || !context.topics.includes(rule.topic))) return `"topic" names "${String(rule.topic)}", which is not a topic in tags.json`;
  if (rule.stage !== undefined && (typeof rule.stage !== 'string' || !context.stages.includes(rule.stage))) return `"stage" names "${String(rule.stage)}", which is not a roadmap stage`;
  if (kind === 'solved' || kind === 'first-run' || kind === 'under-reference') {
    const reachable = context.problems.filter((p) => (!rule.difficulty || p.difficulty === rule.difficulty) && (!rule.tag || p.tags.includes(rule.tag as string))).length;
    if ((rule.min as number) > reachable) return `"min" is ${String(rule.min)}, but only ${reachable} problem(s) can count towards it`;
  }
  return undefined;
}
