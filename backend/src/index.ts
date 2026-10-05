import { SIM_VERSION } from '../../frontend/src/sim/version';
import { getActivity } from './activity';
import { getAchievements, markAchievementsSeen } from './achievements';
import { revoke, token } from './apptokens';
import { getCardState, postCardReviews } from './cards';
import { getGameLeaderboard, getGameMe, postGameBuy, postGameEquip, postGameRun, postGameSubmit, postGameSync } from './game';
import { getChallengeLeaderboard, getChallengeToday, postChallengeAttempt, postChallengeStart } from './challenge';
import { configuredProviders, finishLogin, isProvider, logout, revokeAllSessions, startLogin, unlinkIdentity } from './auth';
import { createContext, type Ctx } from './context';
import { purgeExpiredSessions } from './cron';
import type { Env } from './env';
import { assertSameOrigin, errorResponse, HttpError, json, withSecurityHeaders } from './http';
import { errorText, log } from './log';
import { deleteMe, exportMe, getMe, importProgress, recordRun, updateMe } from './progress';
import { reviewDesign } from './review';
import { getPublicProfile } from './profile';
import { getLeaderboard, getProblemStats, getStats } from './stats';

/**
 * proschi.app: the site (frontend/dist, served as static assets without
 * running this code) and, under /api and /auth, the API (backend/README.md):
 *
 *   GET    /auth/providers                  sign-in providers on offer
 *   GET    /auth/<provider>/start?return=   → the provider's sign-in page (&link=1: add it to the signed-in account)
 *   GET    /auth/<provider>/callback        → the return path, signed in (session cookie)
 *   GET    /auth/<provider>/start?client=app&redirect_uri=&code_challenge=&code_challenge_method=S256[&state=]
 *                                           a native app's sign-in: the callback → redirect_uri?code=
 *   POST   /auth/token {grant_type, code, code_verifier | refresh_token}   an app's bearer tokens
 *   POST   /auth/revoke {token}             ends an app's sign-in
 *   POST   /auth/logout
 *   GET    /api/health                      the Worker and D1 answer
 *   GET    /api/me                          account and progress
 *   PATCH  /api/me {displayName?, publicProfile?, dailyGoal?}
 *   DELETE /api/me
 *   GET    /api/me/export                   everything stored about the user, as a download
 *   GET    /api/me/activity?day=YYYY-MM-DD  daily goal, streak, weekly recap and each day's activity
 *   POST   /api/me/import {items}           the browser's progress, on first sign-in
 *   GET    /api/me/achievements?day=        every badge with its progress, and the skill map (stores newly earned badges)
 *   POST   /api/me/achievements/seen {ids?} marks earned badges as celebrated
 *   POST   /api/me/sessions/revoke-all      sign out everywhere
 *   DELETE /api/me/identities/<provider>    unlink a sign-in
 *   POST   /api/problems/<id>/runs {source, solved, imported?, day?}
 *   GET    /api/stats                       every problem's summary
 *   GET    /api/stats/<id>                  one problem's distributions (+ yours, signed in)
 *   GET    /api/leaderboard                 users who opted in, by problems solved (with their public ids)
 *   GET    /api/users/<id>/profile          a public profile (404 unless the user opted in)
 *   GET    /api/cards/state?day=YYYY-MM-DD   card review states (+ that day's counts)
 *   POST   /api/cards/reviews {reviews}     up to 200 card reviews; answers the cards' new states
 *   GET    /api/challenge/today             the daily challenge's cards (+ your attempt and challenge streak, signed in)
 *   POST   /api/challenge/today/start {day?}            records when the first card was shown (once per user and day)
 *   POST   /api/challenge/today/attempt {answers, day?}   grades, scores and keeps your first attempt of the day
 *   GET    /api/challenge/leaderboard?day=  the day's top 20 who opted in, with their public ids (+ your rank, signed in)
 *   GET    /api/game/me                     Scale or Fail: your progress, best scores and today's daily run
 *   POST   /api/game/runs {mode, scenario?, ascension?}   starts a ranked run: {runId, setup} (the server picks the seed)
 *   POST   /api/game/runs/<id>/submit {actions}   replays the run and keeps its score (once)
 *   POST   /api/game/buy {id}               spends Blueprints on an unlock or a perk level
 *   POST   /api/game/equip {perks}          the perks to take into runs
 *   POST   /api/game/sync {events}          runs, purchases and perks from signed out, replayed in order
 *   GET    /api/game/leaderboard?scenario=&ascension= | ?day=   top 20 who opted in (+ your rank, signed in)
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
  if (is('POST', 'auth', 'token')) return token(request, ctx);
  if (is('POST', 'auth', 'revoke')) return revoke(request, ctx);
  if (is('GET', 'api', 'health')) return health(ctx);
  if (is('GET', 'api', 'me')) return getMe(request, ctx);
  if (is('PATCH', 'api', 'me')) return updateMe(request, ctx);
  if (is('DELETE', 'api', 'me')) return deleteMe(request, ctx);
  if (is('GET', 'api', 'me', 'export')) return exportMe(request, ctx);
  if (is('GET', 'api', 'me', 'activity')) return getActivity(request, ctx);
  if (is('POST', 'api', 'me', 'import')) return importProgress(request, ctx);
  if (is('GET', 'api', 'me', 'achievements')) return getAchievements(request, ctx);
  if (is('POST', 'api', 'me', 'achievements', 'seen')) return markAchievementsSeen(request, ctx);
  if (is('POST', 'api', 'me', 'sessions', 'revoke-all')) return revokeAllSessions(request, ctx);
  if (is('DELETE', 'api', 'me', 'identities', '*')) return unlinkIdentity(request, ctx, parts[3]);
  if (is('POST', 'api', 'problems', '*', 'runs')) return recordRun(request, ctx, parts[2]);
  if (is('GET', 'api', 'stats')) return getStats(ctx);
  if (is('GET', 'api', 'stats', '*')) return getProblemStats(request, ctx, parts[2]);
  if (is('GET', 'api', 'leaderboard')) return getLeaderboard(ctx);
  if (is('GET', 'api', 'users', '*', 'profile')) return getPublicProfile(ctx, parts[2]);
  if (is('GET', 'api', 'cards', 'state')) return getCardState(request, ctx);
  if (is('POST', 'api', 'cards', 'reviews')) return postCardReviews(request, ctx);
  if (is('GET', 'api', 'challenge', 'today')) return getChallengeToday(request, ctx);
  if (is('POST', 'api', 'challenge', 'today', 'start')) return postChallengeStart(request, ctx);
  if (is('POST', 'api', 'challenge', 'today', 'attempt')) return postChallengeAttempt(request, ctx);
  if (is('GET', 'api', 'challenge', 'leaderboard')) return getChallengeLeaderboard(request, ctx);
  if (is('GET', 'api', 'game', 'me')) return getGameMe(request, ctx);
  if (is('POST', 'api', 'game', 'runs')) return postGameRun(request, ctx);
  if (is('POST', 'api', 'game', 'runs', '*', 'submit')) return postGameSubmit(request, ctx, parts[3]);
  if (is('POST', 'api', 'game', 'buy')) return postGameBuy(request, ctx);
  if (is('POST', 'api', 'game', 'equip')) return postGameEquip(request, ctx);
  if (is('POST', 'api', 'game', 'sync')) return postGameSync(request, ctx);
  if (is('GET', 'api', 'game', 'leaderboard')) return getGameLeaderboard(request, ctx);
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
