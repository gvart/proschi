/** Bindings and settings of the Worker (wrangler.jsonc, secrets in .dev.vars). */
export interface Env {
  DB: D1Database;
  /** Rate limits (wrangler.jsonc `ratelimits`): test runs and data uploads per user, sign-ins and stats per IP. */
  RUN_LIMITER: RateLimit;
  AUTH_LIMITER: RateLimit;
  PROFILE_LIMITER: RateLimit;
  STATS_LIMITER: RateLimit;
  IMPORT_LIMITER: RateLimit;
  /** The built site (frontend/dist), served for every path outside /api and /auth. */
  ASSETS: Fetcher;
  /** `production` or `staging`; unset in local development. */
  ENVIRONMENT?: string;
  /** Signs the OAuth state cookie; sign-in is off unless it has at least 32 characters. */
  SESSION_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

/** Whether SESSION_SECRET is set and long enough to sign with. */
export function secretOk(env: Env): env is Env & { SESSION_SECRET: string } {
  return (env.SESSION_SECRET?.length ?? 0) >= 32;
}

/** Unix seconds. */
export const now = (): number => Math.floor(Date.now() / 1000);
