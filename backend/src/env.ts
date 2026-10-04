/** Bindings and settings of the Worker (wrangler.jsonc, secrets in .dev.vars). */
export interface Env {
  DB: D1Database;
  RUN_LIMITER: RateLimit;
  /** Comma-separated origins that may call the API and that sign-in may return to. */
  ALLOWED_ORIGINS: string;
  /** Signs the OAuth state cookie. */
  SESSION_SECRET: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

/** Unix seconds. */
export const now = (): number => Math.floor(Date.now() / 1000);
