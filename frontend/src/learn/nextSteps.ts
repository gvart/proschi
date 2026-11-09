import { percent } from './mastery';

/**
 * "Your next steps" without a model: a short, ranked list of concrete things
 * to do next, from the skill map, the cards due, recent mistakes, the problems
 * solved or started and today's daily challenge. Free for everyone (the AI
 * roadmap's picks, docs/design/paid-plans.md P9, replace it where they exist).
 * Pure and deterministic, like the rest of src/learn: the same input always
 * gives the same list, so a plan that fills days (an interview date's
 * schedule) can call it once per day with that day's input, passing the
 * problems already planned in `exclude`.
 *
 * The rules, in this order (each step at most once unless said):
 *
 *   retry      the latest unsolved problem whose failed run matched a known
 *              mistake (practice/mistakes.ts): "Retry X", "You missed: …".
 *   review     every card due today: "Review 12 due cards", on one topic when
 *              all of them are, else naming the topics with the most.
 *   challenge  today's daily challenge, when it is known not to be played.
 *   practise   for each of the weakest topics under MASTERED (at most
 *              PRACTISE_TOPICS), an unsolved problem that trains it: the
 *              easiest, one already started first, then list order.
 *   finish     the first problem started but not solved (and not retried).
 *
 * The list is cut at `limit` (DEFAULT_LIMIT). Problems never repeat.
 */

export type NextStepKind = 'retry' | 'review' | 'challenge' | 'practise' | 'finish';

type Difficulty = 'easy' | 'medium' | 'hard';

export interface NextStepsInput {
  /** The skill map: each topic's mastery (0 to 1) and the problems that train it, in tags.json order. */
  topics: readonly { id: string; title: string; mastery: number; related: readonly string[] }[];
  /** Review cards due now: in all, and per topic id (a card counts for each topic it trains). */
  due: { total: number; byTopic: Readonly<Record<string, number>> };
  /** The problems, in list order. */
  problems: readonly { id: string; title: string; difficulty: Difficulty }[];
  solved: readonly string[];
  /** Started (changed from the starter) but not solved. */
  attempted: readonly string[];
  /** Known mistakes a failed run matched; `at` in Unix seconds. */
  mistakes: readonly { problem: string; title: string; at: number }[];
  /** Today's daily challenge played; undefined when unknown. */
  challengeDone?: boolean;
  /** The current daily streak in days, for the challenge's reason. */
  streak?: number;
  /** Problems not to suggest, e.g. shown elsewhere already or planned for another day. */
  exclude?: readonly string[];
  limit?: number;
}

export interface NextStep {
  kind: NextStepKind;
  /** Unique within a list, e.g. `practise:url-shortener`. */
  key: string;
  /** A problem id for retry, practise and finish; a topic id for review (or undefined: every due card). */
  problem?: string;
  topic?: string;
  title: string;
  /** Why it was picked, one sentence. */
  reason: string;
  /** About how long it takes, for a day's plan. */
  minutes: number;
}

export const DEFAULT_LIMIT = 4;
/** A topic at this mastery or above is no longer "weak". */
export const MASTERED = 0.7;
/** How many weak topics get a problem. */
export const PRACTISE_TOPICS = 2;
/** Minutes per kind of step; a problem by its difficulty. */
export const MINUTES = { card: 0.5, challenge: 3, easy: 15, medium: 25, hard: 40 } as const;

const DIFFICULTY_RANK: Record<Difficulty, number> = { easy: 0, medium: 1, hard: 2 };

