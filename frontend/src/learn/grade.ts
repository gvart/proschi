import { gradeCloze, gradeEstimate, type ChoiceCard, type ClozeCard, type EstimateCard } from './cards';

export { parseNumber } from './cards';

/**
 * Grading the answers a reviewer types or taps: reading a typed number, how
 * far an estimate is off, a choice card's option order. Pure, like cards.ts.
 */

export interface EstimateResult {
  correct: boolean;
  /** How many times too high or too low, at least 1. */
  factor: number;
  direction: 'high' | 'low' | 'exact';
}

/**
 * Whether an estimate is within the card's tolerance, and how far off it is.
 * A `range` (an interview estimate's accepted low and high) replaces the
 * tolerance factor.
 */
export function gradeEstimateAnswer(card: Pick<EstimateCard, 'answer' | 'tolerance'>, value: number, range?: { low: number; high: number }): EstimateResult {
  const ratio = value / card.answer;
  const direction = ratio > 1 ? 'high' : ratio < 1 ? 'low' : 'exact';
  const correct = range ? Number.isFinite(value) && value >= range.low && value <= range.high : gradeEstimate(card, value);
  return { correct, factor: ratio >= 1 ? ratio : 1 / ratio, direction };
}

/** A factor for "about 3× too high": one decimal under 10, whole above, with thousands separators. */
export function formatFactor(factor: number): string {
  if (factor < 10) return String(Math.round(factor * 10) / 10);
  return Math.round(factor).toLocaleString('en-US');
}

/** A number as an answer is shown: thousands separators, at most three significant decimals. */
export function formatNumber(value: number): string {
  return value.toLocaleString('en-US', { maximumSignificantDigits: Math.min(21, Math.max(3, String(Math.round(value)).length)) });
}

/** FNV-1a: a 32-bit hash of a string, to seed a shuffle (optionOrder, the daily challenge's pick). */
export function hashText(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** mulberry32: a small seeded generator of numbers in [0, 1); the same seed gives the same numbers on every platform. */
export function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The order to show a choice card's options in, as indexes into
 * `card.options`: shuffled, but the same for the same card and `round` (the
 * number of times it was reviewed), so a reload shows the same order and the
 * next review a different one.
 */
export function optionOrder(card: Pick<ChoiceCard, 'id' | 'options'>, round = 0): number[] {
  const order = card.options.map((_, i) => i);
  const next = seededRandom(hashText(`${card.id}#${round}`));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** Whether every gap of a cloze card is filled right, and which are. */
export function gradeClozeAnswers(card: ClozeCard, typed: readonly string[]): { correct: boolean; gaps: boolean[] } {
  const gaps = card.blanks.map((_, i) => gradeCloze(card, i, typed[i] ?? ''));
  return { correct: gaps.every(Boolean), gaps };
}
