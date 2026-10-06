import { challengeStats, challengeStreak, isPerfect, MAX_SCORE, scoreChallenge, type ChallengeAnswerItem, type ChallengeCard, type ChallengeStats } from '../../learn/challenge';
import { isDay, localDay, type CardReview } from '../../learn/review';
import type { ChallengeCardOutcome, ChallengeStreakAnswer } from '../../services/api';
import { loadJson, saveJson } from '../../services/storage';
import { readReviews } from '../review/store';

/**
 * Where the daily challenge keeps results in the browser (the rules are
 * src/learn/challenge.ts): every day's result in a build without accounts,
 * where the score and the challenge streak are this browser's; and, signed
 * out, the last result, so it is shown again and can be saved to the account
 * after signing in. Signed in, the server keeps them.
 */

/** A build without accounts: each day's result, `{[day]: LocalResult}`. */
export const CHALLENGE_KEY = 'proschi.challenge';
/** Signed out: the last challenge played, with its answers and reviews, until it is saved to an account. */
export const CHALLENGE_GUEST_KEY = 'proschi.challenge.guest';

/** A result as the page shows it; the server's attempt has the same fields, and a rank. */
export interface ChallengeResult {
  day: string;
  score: number;
  maxScore: number;
  correct: number;
  perfect: boolean;
  totalMs: number;
  results: ChallengeCardOutcome[];
  /**
   * This device's local date when the challenge was played, for the daily
   * streak (`day` is the challenge's, a UTC date). Missing from results kept
   * before it was recorded: the streak takes `day` then.
   */
  localDay?: string;
  /** Signed in: the rank among the day's players. */
  rank?: number;
  players?: number;
}

/** Signed out: a result with what saving it needs. */
export interface GuestChallenge {
  result: ChallengeResult;
  answers: ChallengeAnswerItem[];
  /** The reviews the challenge's cards made, sent to the account with it. */
  reviews: CardReview[];
}

/** Scores answers in this browser, with the same code as the server. */
export function scoreLocally(day: string, cards: readonly ChallengeCard[], answers: readonly ChallengeAnswerItem[]): ChallengeResult {
  const score = scoreChallenge(cards, answers);
  return {
    day,
    score: score.score,
    maxScore: MAX_SCORE,
    correct: score.correct,
    perfect: isPerfect(score),
    totalMs: score.totalMs,
    results: score.results.map((r, i) => ({ ...r, answer: answers[i].answer })),
    localDay: localDay(new Date()),
  };
}

const isWhole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** A stored result, or undefined when it is malformed. */
export function readResult(raw: unknown): ChallengeResult | undefined {
  const r = raw as Partial<ChallengeResult> | null;
  if (!r || typeof r !== 'object' || !isDay(r.day) || !isWhole(r.score) || !isWhole(r.correct) || !isWhole(r.totalMs) || !Array.isArray(r.results)) return undefined;
  const results = r.results.filter(
    (x): x is ChallengeCardOutcome => !!x && typeof x === 'object' && typeof x.cardId === 'string' && typeof x.correct === 'boolean' && isWhole(x.points) && isWhole(x.ms),
  );
  if (results.length !== r.results.length) return undefined;
  return {
    day: r.day,
    score: r.score,
    maxScore: MAX_SCORE,
    correct: r.correct,
    perfect: r.perfect === true,
    totalMs: r.totalMs,
    results: results.map((x) => ({ ...x, bonus: isWhole(x.bonus) ? x.bonus : 0, answer: x.answer ?? null })),
    ...(isDay(r.localDay) ? { localDay: r.localDay } : {}),
  };
}

