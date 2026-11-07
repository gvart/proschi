import type { Ctx } from './context';
import type { Env } from './env';
import { HttpError } from './http';
import { errorText, log } from './log';

/**
 * Cloudflare Turnstile on email sign-up, sign-in and password reset
 * (src/emailAuth.ts). The page renders the widget with TURNSTILE_SITE_KEY
 * (served by GET /auth/providers) and sends its token; the server checks it
 * with Siteverify. Unset TURNSTILE_SECRET_KEY (local development, tests), the
 * check is skipped with a log line. Cloudflare's test keys (README) let
 * local development exercise the widget without a real one.
 */

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** The site key for the page, or undefined when Turnstile is off. */
export function turnstileSiteKey(env: Env): string | undefined {
  return env.TURNSTILE_SECRET_KEY && env.TURNSTILE_SITE_KEY ? env.TURNSTILE_SITE_KEY : undefined;
}

let warned = false;

/** Throws 400 `turnstile_failed` unless the request's Turnstile token passes Siteverify (or Turnstile is off). */
export async function verifyTurnstile(ctx: Ctx, token: unknown, action: string): Promise<void> {
  const secret = ctx.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (!warned) log('info', 'Turnstile is off (no TURNSTILE_SECRET_KEY): email sign-in skips the check', { requestId: ctx.requestId });
    warned = true;
    return;
  }
  if (typeof token !== 'string' || !token || token.length > 2048) throw new HttpError(400, 'Complete the check that you are human, then try again');
  let outcome: { success?: boolean; 'error-codes'?: string[]; action?: string };
  try {
    const body = new FormData();
    body.set('secret', secret);
    body.set('response', token);
    if (ctx.ip !== 'unknown') body.set('remoteip', ctx.ip);
    body.set('idempotency_key', crypto.randomUUID());
    const response = await fetch(SITEVERIFY, { method: 'POST', body });
    outcome = (await response.json()) as typeof outcome;
  } catch (e) {
    // Fails closed: without the check, this is exactly what a bot would wait for.
    log('error', 'Turnstile Siteverify failed', { requestId: ctx.requestId, error: errorText(e) });
    throw new HttpError(503, 'The human check is unavailable; try again in a minute');
  }
  // The widget's action, when the page set one, must be this form's (a token from another form doesn't count).
  if (!outcome.success || (outcome.action && outcome.action !== action)) {
    log('info', 'Turnstile refused a request', { requestId: ctx.requestId, action, errors: outcome['error-codes']?.join(',') });
    throw new HttpError(400, 'The check that you are human failed; try again');
  }
}
