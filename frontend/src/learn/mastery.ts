import type { Card, Topic } from './cards';
import { retrievability, type Rating } from './fsrs';
import { isNew, reviewable, type CardStates } from './review';

/**
 * The skill map: how well a learner knows each topic of tags.json, from 0 to
 * 1, and an overall "interview ready" score. Pure TypeScript with no browser
 * or React dependency, like the rest of src/learn: the progress page, the
 * Worker (GET /api/me/achievements) and a future mobile app compute it the
 * same way.
 *
 * A topic's mastery blends up to four parts, each from 0 to 1:
 *
 *   recall     R = Σ retrievability(card, now) / cards
 *                  over the topic's reviewable cards, a card never reviewed
 *                  (or reviewed before its answer changed) counting 0. It is
 *                  the average predicted recall of the cards seen, times the
 *                  share seen: one card remembered out of ten is not 90%.
 *   coverage   C = cards seen / cards
 *   problems   P = min(1, related solved / min(3, related))
 *                  where the related problems are those the topic's cards
 *                  name in `related:` and those tagged with the topic's id
 *                  (a problem tag `caching` matches the topic `caching`).
 *                  Three solved count in full. Left out when nothing relates.
 *   accuracy   A = right answers / answers over the last 20 estimate cards
 *                  answered. Only for the `estimation` topic.
 *
 *   mastery = (0.55 R + 0.15 C + 0.30 P + 0.30 A) / (sum of the weights of the parts that apply)
 *
 * So a topic with no related problem, every card seen and recalled at the
 * target 90%, scores (0.55 × 0.9 + 0.15) / 0.7 ≈ 0.92; with related problems
 * none of them solved, the same cards score 0.645, and solving them is what
 * lifts it past 0.7. Recall decays between reviews, so mastery does too.
 *
 * Playing Scale or Fail adds a small bonus on top: every game lesson of the
 * topic met in a run (a tech card held, an incident survived) counts,
 * GAME_LESSONS_FOR_FULL of them for the whole GAME_BONUS. It is a bonus, not
 * a part, so a topic never scores less for being played.
 *
 * Readiness is the mean of the topics' mastery weighted by how many cards
 * each has, so a topic with more to know counts more.
 */

/** The weight of each part of a topic's mastery (see above). */
export const MASTERY_WEIGHTS = { recall: 0.55, coverage: 0.15, problems: 0.3, accuracy: 0.3 } as const;
/** Solving this many related problems counts the problems part in full. */
export const PROBLEMS_FOR_FULL = 3;
/** Estimation accuracy looks at this many of the latest estimate answers. */
export const ACCURACY_WINDOW = 20;
/** The most Scale or Fail adds to a topic's mastery, and the game lessons that earn all of it. */
export const GAME_BONUS = 0.05;
export const GAME_LESSONS_FOR_FULL = 3;
/** The topic whose mastery includes estimation accuracy. */
export const ESTIMATION_TOPIC = 'estimation';

/** What mastery needs to know about a practice problem. */
export interface ProblemInfo {
  id: string;
  difficulty: 'easy' | 'medium' | 'hard';
  tags: string[];
}

export interface MasteryInput {
  cards: readonly Card[];
  topics: readonly Topic[];
  states: CardStates;
  /** Unix seconds. */
  now: number;
  problems: readonly ProblemInfo[];
  /** Ids of the problems solved. */
  solved: ReadonlySet<string> | readonly string[];
  /** The ratings of every estimate card answered, oldest first (1 is wrong; 3 and 4 right). */
  estimateRatings: readonly Rating[];
  /** Scale or Fail lessons met per topic id; none when absent. */
  gameLessons?: Readonly<Record<string, number>>;
}

export interface TopicMastery {
  topic: string;
  /** 0 to 1: the blend above. */
  mastery: number;
  recall: number;
  coverage: number;
  /** Absent when no problem relates to the topic. */
  problems?: number;
  /** Only for the estimation topic. */
  accuracy?: number;
  /** The Scale or Fail bonus, 0 to GAME_BONUS; absent without game lessons. */
  game?: number;
  /** The topic's reviewable cards: its weight in readiness. */
  cards: number;
}

