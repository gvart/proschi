import { SIM_VERSION } from '../../frontend/src/sim/version';
import { configuredProviders, finishLogin, isProvider, logout, revokeAllSessions, startLogin, unlinkIdentity } from './auth';
import { createContext, type Ctx } from './context';
import { purgeExpiredSessions } from './cron';
import type { Env } from './env';
import { assertSameOrigin, errorResponse, HttpError, json, withSecurityHeaders } from './http';
import { errorText, log } from './log';
import { deleteMe, exportMe, getMe, importProgress, recordRun, updateMe } from './progress';
import { reviewDesign } from './review';
import { getLeaderboard, getProblemStats, getStats } from './stats';

/**
 * proschi.app: the site (frontend/dist, served as static assets without
 * running this code) and, under /api and /auth, the API (backend/README.md):
 *
 *   GET    /auth/providers                  sign-in providers on offer
 *   GET    /auth/<provider>/start?return=   → the provider's sign-in page (&link=1: add it to the signed-in account)
 *   GET    /auth/<provider>/callback        → the return path, signed in (session cookie)
 *   POST   /auth/logout
 *   GET    /api/health                      the Worker and D1 answer
 *   GET    /api/me                          account and progress
 *   PATCH  /api/me {displayName?, publicProfile?}
 *   DELETE /api/me
 *   GET    /api/me/export                   everything stored about the user, as a download
 *   POST   /api/me/import {items}           the browser's progress, on first sign-in
 *   POST   /api/me/sessions/revoke-all      sign out everywhere
 *   DELETE /api/me/identities/<provider>    unlink a sign-in
 *   POST   /api/problems/<id>/runs {source, solved, imported?}
 *   GET    /api/stats                       every problem's summary
 *   GET    /api/stats/<id>                  one problem's distributions (+ yours, signed in)
 *   GET    /api/leaderboard
 *   POST   /api/review {source, model, problem?, tests?, metrics?}   AI design review (a stub: 501)
 */

async function route(request: Request, ctx: Ctx, pathname: string): Promise<Response> {
  const { env } = ctx;
  assertSameOrigin(request);
  const method = request.method;
  const parts = pathname.split('/').filter(Boolean);
  const is = (m: string, ...path: string[]) => method === m && parts.length === path.length && path.every((p, i) => p === '*' || p === parts[i]);

  if (is('GET', 'auth', 'providers')) return json({ providers: configuredProviders(env) }, 200, { 'Cache-Control': 'public, max-age=300' });
  if ((is('GET', 'auth', '*', 'start') || is('GET', 'auth', '*', 'callback')) && isProvider(parts[1])) {
    return parts[2] === 'start' ? startLogin(request, ctx, parts[1]) : finishLogin(request, ctx, parts[1]);
  }
  if (is('POST', 'auth', 'logout')) return logout(request, ctx);
  if (is('GET', 'api', 'health')) return health(ctx);
  if (is('GET', 'api', 'me')) return getMe(request, ctx);
  if (is('PATCH', 'api', 'me')) return updateMe(request, ctx);
  if (is('DELETE', 'api', 'me')) return deleteMe(request, ctx);
  if (is('GET', 'api', 'me', 'export')) return exportMe(request, ctx);
  if (is('POST', 'api', 'me', 'import')) return importProgress(request, ctx);
  if (is('POST', 'api', 'me', 'sessions', 'revoke-all')) return revokeAllSessions(request, ctx);
  if (is('DELETE', 'api', 'me', 'identities', '*')) return unlinkIdentity(request, ctx, parts[3]);
  if (is('POST', 'api', 'problems', '*', 'runs')) return recordRun(request, ctx, parts[2]);
  if (is('GET', 'api', 'stats')) return getStats(ctx);
  if (is('GET', 'api', 'stats', '*')) return getProblemStats(request, ctx, parts[2]);
  if (is('GET', 'api', 'leaderboard')) return getLeaderboard(ctx);
  if (is('POST', 'api', 'review')) return reviewDesign(request, ctx);
  return errorResponse(404, 'Not found');
}

/** GET /api/health: for the deploy's smoke test and uptime checks. */
async function health(ctx: Ctx): Promise<Response> {
  try {
    await ctx.env.DB.prepare('SELECT 1').first();
  } catch (e) {
    log('error', 'Health check: D1 failed', { requestId: ctx.requestId, error: errorText(e) });
    return errorResponse(503, 'Database unavailable');
  }
  return json({ ok: true, env: ctx.env.ENVIRONMENT ?? 'development', simVersion: SIM_VERSION }, 200, { 'Cache-Control': 'no-store' });
}

export default {
  async fetch(request, env, exec): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (!/^\/(api|auth)(\/|$)/.test(pathname)) return env.ASSETS.fetch(request);
    const started = Date.now();
    const ctx = createContext(request, env, exec);
    let response: Response;
    let error: string | undefined;
    try {
      response = await route(request, ctx, pathname);
    } catch (e) {
      if (e instanceof HttpError) response = errorResponse(e.status, e.message, e.headers);
      else {
        error = errorText(e);
        response = errorResponse(500, 'Internal error');
      }
    }
    // The path only: the query of an OAuth callback holds the authorization code.
    log(error ? 'error' : 'info', 'request', {
      requestId: ctx.requestId,
      method: request.method,
      path: pathname,
      status: response.status,
      ms: Date.now() - started,
      ...(ctx.userId ? { userId: ctx.userId } : {}),
      ...(error ? { error } : {}),
    });
    return withSecurityHeaders(response, ctx);
  },

  async scheduled(_controller, env): Promise<void> {
    await purgeExpiredSessions(env);
  },
} satisfies ExportedHandler<Env>;
