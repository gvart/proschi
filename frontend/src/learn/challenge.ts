import { gradeCloze, gradeEstimate, type Card, type ChoiceCard, type ClozeCard, type EstimateCard } from './cards';
import { formatNumber, hashText, seededRandom } from './grade';
import { daysBetween, isDay } from './review';

/**
 * The daily challenge (docs/CARDS.md, "Daily challenge"): the same five cards
 * for everyone each UTC day, scored for the leaderboard. Which cards, how an
 * answer is graded and scored, and the challenge streak are decided here, so
 * the practice page, the Worker (which grades and scores the attempts it
 * stores) and a future mobile app agree.
 *
 * Pure TypeScript with no browser or React dependency, like the rest of
 * src/learn.
 *
 * **Scoring**: each right answer is worth POINTS_CORRECT (100) plus a speed
 * bonus of up to SPEED_BONUS_MAX (20): the full bonus when answered within
 * SPEED_FULL_MS (10 s) of the card showing, falling linearly to 0 at
 * SPEED_ZERO_MS (60 s), rounded to whole points:
 *
 *     bonus(ms) = 20                                  ms ≤ 10,000
 *               = round(20 × (60,000 − ms) / 50,000)  10,000 < ms < 60,000
 *               = 0                                   ms ≥ 60,000
 *
 * A wrong answer scores 0, bonus included. Five cards make at most
 * 5 × 120 = 600 points; accuracy dominates, since all the speed in the world
 * is worth less than one more right answer.
 */

/** Cards in a day's challenge. */
export const CHALLENGE_SIZE = 5;
export const POINTS_CORRECT = 100;
export const SPEED_BONUS_MAX = 20;
/** Answered within this long, a right answer earns the whole speed bonus. */
export const SPEED_FULL_MS = 10_000;
/** From this long on, a right answer earns no speed bonus. */
export const SPEED_ZERO_MS = 60_000;
/** A card's time counts up to an hour, like a review's. */
export const MAX_CARD_MS = 3_600_000;
/** The best possible score: 600. */
export const MAX_SCORE = CHALLENGE_SIZE * (POINTS_CORRECT + SPEED_BONUS_MAX);
/** Typed answers longer than this are refused (a cloze gap is a few words). */
export const MAX_TYPED = 200;
/** What the share text links to. */
export const CHALLENGE_LINK = 'proschi.app/practice/#/challenge';

/** The card types a challenge takes: those graded automatically, so everyone is scored the same way. */
export const CHALLENGE_TYPES = ['choice', 'estimate', 'cloze'] as const;
export type ChallengeCard = ChoiceCard | EstimateCard | ClozeCard;

/** A challenge day: the UTC date, so it is the same day everywhere. */
export type ChallengeDay = string;

/** The challenge day of `date` (default now): its UTC date, `YYYY-MM-DD`. */
export function challengeDay(date: Date = new Date()): ChallengeDay {
  return date.toISOString().slice(0, 10);
}

/** Unix seconds of the 00:00 UTC that ends `day`, when the next challenge starts. */
export function challengeEndsAt(day: ChallengeDay): number {
  return Date.parse(`${day}T00:00:00Z`) / 1000 + 86_400;
}

/** Days since 1970-01-01 of `day`: the round that orders a choice card's options (grade.ts optionOrder), the same for everyone that day. */
export function challengeRound(day: ChallengeDay): number {
  return daysBetween('1970-01-01', day);
}

export const isChallengeCard = (card: Card): card is ChallengeCard => !card.retired && (CHALLENGE_TYPES as readonly string[]).includes(card.type);

const DIFFICULTY_RANK: Record<Card['difficulty'], number> = { easy: 0, medium: 1, hard: 2 };

/**
 * The day's cards: CHALLENGE_SIZE of the auto-graded, non-retired cards,
 * picked by a generator seeded with the day, so every client and the server
 * pick the same ones from the same cards (in any order). An estimate card
 * comes first when there is one; then cards from topics not picked yet, at
 * most two of a difficulty and two of a type; then, if the pool is too
 * small for that, any. Shown easy to hard.
 */
