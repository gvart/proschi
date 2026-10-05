import { liveAchievements, type Achievement } from '../learn/achievements';
import raw from './achievements.json';

/**
 * Every achievement in use, from achievements.json (src/learn/achievements.ts
 * has the format), retired ones left out. Read as it is: the practice tests
 * and `proschi achievements check` validate the file in CI, and the Worker
 * reads the same file.
 */
export const ACHIEVEMENTS = liveAchievements(raw as unknown as Achievement[]);