export interface Skills {
  /** Every topic of tags.json that has cards, in its order. */
  topics: TopicMastery[];
  /** 0 to 1: the mastery of the topics weighted by their cards. */
  readiness: number;
  /** The weakest topics' ids, weakest first (ties in tags.json order), at most WEAKEST of them. */
  weakest: string[];
}

/** How many weakest topics the skill map names. */
export const WEAKEST = 3;

/** The share of the latest ACCURACY_WINDOW estimate answers that were right; 0 for none. */
export function estimateAccuracy(ratings: readonly Rating[]): number {
  const recent = ratings.slice(-ACCURACY_WINDOW);
  return recent.length ? recent.filter((r) => r > 1).length / recent.length : 0;
}

/** The problems related to a topic: named by its cards' `related:`, or tagged with its id. */
export function relatedProblems(topic: string, cards: readonly Card[], problems: readonly ProblemInfo[]): string[] {
  const known = new Set(problems.map((p) => p.id));
  const ids = new Set<string>();
  for (const card of cards) if (card.tags.includes(topic)) for (const id of card.related) if (known.has(id)) ids.add(id);
  for (const p of problems) if (p.tags.includes(topic)) ids.add(p.id);
  return [...ids].sort();
}

/** One topic's mastery and its parts. */
export function topicMastery(topic: string, input: MasteryInput): TopicMastery {
  const pool = reviewable(input.cards, { topic });
  const seen = pool.filter((c) => !isNew(c, input.states[c.id]));
  const recall = pool.length ? seen.reduce((sum, c) => sum + retrievability(input.states[c.id], input.now), 0) / pool.length : 0;
  const coverage = pool.length ? seen.length / pool.length : 0;
  const solved = new Set(input.solved);
  const related = relatedProblems(topic, input.cards, input.problems);
  const problems = related.length ? Math.min(1, related.filter((id) => solved.has(id)).length / Math.min(PROBLEMS_FOR_FULL, related.length)) : undefined;
  const accuracy = topic === ESTIMATION_TOPIC ? estimateAccuracy(input.estimateRatings) : undefined;

  const w = MASTERY_WEIGHTS;
  let total = w.recall * recall + w.coverage * coverage;
  let weights = w.recall + w.coverage;
  if (problems !== undefined) {
    total += w.problems * problems;
    weights += w.problems;
  }
  if (accuracy !== undefined) {
    total += w.accuracy * accuracy;
    weights += w.accuracy;
  }
  const lessons = input.gameLessons?.[topic] ?? 0;
  const game = lessons > 0 ? GAME_BONUS * Math.min(1, lessons / GAME_LESSONS_FOR_FULL) : undefined;
  return {
    topic,
    mastery: clamp01(total / weights + (game ?? 0)),
    recall,
    coverage,
    ...(problems !== undefined ? { problems } : {}),
    ...(accuracy !== undefined ? { accuracy } : {}),
    ...(game !== undefined ? { game } : {}),
    cards: pool.length,
  };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Every topic's mastery, the readiness score and the weakest topics. */
export function skills(input: MasteryInput): Skills {
  const topics = input.topics.map((t) => topicMastery(t.id, input)).filter((t) => t.cards > 0);
  const weight = topics.reduce((sum, t) => sum + t.cards, 0);
  const readiness = weight ? topics.reduce((sum, t) => sum + t.mastery * t.cards, 0) / weight : 0;
  const weakest = topics
    .map((t, i) => ({ t, i }))
    .sort((a, b) => a.t.mastery - b.t.mastery || a.i - b.i)
    .slice(0, WEAKEST)
    .map(({ t }) => t.topic);
  return { topics, readiness, weakest };
}

/** A share as a whole percentage, rounded down so 0.795 never reads as 80%. */
export function percent(share: number): number {
  return Math.floor(clamp01(share) * 100 + 1e-9);
}
