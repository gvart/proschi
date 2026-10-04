import { now, type Env } from './env';
import { log } from './log';

/** The daily cron (wrangler.jsonc `triggers`): deletes expired sessions; returns how many. */
export async function purgeExpiredSessions(env: Env): Promise<number> {
  const { meta } = await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now()).run();
  log('info', 'Purged expired sessions', { deleted: meta.changes });
  return meta.changes;
}
