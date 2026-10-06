import { now, type Env } from './env';
import { log } from './log';
import { pruneDailyCounts } from './metrics';

/**
 * The daily cron (wrangler.jsonc `triggers`): deletes expired sessions (the
 * site's cookies and apps' tokens, rotated refresh tokens included) and
 * expired app sign-in codes, and usage counts (daily_counts) older than 400
 * days; returns how many sessions.
 */
export async function purgeExpiredSessions(env: Env): Promise<number> {
  const t = now();
  const [sessions, codes] = await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(t),
    env.DB.prepare('DELETE FROM app_auth_codes WHERE expires_at <= ?').bind(t),
  ]);
  const counts = await pruneDailyCounts(env);
  log('info', 'Purged expired sessions', { deleted: sessions.meta.changes, codes: codes.meta.changes, dailyCounts: counts });
  return sessions.meta.changes;
}
