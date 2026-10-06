import { now, type Env } from './env';
import { log } from './log';
import { pruneDailyCounts } from './metrics';

/** An unsubmitted game run counts as abandoned this long after its start. */
export const ABANDONED_RUN_SECONDS = 7 * 86_400;

/**
 * The daily cron (wrangler.jsonc `triggers`). card_reviews is never pruned:
 * FSRS replays a card's whole review history to schedule it.
 */
export async function dailyCron(env: Env): Promise<void> {
  await purgeExpiredSessions(env);
  await pruneAbandonedGameRuns(env);
  const counts = await pruneDailyCounts(env);
  log('info', 'Pruned old usage counts', { deleted: counts });
}

/**
 * Deletes expired sessions (the site's cookies and apps' tokens, rotated
 * refresh tokens included) and expired app sign-in codes; returns how many
 * sessions.
 */
export async function purgeExpiredSessions(env: Env): Promise<number> {
  const t = now();
  const [sessions, codes] = await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(t),
    env.DB.prepare('DELETE FROM app_auth_codes WHERE expires_at <= ?').bind(t),
  ]);
  log('info', 'Purged expired sessions', { deleted: sessions.meta.changes, codes: codes.meta.changes });
  return sessions.meta.changes;
}

/**
 * Deletes game runs that were started (POST /api/game/runs writes the row)
 * but never submitted (`submitted_at` NULL) more than ABANDONED_RUN_SECONDS
 * ago; returns how many. A daily run's day is long over by then, so deleting
 * it never lets a player start that day's daily again.
 */
export async function pruneAbandonedGameRuns(env: Env): Promise<number> {
  const result = await env.DB.prepare('DELETE FROM game_runs WHERE submitted_at IS NULL AND started_at <= ?')
    .bind(now() - ABANDONED_RUN_SECONDS)
    .run();
  log('info', 'Pruned abandoned game runs', { deleted: result.meta.changes });
  return result.meta.changes;
}
