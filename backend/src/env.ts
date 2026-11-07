/** Bindings and settings of the Worker (wrangler.jsonc, secrets in .dev.vars). */
export interface Env {
  DB: D1Database;
  /** Rate limits (wrangler.jsonc `ratelimits`): test runs, data uploads, card reviews and challenge attempts per user, sign-ins, stats and design reviews per IP. */
  RUN_LIMITER: RateLimit;
  AUTH_LIMITER: RateLimit;
  PROFILE_LIMITER: RateLimit;
  STATS_LIMITER: RateLimit;
  IMPORT_LIMITER: RateLimit;
  CARD_LIMITER: RateLimit;
  CHALLENGE_LIMITER: RateLimit;
  /** Game runs started, submitted or imported, and purchases, per user. */
  GAME_LIMITER: RateLimit;
  /** Synced editor diagrams listed, saved or deleted, per user. */
  DOCS_LIMITER: RateLimit;
  /** Short links created, per user. */
  SHARE_LIMITER: RateLimit;
  /** POST /api/metrics, per IP (the IP is only the limiter's key, never stored). */
  METRICS_LIMITER: RateLimit;
  /** Confirmation emails of email reminders, per user (src/reminders.ts). */
  EMAIL_LIMITER: RateLimit;
  /** The admin panel's sign-in and setup, per IP (src/adminAuth.ts). */
  ADMIN_LIMITER: RateLimit;
  /** AI interviews (src/interviews.ts), per user: sessions started, turns, verdicts, and reads of sessions. */
  INTERVIEW_START_LIMITER: RateLimit;
  INTERVIEW_TURN_LIMITER: RateLimit;
  INTERVIEW_FINISH_LIMITER: RateLimit;
  INTERVIEW_READ_LIMITER: RateLimit;
  /** Polar's webhook (src/billing.ts), per IP, before the signature is checked; and the bad signatures logged, one per IP a minute. */
  WEBHOOK_LIMITER: RateLimit;
  WEBHOOK_LOG_LIMITER: RateLimit;
  /** Design partner (src/partner.ts), per user: sessions, turns, reads and change decisions. */
  PARTNER_LIMITER: RateLimit;
  /** The deployed version's id, tag and time (wrangler.jsonc `version_metadata`), for the admin's health page. */
  CF_VERSION_METADATA?: WorkerVersionMetadata;
  /**
   * Cloudflare Email Service (wrangler.jsonc `send_email`), for the email
   * reminders; only src/email.ts uses it. Unset, opting in answers 503.
   */
  EMAIL?: SendEmail;
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
  /**
   * Where native apps may be sent back to after signing in (the
   * `redirect_uri` of /auth/<provider>/start?client=app): exact URIs,
   * separated by commas or whitespace. Empty or unset, app sign-in is off.
   */
  APP_REDIRECT_URIS?: string;
  /**
   * The shared secret of GET /api/metrics/summary (header X-Metrics-Token),
   * at least 16 characters. Unset, the summary answers 404.
   */
  METRICS_TOKEN?: string;
  /**
   * The one-time secret that registers the admin panel's first passkey
   * (src/adminAuth.ts), at least 16 characters. It works only while no
   * passkey exists; unset, the admin cannot be set up.
   */
  ADMIN_SETUP_TOKEN?: string;
  /**
   * Billing through Polar (src/billing.ts; backend/README.md "Billing and
   * credits"). Without the token, the webhook secret and the five product
   * ids, checkout, the portal and the webhook answer 501.
   */
  POLAR_ACCESS_TOKEN?: string;
  /** The webhook endpoint's secret, as Polar shows it (`polar_whs_…` or `whsec_…`). */
  POLAR_WEBHOOK_SECRET?: string;
  /** `sandbox` for Polar's sandbox (sandbox-api.polar.sh); anything else is production. */
  POLAR_SERVER?: string;
  /** Polar product ids of Pro and Max, monthly and yearly, and the 1,000-credit top-up. */
  POLAR_PRODUCT_PRO_MONTHLY?: string;
  POLAR_PRODUCT_PRO_YEARLY?: string;
  POLAR_PRODUCT_MAX_MONTHLY?: string;
  POLAR_PRODUCT_MAX_YEARLY?: string;
  POLAR_PRODUCT_CREDITS_1000?: string;
  /**
   * EUR per USD for metering (src/meter.ts, P26): a model call costs the
   * user 2x what it cost us, converted at this fixed rate. Unset, 0.95.
   */
  CREDITS_USD_EUR?: string;
  /**
   * The AI features (src/interviews.ts, src/review.ts, src/ai/client.ts).
   * Without the key their routes answer 501 (docs/design/paid-plans.md P10).
   */
  ANTHROPIC_API_KEY?: string;
  /** Cloudflare AI Gateway's Anthropic endpoint; the Claude API when unset. */
  AI_GATEWAY_URL?: string;
  /** An authenticated gateway's token, sent as `cf-aig-authorization`. */
  AI_GATEWAY_TOKEN?: string;
  /**
   * Cloudflare Turnstile on email sign-up, sign-in and password reset
   * (src/turnstile.ts): the widget's public site key (wrangler.jsonc `vars`)
   * and the secret Siteverify checks tokens with. Without the secret the
   * check is skipped (local development, tests).
   */
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  /**
   * Admin campaigns (src/campaigns.ts): the most campaign emails sent a UTC
   * day (unset: 500; the rest go out the next day), and the admin's own
   * address, where "Send a test to me" goes (unset: no test sends).
   */
  CAMPAIGN_DAILY_CAP?: string;
  ADMIN_EMAIL?: string;
}

/** Whether SESSION_SECRET is set and long enough to sign with. */
export function secretOk(env: Env): env is Env & { SESSION_SECRET: string } {
  return (env.SESSION_SECRET?.length ?? 0) >= 32;
}

/** Unix seconds. */
export const now = (): number => Math.floor(Date.now() / 1000);
