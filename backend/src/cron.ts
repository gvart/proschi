import { TOMBSTONE_TTL_MS } from './documents';
import { now, type Env } from './env';
import { log } from './log';

/**
 * The daily cron (wrangler.jsonc `triggers`): deletes expired sessions (the
 * site's cookies and apps' tokens, rotated refresh tokens included) and
 * expired app sign-in codes; returns how many sessions.
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

/** The daily cron: deletes the tombstones of synced diagrams deleted more than 30 days ago; returns how many. */
export async function pruneDocumentTombstones(env: Env): Promise<number> {
  const { meta } = await env.DB.prepare('DELETE FROM documents WHERE deleted_at IS NOT NULL AND deleted_at <= ?').bind(Date.now() - TOMBSTONE_TTL_MS).run();
  log('info', 'Pruned diagram tombstones', { deleted: meta.changes });
  return meta.changes;
}
