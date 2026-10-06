import { TOMBSTONE_TTL_MS } from './documents';
import { now, type Env } from './env';
import { errorText, log } from './log';
import { pruneDailyCounts } from './metrics';
import { sendReminders } from './reminders';

/** An unsubmitted game run counts as abandoned this long after its start. */
export const ABANDONED_RUN_SECONDS = 7 * 86_400;

/** The UTC hour the daily jobs run in (the cron itself runs hourly). */
export const DAILY_HOUR = 3;

/**
 * The hourly cron (wrangler.jsonc `triggers`, at minute 17): the email
 * reminders every hour (src/reminders.ts), the daily jobs once a day, in
 * the DAILY_HOUR UTC hour. One failing does not stop the other.
 */
export async function hourlyCron(env: Env, scheduledTime: number): Promise<void> {
  const t = Math.floor(scheduledTime / 1000);
  if (new Date(scheduledTime).getUTCHours() === DAILY_HOUR) {
    try {
      await dailyCron(env);
    } catch (e) {
      log('error', 'Daily cron failed', { error: errorText(e) });
    }
  }
  const sent = await sendReminders(env, t);
  if (sent) log('info', 'Sent reminders', { sent });
}

/**
 * The daily jobs (once a day, from hourlyCron). card_reviews is never pruned:
 * FSRS replays a card's whole review history to schedule it.
 */
export async function dailyCron(env: Env): Promise<void> {
  await purgeExpiredSessions(env);
  await pruneAbandonedGameRuns(env);
  await pruneDocumentTombstones(env);
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

/** Deletes the tombstones of synced diagrams deleted more than 30 days ago; returns how many. */
export async function pruneDocumentTombstones(env: Env): Promise<number> {
  const { meta } = await env.DB.prepare('DELETE FROM documents WHERE deleted_at IS NOT NULL AND deleted_at <= ?').bind(Date.now() - TOMBSTONE_TTL_MS).run();
  log('info', 'Pruned diagram tombstones', { deleted: meta.changes });
  return meta.changes;
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
