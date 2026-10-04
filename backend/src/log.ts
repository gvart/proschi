/**
 * Structured logs: one JSON line per event, which Workers Logs
 * (wrangler.jsonc `observability`) indexes by field. Log a URL's path only,
 * never its query: OAuth callbacks carry the authorization code there.
 */

export type Level = 'info' | 'warn' | 'error';

export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

/** An error's stack, or its text, for the `error` field. */
export function errorText(e: unknown): string {
  return e instanceof Error ? (e.stack ?? `${e.name}: ${e.message}`) : String(e);
}