export function pickChallenge(cards: readonly Card[], day: ChallengeDay, size = CHALLENGE_SIZE): ChallengeCard[] {
  const pool = cards.filter(isChallengeCard).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const next = seededRandom(hashText(`proschi-challenge#${day}`));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const picked: ChallengeCard[] = [];
  const estimate = pool.find((c) => c.type === 'estimate');
  if (estimate && size > 0) picked.push(estimate);
  const count = <K extends string>(key: (c: ChallengeCard) => K, value: K) => picked.filter((c) => key(c) === value).length;
  const passes: ((c: ChallengeCard) => boolean)[] = [
    (c) => !picked.some((p) => p.topic === c.topic) && count((p) => p.difficulty, c.difficulty) < 2 && count((p) => p.type, c.type) < 2,
    (c) => !picked.some((p) => p.topic === c.topic),
    () => true,
  ];
  for (const fits of passes) {
    for (const card of pool) {
      if (picked.length >= size) break;
      if (!picked.includes(card) && fits(card)) picked.push(card);
    }
  }
  const order = new Map(pool.map((c, i) => [c.id, i]));
  return picked.sort((a, b) => DIFFICULTY_RANK[a.difficulty] - DIFFICULTY_RANK[b.difficulty] || order.get(a.id)! - order.get(b.id)!);
}

/**
 * An answer as a client sends it: a choice card's option, as its index in
 * the card's options as written (not as shown); an estimate's number; a
 * cloze card's gaps, as typed; `null` when the player gave up (wrong).
 */
export type ChallengeAnswer = number | string[] | null;

/** One card's answer and the time from showing the card to answering it. */
export interface ChallengeAnswerItem {
  cardId: string;
  answer: ChallengeAnswer;
  /** Milliseconds, whole, from 0. */
  ms: number;
}

/** Whether `answer` has the shape `card` takes (right or wrong). */
export function answerFits(card: ChallengeCard, answer: unknown): answer is ChallengeAnswer {
  if (answer === null) return true;
  switch (card.type) {
    case 'choice':
      return typeof answer === 'number' && Number.isInteger(answer) && answer >= 0 && answer < card.options.length;
    case 'estimate':
      return typeof answer === 'number' && Number.isFinite(answer);
    case 'cloze':
      return Array.isArray(answer) && answer.length <= card.blanks.length && answer.every((a) => typeof a === 'string' && a.length <= MAX_TYPED);
  }
}

/** Whether an answer is right, by the same rules as daily review (cards.ts, grade.ts). */
export function gradeChallengeAnswer(card: ChallengeCard, answer: ChallengeAnswer): boolean {
  if (answer === null || !answerFits(card, answer)) return false;
  switch (card.type) {
    case 'choice':
      return card.options[answer as number]?.correct === true;
    case 'estimate':
      return gradeEstimate(card, answer as number);
    case 'cloze': {
      const typed = answer as string[];
      return card.blanks.every((_, i) => gradeCloze(card, i, typed[i] ?? ''));
    }
  }
}

/** The speed bonus of a right answer given after `ms` (see the formula above). */
export function speedBonus(ms: number): number {
  if (!(ms >= 0)) return 0;
  if (ms <= SPEED_FULL_MS) return SPEED_BONUS_MAX;
  if (ms >= SPEED_ZERO_MS) return 0;
  return Math.round((SPEED_BONUS_MAX * (SPEED_ZERO_MS - ms)) / (SPEED_ZERO_MS - SPEED_FULL_MS));
}

/** One card's outcome. */
export interface ChallengeCardResult {
  cardId: string;
  correct: boolean;
  /** POINTS_CORRECT plus `bonus` when right, else 0. */
  points: number;
  bonus: number;
  ms: number;
}

export interface ChallengeScore {
  score: number;
  /** Right answers. */
  correct: number;
  /** The cards' times added up: the leaderboard's tie-break. */
  totalMs: number;
  results: ChallengeCardResult[];
}

/** Clamps a time to whole milliseconds from 0 to MAX_CARD_MS. */
export const clampMs = (ms: number) => (Number.isFinite(ms) ? Math.min(MAX_CARD_MS, Math.max(0, Math.round(ms))) : MAX_CARD_MS);

/** Grades and scores answers, in the order given; an answer to a card not in `cards` scores 0. */
export function scoreChallenge(cards: readonly ChallengeCard[], answers: readonly ChallengeAnswerItem[]): ChallengeScore {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const results = answers.map((a): ChallengeCardResult => {
    const card = byId.get(a.cardId);
    const ms = clampMs(a.ms);
    const correct = !!card && gradeChallengeAnswer(card, a.answer);
    const bonus = correct ? speedBonus(ms) : 0;
    return { cardId: a.cardId, correct, points: correct ? POINTS_CORRECT + bonus : 0, bonus, ms };
  });
  return {
    score: results.reduce((n, r) => n + r.points, 0),
    correct: results.filter((r) => r.correct).length,
    totalMs: results.reduce((n, r) => n + r.ms, 0),
    results,
  };
}

/** Every card answered right. */
export const isPerfect = (score: Pick<ChallengeScore, 'correct' | 'results'>) => score.results.length > 0 && score.correct === score.results.length;

