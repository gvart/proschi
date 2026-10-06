/**
 * The practice level: one headline number for everything a learner has done,
 * derived from stats the skill map already has (AchievementsAnswer.stats), so
 * it needs nothing new from the server. Pure TypeScript like the rest of
 * src/learn: the progress page and a future mobile app compute it the same way.
 *
 *   XP    = 100 × problems solved + 20 × cards mastered + 10 × longest streak (days)
 *   level = ⌊√(XP / 50)⌋ + 1
 *
 * So level L starts at 50 × (L − 1)² XP: level 2 at 50 XP, 3 at 200, 4 at
 * 450, 5 at 800, 10 at 4,050. A first solve is level 2; every problem solved
 * is level 15 or so. A card is mastered at a stability of 21 days or more
 * (achievements.ts), so XP grows with what is remembered, not with clicks.
 * The longest streak, not the current one, so a missed day never takes XP away.
 */

export const XP_PER_SOLVE = 100;
export const XP_PER_MASTERED_CARD = 20;
export const XP_PER_STREAK_DAY = 10;
/** Level L starts at LEVEL_STEP × (L − 1)² XP. */
export const LEVEL_STEP = 50;

export interface LevelInput {
  solved: number;
  mastered: number;
  longestStreak: number;
}

export interface Level {
  /** From 1. */
  level: number;
  xp: number;
  /** XP where this level started, and where the next one starts. */
  floor: number;
  next: number;
  /** How far from this level to the next, from 0 to 1. */
  progress: number;
  /** The XP from each source, in the formula's order. */
  parts: { solves: number; mastered: number; streak: number };
}

const count = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/** The XP where level `level` starts. */
export const levelFloor = (level: number) => LEVEL_STEP * (Math.max(1, level) - 1) ** 2;

export function levelOf({ solved, mastered, longestStreak }: LevelInput): Level {
  const parts = { solves: XP_PER_SOLVE * count(solved), mastered: XP_PER_MASTERED_CARD * count(mastered), streak: XP_PER_STREAK_DAY * count(longestStreak) };
  const xp = parts.solves + parts.mastered + parts.streak;
  let level = Math.floor(Math.sqrt(xp / LEVEL_STEP)) + 1;
  // Guard against floating point at the exact boundaries.
  while (levelFloor(level + 1) <= xp) level++;
  while (level > 1 && levelFloor(level) > xp) level--;
  const floor = levelFloor(level);
  const next = levelFloor(level + 1);
  return { level, xp, floor, next, progress: (xp - floor) / (next - floor), parts };
}
