import { now, type Env } from './env';
import { errorText, log, type Level } from './log';

/**
 * App events for the admin panel's health and events pages (`app_events`,
 * migrations/0015_admin.sql): server errors, cron runs, failed sign-ins,
 * rate limits hit and admin sign-ins. Never a user id, an IP or a query
 * string: the detail holds a path, a status, a request id or a job's
 * numbers. Kept EVENT_RETENTION_DAYS (src/cron.ts prunes them).
 */

export type EventKind =
  | 'server_error'
  | 'rate_limited'
  | 'sign_in_failed'
  | 'blocked_sign_in'
  | 'cron'
  | 'reminder_failed'
  | 'admin_sign_in'
  | 'admin_sign_in_failed'
  | 'admin_setup';

export const EVENT_RETENTION_DAYS = 30;

const MAX_MESSAGE = 500;
const MAX_DETAIL = 4000;

/** Stores one event; a failure is logged and swallowed, so an event never fails the request or job it belongs to. */
export async function recordEvent(env: Env, level: Level, kind: EventKind, message: string, detail?: Record<string, unknown>): Promise<void> {
  try {
    const text = detail ? JSON.stringify(detail).slice(0, MAX_DETAIL) : null;
    await env.DB.prepare('INSERT INTO app_events (at, level, kind, message, detail) VALUES (?, ?, ?, ?, ?)')
      .bind(now(), level, kind, message.slice(0, MAX_MESSAGE), text)
      .run();
  } catch (e) {
    log('error', 'Recording an app event failed', { kind, error: errorText(e) });
  }
}

/** The last time (ms) each throttled key was recorded in this isolate. */
const lastRecorded = new Map<string, number>();
const THROTTLE_MS = 60_000;

/**
 * Like recordEvent, but at most once a minute per `key` in this isolate:
 * for events a flood could repeat (429s, the same 500 on every request), so
 * an attack cannot turn into as many database writes. Returns whether it was
 * recorded.
 */
export function recordThrottled(env: Env, exec: ExecutionContext, key: string, level: Level, kind: EventKind, message: string, detail?: Record<string, unknown>): boolean {
  const t = Date.now();
  const last = lastRecorded.get(key);
  if (last !== undefined && t - last < THROTTLE_MS) return false;
  lastRecorded.set(key, t);
  if (lastRecorded.size > 1000) {
    for (const [k, at] of lastRecorded) if (t - at >= THROTTLE_MS) lastRecorded.delete(k);
  }
  exec.waitUntil(recordEvent(env, level, kind, message, detail));
  return true;
}

/**
 * A path with its ids replaced by `:id` (`/api/users/:id/profile`), for an
 * event's detail and throttle key: an event never holds an account id, and
 * a flood over many ids still counts as one route.
 */
export function routeOf(pathname: string): string {
  return pathname
    .split('/')
    .map((part, i, parts) => (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(part) || (/\d/.test(part) && part.length >= 8) || (i === 2 && parts[1] === 's' && part) ? ':id' : part))
    .join('/')
    .slice(0, 200);
}

/** Forgets the throttle (tests). */
export function resetEventThrottle(): void {
  lastRecorded.clear();
}

/** Deletes events older than EVENT_RETENTION_DAYS; returns how many. */
export async function pruneEvents(env: Env): Promise<number> {
  const { meta } = await env.DB.prepare('DELETE FROM app_events WHERE at < ?').bind(now() - EVENT_RETENTION_DAYS * 86_400).run();
  return meta.changes;
}