/**
 * Reads an attempt's `answers` against the day's cards: exactly one answer
 * per card, of the shape that card takes, with a whole number of
 * milliseconds. Answers them in the day's order, times clamped to
 * MAX_CARD_MS, or says what is wrong.
 */
export function readAttempt(cards: readonly ChallengeCard[], raw: unknown): { answers: ChallengeAnswerItem[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: 'answers must be a list of {cardId, answer, ms}' };
  if (raw.length !== cards.length) return { error: `answers must have one answer for each of today's ${cards.length} cards` };
  const given = new Map<string, ChallengeAnswerItem>();
  for (const [i, item] of raw.entries()) {
    const a = item as Record<string, unknown> | null;
    if (!a || typeof a !== 'object' || Array.isArray(a)) return { error: `Answer ${i + 1} must be {cardId, answer, ms}` };
    if (typeof a.cardId !== 'string') return { error: `Answer ${i + 1}: cardId must be a card id` };
    const card = cards.find((c) => c.id === a.cardId);
    if (!card) return { error: `Answer ${i + 1}: ${a.cardId.slice(0, 100)} is not one of today's cards` };
    if (given.has(card.id)) return { error: `Answer ${i + 1}: ${card.id} is answered twice` };
    if (!answerFits(card, a.answer)) return { error: `Answer ${i + 1}: not an answer to a ${card.type} card` };
    if (typeof a.ms !== 'number' || !Number.isInteger(a.ms) || a.ms < 0) return { error: `Answer ${i + 1}: ms must be a whole number of milliseconds` };
    given.set(card.id, { cardId: card.id, answer: a.answer, ms: clampMs(a.ms) });
  }
  return { answers: cards.map((c) => given.get(c.id)!) };
}

export interface ChallengeStreak {
  /** Challenge days in a row up to today, or up to yesterday while today's is still open. */
  current: number;
  longest: number;
  /** Whether today's challenge is done. */
  todayDone: boolean;
}

/** The challenge streak: days in a row with a completed challenge, as of `today` (UTC days, no freezes). Later days are ignored. */
export function challengeStreak(days: readonly ChallengeDay[], today: ChallengeDay): ChallengeStreak {
  const sorted = [...new Set(days.filter((d) => isDay(d) && d <= today))].sort();
  let longest = 0;
  let run = 0;
  let last: string | undefined;
  for (const day of sorted) {
    run = last !== undefined && daysBetween(last, day) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    last = day;
  }
  const alive = last !== undefined && daysBetween(last, today) <= 1;
  return { current: alive ? run : 0, longest, todayDone: last === today };
}

/** What the challenge badges look at (achievements.ts). */
export interface ChallengeStats {
  /** Challenges completed. */
  completed: number;
  /** Of them, with every card right. */
  perfect: number;
  /** The longest challenge streak. */
  longestStreak: number;
}

/** The badges' stats from each completed day and whether it was perfect. */
export function challengeStats(attempts: readonly { day: ChallengeDay; perfect: boolean }[], today: ChallengeDay): ChallengeStats {
  return {
    completed: attempts.length,
    perfect: attempts.filter((a) => a.perfect).length,
    longestStreak: challengeStreak(
      attempts.map((a) => a.day),
      today,
    ).longest,
  };
}

/** "Proschi daily challenge 2026-10-06: 480/600 ✅✅❌✅✅ proschi.app/practice/#/challenge" */
export function shareText(day: ChallengeDay, score: number, correct: readonly boolean[]): string {
  return `Proschi daily challenge ${day}: ${score}/${MAX_SCORE} ${correct.map((c) => (c ? '✅' : '❌')).join('')} ${CHALLENGE_LINK}`;
}

/** An answer as the result screen shows it: the option's text, the number with its unit, the gaps typed. */
export function describeAnswer(card: ChallengeCard, answer: ChallengeAnswer): string {
  if (answer === null) return 'No answer';
  switch (card.type) {
    case 'choice':
      return typeof answer === 'number' ? (card.options[answer]?.text ?? 'No answer') : 'No answer';
    case 'estimate':
      return typeof answer === 'number' ? `${formatNumber(answer)} ${card.unit}` : 'No answer';
    case 'cloze':
      return Array.isArray(answer) && answer.some((a) => a.trim() !== '') ? answer.map((a) => a.trim() || '…').join(', ') : 'No answer';
  }
}

/** The right answer as the result screen shows it. */
export function describeRightAnswer(card: ChallengeCard): string {
  switch (card.type) {
    case 'choice':
      return card.options.find((o) => o.correct)?.text ?? '';
    case 'estimate':
      return `${formatNumber(card.answer)} ${card.unit}`;
    case 'cloze':
      return card.blanks.map((b) => b[0]).join(', ');
  }
}
