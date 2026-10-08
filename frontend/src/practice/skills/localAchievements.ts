import deck from 'virtual:practice-cards';
import problems from 'virtual:practice-listings';
import type { Card } from '../../learn/cards';
import {
  achievementsAnswer,
  achievementStatuses,
  buildSnapshot,
  longestStreak,
  type AchievementContext,
  type AchievementsAnswer,
  type EarnedRecord,
  type SolvedProblem,
} from '../../learn/achievements';
import { statesFromLog } from '../../learn/review';
import { localDay } from '../../learn/streak';
import { isSafeKey } from '../../playground/sanitize';
import { loadJson, saveJson } from '../../services/storage';
import { ACHIEVEMENTS } from '../achievementList';
import { localActivity, localGoal } from '../activity';
import { localChallengeStats } from '../challenge/store';
import { challengeDay } from '../../learn/challenge';
import { lessonsRead, loadProgress, type Progress } from '../progress';
import { ROADMAP, requiredStages, roadmapFor } from '../roadmap';
import { CARDS_LOG_KEY, readReviews } from '../review/store';
import { loadRunStats } from '../runStats';
import { gameContent } from '../../game/content';
import { gameStats } from '../../game/engine/meta';
import { loadLocalMeta } from '../../game/ui/store';

/**
 * Achievements and the skill map in a build without accounts, from what this
 * browser keeps: the review log (proschi.cards), practice progress
 * (proschi.practice) and test runs (proschi.practice.runs). The badges earned
 * are kept here too, so they are celebrated once. Builds the same answer as
 * GET /api/me/achievements, with the same src/learn code.
 *
 * Loaded lazily: it bundles every card.
 */

/** Badges earned in this browser: `{ [achievement id]: {earnedAt, seenAt?} }`. */
export const ACHIEVEMENTS_KEY = 'proschi.achievements';

/** The catalog the rules look at: the problems this build has, and the roadmap's stages with them. */
export const context: AchievementContext = {
  problems,
  // Optional steps (the tutorial) are in no badge's target.
  stages: roadmapFor(
    requiredStages(ROADMAP),
    problems.map((p) => p.id),
  ),
};

export function readEarned(raw: unknown): Record<string, EarnedRecord> {
  const out: Record<string, EarnedRecord> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const v = value as Partial<EarnedRecord> | null;
    if (!isSafeKey(id) || !v || typeof v !== 'object' || !Number.isInteger(v.earnedAt)) continue;
    out[id] = { earnedAt: v.earnedAt as number, ...(Number.isInteger(v.seenAt) ? { seenAt: v.seenAt } : {}) };
  }
  return out;
}

const loadEarned = () => readEarned(loadJson<unknown>(ACHIEVEMENTS_KEY, {}));

/** Evaluates every badge on this browser's data, keeps the newly earned ones and answers like the API. */
export function localAchievements(now: number, progress: Progress = loadProgress()): AchievementsAnswer {
  const log = readReviews(loadJson<unknown>(CARDS_LOG_KEY, []));
  const cards = new Map<string, Card>(deck.cards.map((c) => [c.id, c]));
  const estimateRatings = log
    .filter((r) => cards.get(r.cardId)?.type === 'estimate')
    .sort((a, b) => a.reviewedAt - b.reviewedAt)
    .map((r) => r.rating);
  const runs = loadRunStats();
  const solvedProblems: SolvedProblem[] = Object.entries(progress)
    .filter(([id, entry]) => entry.status === 'solved' && problems.some((p) => p.id === id))
    .map(([id]) => {
      const r = runs[id];
      return {
        id,
        firstRun: r?.runsToSolve === 1,
        underReference: r?.bestCostUsd !== undefined && r.referenceCostUsd !== undefined && r.bestCostUsd < r.referenceCostUsd,
      };
    });

  const { snapshot, skills } = buildSnapshot({
    cards: deck.cards,
    topics: deck.topics,
    states: statesFromLog(log),
    now,
    problems,
    estimateRatings,
    reviews: log.length,
    // The daily streak as the streak widget counts it: this browser's reviews and solve days, its goal, freezes included.
    longestStreak: longestStreak(localActivity(), localDay(new Date(now * 1000)), localGoal()),
    solvedProblems,
    // The daily challenge's results kept in this browser, by UTC day.
    challenges: localChallengeStats(challengeDay(new Date(now * 1000))),
    // Scale or Fail's progress kept in this browser.
    game: gameStats(loadLocalMeta(), gameContent().content),
    // Lessons read in this browser.
    lessons: lessonsRead(),
  });
  const earned = loadEarned();
  const { statuses, newly } = achievementStatuses(ACHIEVEMENTS, snapshot, context, earned, now);
  if (newly.length) saveJson(ACHIEVEMENTS_KEY, { ...earned, ...Object.fromEntries(newly.map((id) => [id, { earnedAt: now }])) });
  return achievementsAnswer(statuses, skills, snapshot);
}

/** Marks earned badges as seen (all unseen ones without `ids`). */
export function markSeenLocally(now: number, ids?: readonly string[]): void {
  const earned = loadEarned();
  let changed = false;
  for (const [id, record] of Object.entries(earned)) {
    if (record.seenAt === undefined && (!ids || ids.includes(id))) {
      earned[id] = { ...record, seenAt: now };
      changed = true;
    }
  }
  if (changed) saveJson(ACHIEVEMENTS_KEY, earned);
}
