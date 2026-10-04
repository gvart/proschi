import { configuredProviders, createSession, finishLogin, isProvider, logout, startLogin } from './auth';
import type { Env } from './env';
import { errorResponse, HttpError, json, preflight, withCors } from './http';
import { deleteMe, getMe, recordRun, updateMe } from './progress';
import { getLeaderboard, getProblemStats, getStats } from './stats';

/**
 * The Proschi API (backend/README.md):
 *
 *   GET    /auth/providers                  sign-in providers on offer
 *   GET    /auth/<provider>/start?return=   → the provider's sign-in page
 *   GET    /auth/<provider>/callback        → the return page with ?login=<code>
 *   POST   /auth/session {code}             → {token, expiresAt}
 *   POST   /auth/logout
 *   GET    /api/me                          account and progress
 *   PATCH  /api/me {displayName?, publicProfile?}
 *   DELETE /api/me
 *   POST   /api/problems/<id>/runs {source, solved, imported?}
 *   GET    /api/stats                       every problem's summary
 *   GET    /api/stats/<id>                  one problem's distributions (+ yours, signed in)
 *   GET    /api/leaderboard
 */

async function route(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  const method = request.method;
  const parts = pathname.split('/').filter(Boolean);
  const is = (m: string, ...path: string[]) => method === m && parts.length === path.length && path.every((p, i) => p === '*' || p === parts[i]);

  if (is('GET', 'auth', 'providers')) return json({ providers: configuredProviders(env) }, 200, { 'Cache-Control': 'public, max-age=300' });
  if ((is('GET', 'auth', '*', 'start') || is('GET', 'auth', '*', 'callback')) && isProvider(parts[1])) {
    return parts[2] === 'start' ? startLogin(request, env, parts[1]) : finishLogin(request, env, parts[1]);
  }
  if (is('POST', 'auth', 'session')) return createSession(request, env);
  if (is('POST', 'auth', 'logout')) return logout(request, env);
  if (is('GET', 'api', 'me')) return getMe(request, env);
  if (is('PATCH', 'api', 'me')) return updateMe(request, env);
  if (is('DELETE', 'api', 'me')) return deleteMe(request, env);
  if (is('POST', 'api', 'problems', '*', 'runs')) return recordRun(request, env, parts[2]);
  if (is('GET', 'api', 'stats')) return getStats(env);
  if (is('GET', 'api', 'stats', '*')) return getProblemStats(request, env, parts[2]);
  if (is('GET', 'api', 'leaderboard')) return getLeaderboard(env);
  return errorResponse(404, 'Not found');
}

export default {
  async fetch(request, env): Promise<Response> {
    if (request.method === 'OPTIONS') return preflight(request, env);
    let response: Response;
    try {
      response = await route(request, env);
    } catch (e) {
      if (e instanceof HttpError) response = errorResponse(e.status, e.message);
      else {
        console.error(e);
        response = errorResponse(500, 'Internal error');
      }
    }
    return withCors(request, env, response);
  },
} satisfies ExportedHandler<Env>;
