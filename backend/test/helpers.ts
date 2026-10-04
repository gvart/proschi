import { env, exports } from 'cloudflare:workers';
import { sha256 } from '../src/crypto';
import { clearStatsCache } from '../src/stats';

export const ORIGIN = 'http://localhost:5173';

/** A request to the Worker, as the practice page on ORIGIN sends it. */
export function call(path: string, init: Omit<RequestInit, 'body'> & { token?: string; body?: unknown } = {}): Promise<Response> {
  const { token, body, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (!headers.has('Origin')) headers.set('Origin', ORIGIN);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  return (exports as unknown as { default: Fetcher }).default.fetch(new Request(`https://api.test${path}`, { ...rest, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
}

let users = 0;

/** A user with a session, created straight in the database; returns its id and bearer token. */
export async function signedInUser(name = `user${++users}`, publicProfile = false): Promise<{ id: string; token: string }> {
  const id = crypto.randomUUID();
  const token = `token-${id}`;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO users (id, display_name, public_profile, created_at) VALUES (?, ?, ?, 0)').bind(id, name, publicProfile ? 1 : 0),
    env.DB.prepare('INSERT INTO identities (provider, subject, user_id) VALUES (?, ?, ?)').bind('github', id, id),
    env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256(token), id, 4_000_000_000),
  ]);
  return { id, token };
}

export async function resetDatabase(): Promise<void> {
  await env.DB.batch(['login_codes', 'sessions', 'progress', 'identities', 'users'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  clearStatsCache();
}