/** A build without accounts: every day's result kept in this browser. */
export function localResults(): Record<string, ChallengeResult> {
  const raw = loadJson<unknown>(CHALLENGE_KEY, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, ChallengeResult> = {};
  for (const [day, value] of Object.entries(raw as Record<string, unknown>)) {
    const result = readResult(value);
    if (result && result.day === day) out[day] = result;
  }
  return out;
}

/** Keeps a day's result; the first one of a day stays, as on the server. */
export function saveLocalResult(result: ChallengeResult): ChallengeResult {
  const all = localResults();
  if (all[result.day]) return all[result.day];
  saveJson(CHALLENGE_KEY, { ...all, [result.day]: result });
  return result;
}

/** The challenge streak from this browser's results. */
export function localStreak(today: string): ChallengeStreakAnswer {
  return challengeStreak(Object.keys(localResults()), today);
}

/** The badges' challenge stats from this browser's results (a build without accounts). */
export function localChallengeStats(today: string): ChallengeStats {
  return challengeStats(
    Object.values(localResults()).map((r) => ({ day: r.day, perfect: r.perfect })),
    today,
  );
}

/** Signed out: the last challenge played in this browser. */
export function guestChallenge(): GuestChallenge | undefined {
  const raw = loadJson<unknown>(CHALLENGE_GUEST_KEY, undefined) as Partial<GuestChallenge> | undefined;
  if (!raw || typeof raw !== 'object') return undefined;
  const result = readResult(raw.result);
  if (!result || !Array.isArray(raw.answers)) return undefined;
  const answers = raw.answers.filter((a): a is ChallengeAnswerItem => !!a && typeof a === 'object' && typeof a.cardId === 'string' && isWhole(a.ms));
  return { result, answers, reviews: readReviews(raw.reviews) };
}

/**
 * A challenge in progress: the answers given so far (each kept the moment it
 * is given) and how many of them were reviewed, so a reload resumes at the
 * next card unanswered. By owner: a user id signed in, `guest` signed out,
 * `local` in a build without accounts.
 */
export const CHALLENGE_PROGRESS_KEY = 'proschi.challenge.progress';

export interface ChallengeProgress {
  day: string;
  answers: ChallengeAnswerItem[];
  /** Of `answers`, those already recorded as card reviews. */
  reviewed: number;
  /** Signed out: the reviews made so far, kept with the result. */
  reviews: CardReview[];
}

function readAllProgress(): Record<string, unknown> {
  const raw = loadJson<unknown>(CHALLENGE_PROGRESS_KEY, {});
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

const isAnswer = (a: unknown): a is ChallengeAnswerItem => {
  const x = a as Partial<ChallengeAnswerItem> | null;
  return !!x && typeof x === 'object' && typeof x.cardId === 'string' && isWhole(x.ms) && (x.answer === null || typeof x.answer === 'number' || (Array.isArray(x.answer) && x.answer.every((t) => typeof t === 'string')));
};

/** The owner's challenge in progress, if any. */
export function challengeProgress(owner: string): ChallengeProgress | undefined {
  const all = readAllProgress();
  const p = (Object.prototype.hasOwnProperty.call(all, owner) ? all[owner] : undefined) as Partial<ChallengeProgress> | undefined;
  if (!p || typeof p !== 'object' || !isDay(p.day) || !Array.isArray(p.answers) || !p.answers.every(isAnswer)) return undefined;
  return { day: p.day, answers: p.answers, reviewed: isWhole(p.reviewed) ? Math.min(p.reviewed, p.answers.length) : 0, reviews: readReviews(p.reviews) };
}

export function saveChallengeProgress(owner: string, progress: ChallengeProgress): void {
  saveJson(CHALLENGE_PROGRESS_KEY, { ...readAllProgress(), [owner]: progress });
}

export function clearChallengeProgress(owner: string): void {
  const all = readAllProgress();
  if (!Object.prototype.hasOwnProperty.call(all, owner)) return;
  delete all[owner];
  saveJson(CHALLENGE_PROGRESS_KEY, all);
}

export const saveGuestChallenge =(guest: GuestChallenge) => saveJson(CHALLENGE_GUEST_KEY, guest);

export function clearGuestChallenge(): void {
  try {
    localStorage.removeItem(CHALLENGE_GUEST_KEY);
  } catch {
    // Storage blocked: nothing was kept.
  }
}
