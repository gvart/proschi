import type { AchievementsAnswer, AchievementStatus } from '../../learn/achievements';
import { levelOf } from '../../learn/level';
import { percent } from '../../learn/mastery';
import topics from '../cards/tags.json';

/** What an interview changed in the progress, for the result's "Your progress" (ResultProgress.tsx). */

const titles = new Map((topics as { id: string; title: string }[]).map((t) => [t.id, t.title]));
/** Without `before`, a badge earned this soon after the interview ended is its own. */
const SINCE_END_S = 10 * 60;
const MOVED_SHOWN = 4;

export interface ProgressChange {
  xp: number;
  level: number;
  levelUp: boolean;
  skills: { topic: string; title: string; before: number; after: number }[];
  badges: AchievementStatus[];
}

/** What changed from `before` to `after`; `endedAt` (Unix ms) picks the badges when there is no `before`. */
export function progressChange(after: AchievementsAnswer, before: AchievementsAnswer | undefined, endedAt: number): ProgressChange {
  const level = levelOf(after.stats);
  const was = before ? levelOf(before.stats) : level;
  const mastery = new Map(before?.skills.topics.map((t) => [t.topic, t.mastery]) ?? []);
  const skills = before
    ? after.skills.topics
        .map((t) => ({ topic: t.topic, title: titles.get(t.topic) ?? t.topic, before: percent(mastery.get(t.topic) ?? 0), after: percent(t.mastery) }))
        .filter((t) => t.after > t.before)
        .sort((a, b) => b.after - b.before - (a.after - a.before))
        .slice(0, MOVED_SHOWN)
    : [];
  const earnedBefore = new Set(before?.achievements.filter((a) => a.earned).map((a) => a.id) ?? []);
  const end = Math.floor(endedAt / 1000);
  const badges = after.achievements.filter((a) => a.earned && (before ? !earnedBefore.has(a.id) : (a.earnedAt ?? 0) >= end - 5 && (a.earnedAt ?? 0) <= end + SINCE_END_S));
  return { xp: level.xp - was.xp, level: level.level, levelUp: level.level > was.level, skills, badges };
}
