import { pruneAudit } from './admin';
import { purgeAdminSessions } from './adminAuth';
import { TOMBSTONE_TTL_MS } from './documents';
import { now, type Env } from './env';
import { pruneEvents, recordEvent } from './events';
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
  if (new Date(scheduledTime).getUTCHours() === DAILY_HOUR) await dailyCron(env);
  await runJob(env, 'reminders', async () => {
    const sent = await sendReminders(env, t);
    if (sent) log('info', 'Sent reminders', { sent });
    return { sent };
  });
}

/**
 * Runs one job and records how it went as a `cron` app event (the admin's
 * health page shows each job's last run, src/admin.ts CRON_JOBS). A failure
 * is logged, never thrown, so one job failing does not stop the others.
 */
async function runJob(env: Env, job: string, run: () => Promise<Record<string, number>>): Promise<void> {
  const started = Date.now();
  try {
    const result = await run();
    await recordEvent(env, 'info', 'cron', job, { ...result, ms: Date.now() - started });
  } catch (e) {
    log('error', `Cron job ${job} failed`, { error: errorText(e) });
    await recordEvent(env, 'error', 'cron', job, { error: errorText(e).split('\n')[0], ms: Date.now() - started });
  }
}

/**
 * The daily jobs (once a day, from hourlyCron). card_reviews is never pruned:
 * FSRS replays a card's whole review history to schedule it.
 */
export async function dailyCron(env: Env): Promise<void> {
  await runJob(env, 'sessions', async () => ({ deleted: await purgeExpiredSessions(env), admin: await purgeAdminSessions(env) }));
  await runJob(env, 'game_runs', async () => ({ deleted: await pruneAbandonedGameRuns(env) }));
  await runJob(env, 'tombstones', async () => ({ deleted: await pruneDocumentTombstones(env) }));
  await runJob(env, 'usage_counts', async () => {
    const deleted = await pruneDailyCounts(env);
    log('info', 'Pruned old usage counts', { deleted });
    return { deleted };
  });
  await runJob(env, 'app_events', async () => ({ deleted: await pruneEvents(env), audit: await pruneAudit(env) }));
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