export function nextSteps(input: NextStepsInput): NextStep[] {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const solved = new Set(input.solved);
  const attempted = new Set(input.attempted);
  const used = new Set(input.exclude);
  const byId = new Map(input.problems.map((p) => [p.id, p]));
  const open = (id: string) => byId.has(id) && !solved.has(id) && !used.has(id);
  const steps: NextStep[] = [];

  // retry: the latest mistake on a problem still unsolved.
  const mistake = [...input.mistakes].filter((m) => open(m.problem)).sort((a, b) => b.at - a.at || a.problem.localeCompare(b.problem))[0];
  if (mistake) {
    const p = byId.get(mistake.problem)!;
    used.add(p.id);
    steps.push({ kind: 'retry', key: `retry:${p.id}`, problem: p.id, title: `Retry ${p.title}`, reason: `You missed: ${mistake.title}.`, minutes: MINUTES[p.difficulty] });
  }

  // review: every card due today.
  if (input.due.total > 0) {
    const n = input.due.total;
    const cards = `${n} due card${n === 1 ? '' : 's'}`;
    const mastery = new Map(input.topics.map((t) => [t.id, t.mastery]));
    const order = new Map(input.topics.map((t, i) => [t.id, i]));
    const ranked = input.topics
      .filter((t) => (input.due.byTopic[t.id] ?? 0) > 0)
      .sort((a, b) => input.due.byTopic[b.id] - input.due.byTopic[a.id] || mastery.get(a.id)! - mastery.get(b.id)! || order.get(a.id)! - order.get(b.id)!);
    const minutes = Math.max(2, Math.ceil(n * MINUTES.card));
    const only = ranked.length > 0 && input.due.byTopic[ranked[0].id] === n ? ranked[0] : undefined;
    if (only) {
      steps.push({ kind: 'review', key: `review:${only.id}`, topic: only.id, title: `Review ${cards} on ${only.title}`, reason: 'They are due today; a review now keeps them from fading.', minutes });
    } else {
      const most = ranked.slice(0, 2).map((t) => t.title);
      const reason = most.length ? `They are due today, most on ${most.join(' and ')}; a review now keeps them from fading.` : 'They are due today; a review now keeps them from fading.';
      steps.push({ kind: 'review', key: 'review:all', title: `Review ${cards}`, reason, minutes });
    }
  }

  // challenge: today's, when known not to be played.
  if (input.challengeDone === false) {
    const streak = input.streak ?? 0;
    steps.push({
      kind: 'challenge',
      key: 'challenge:today',
      title: 'Do today’s daily challenge',
      reason: streak > 0 ? `Five quick questions; keeps your ${streak}-day streak going.` : 'Five quick questions, new every day.',
      minutes: MINUTES.challenge,
    });
  }

  // practise: the weakest topics, each with a problem that trains it.
  const weak = input.topics
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.mastery < MASTERED)
    .sort((a, b) => a.t.mastery - b.t.mastery || a.i - b.i);
  const listOrder = new Map(input.problems.map((p, i) => [p.id, i]));
  let picked = 0;
  for (const { t } of weak) {
    if (picked >= PRACTISE_TOPICS) break;
    const p = t.related
      .filter(open)
      .map((id) => byId.get(id)!)
      .sort(
        (a, b) =>
          DIFFICULTY_RANK[a.difficulty] - DIFFICULTY_RANK[b.difficulty] ||
          Number(attempted.has(b.id)) - Number(attempted.has(a.id)) ||
          listOrder.get(a.id)! - listOrder.get(b.id)!,
      )[0];
    if (!p) continue;
    used.add(p.id);
    const level = `${percent(t.mastery)}% mastered`;
    steps.push({
      kind: 'practise',
      key: `practise:${p.id}`,
      problem: p.id,
      topic: t.id,
      title: `Try ${p.title}`,
      reason: picked === 0 ? `Practises ${t.title}, your weakest skill (${level}).` : `Practises ${t.title}, one of your weaker skills (${level}).`,
      minutes: MINUTES[p.difficulty],
    });
    picked++;
  }

  // finish: a problem started and left.
  const started = input.problems.find((p) => attempted.has(p.id) && open(p.id));
  if (started) {
    steps.push({ kind: 'finish', key: `finish:${started.id}`, problem: started.id, title: `Finish ${started.title}`, reason: 'You started this design; a few more runs may solve it.', minutes: MINUTES[started.difficulty] });
  }

  return steps.slice(0, limit);
}
