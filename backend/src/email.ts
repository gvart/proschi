import type { Env } from './env';

/**
 * Outbound email: the one place that talks to Cloudflare Email Service.
 *
 * The binding is `send_email` in wrangler.jsonc (`EMAIL`), whose `send()`
 * takes a composed message (`from`, `to`, `subject`, `text`, `html`,
 * `headers`) and answers `{messageId}` (the `SendEmail` type of
 * @cloudflare/workers-types). The sending domain (proschi.app) must be
 * onboarded to Email Service in the Cloudflare dashboard, with its SPF/DKIM
 * records, and the sender address allowed (backend/README.md "Email
 * reminders"). Should the API change, only this file changes. What the
 * emails say is in src/emails.ts, how they look in src/emailLayout.ts.
 */

/** Every email comes from this address; the binding is restricted to it (wrangler.jsonc). */
export const SENDER = { name: 'Proschi', email: 'reminders@proschi.app' };

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Extra headers, e.g. List-Unsubscribe (RFC 8058). */
  headers?: Record<string, string>;
}

/** Whether the Worker has an email binding at all (opt-in answers 503 without one). */
export const emailConfigured = (env: Env): boolean => env.EMAIL !== undefined;

/** Sends one email; throws when the binding is missing or refuses it. */
export async function sendEmail(env: Env, message: OutgoingEmail): Promise<string> {
  if (!env.EMAIL) throw new Error('No EMAIL binding (send_email in wrangler.jsonc)');
  const result = await env.EMAIL.send({
    from: SENDER,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
    ...(message.headers ? { headers: message.headers } : {}),
  });
  return result.messageId;
}
