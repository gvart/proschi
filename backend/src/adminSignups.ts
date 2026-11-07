import { requireAdmin } from './adminAuth';
import type { Ctx } from './context';
import { now } from './env';
import { HttpError, json } from './http';

/**
 * The admin panel's view of sign-in methods and the free sign-up credits'
 * checks (src/signupChecks.ts). Separate from src/admin.ts, which the
 * metering work also edits.
 *
 *   GET /api/admin/users/<id>/sign-in   methods, address confirmed, the credits' decision and why
 *   GET /api/admin/signups              sign-ups refused free credits today (UTC), by reason
 */

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function getUserSignIn(request: Request, ctx: Ctx, id: string): Promise<Response> {
  await requireAdmin(request, ctx);
  const { DB } = ctx.env;
  const [identities, login, check] = await DB.batch([
    DB.prepare('SELECT provider FROM identities WHERE user_id = ? ORDER BY provider').bind(id),
    DB.prepare("SELECT l.confirmed_at FROM email_logins l JOIN identities i ON i.provider = 'email' AND i.subject = l.normalized AND i.user_id = l.user_id WHERE l.user_id = ?").bind(id),
    DB.prepare('SELECT outcome, reason, created_at, decided_at FROM signup_checks WHERE user_id = ?').bind(id),
  ]);
  const methods = (identities.results as { provider: string }[]).map((r) => r.provider);
  if (!methods.length && !(await DB.prepare('SELECT 1 FROM users WHERE id = ?').bind(id).first())) throw new HttpError(404, 'No such user');
  const email = login.results[0] as { confirmed_at: number | null } | undefined;
  const decision = check.results[0] as { outcome: string; reason: string; created_at: number; decided_at: number | null } | undefined;
  return json(
    {
      methods,
      // An email sign-in has to be confirmed; a GitHub or Google one counts as confirmed.
      confirmed: email ? email.confirmed_at !== null : methods.length > 0,
      confirmedAt: email?.confirmed_at ?? null,
      signupCredits: decision ? { outcome: decision.outcome, reason: decision.reason, decidedAt: decision.decided_at } : null,
    },
    200,
    NO_STORE,
  );
}

export async function getSignups(request: Request, ctx: Ctx): Promise<Response> {
  await requireAdmin(request, ctx);
  const t = now();
  const startOfDay = t - (t % 86_400);
  const { results } = await ctx.env.DB.prepare("SELECT reason, COUNT(*) AS n FROM signup_checks WHERE outcome = 'refused' AND decided_at >= ? GROUP BY reason ORDER BY n DESC")
    .bind(startOfDay)
    .all<{ reason: string; n: number }>();
  return json({ refusedToday: results.reduce((sum, r) => sum + r.n, 0), byReason: results }, 200, NO_STORE);
}
