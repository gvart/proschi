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
 * reminders"). Should the API change, only this file changes.
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

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A paragraph of text, or a link button: what the emails are made of. */
export type Block = string | { link: string; label: string };

/**
 * The plain-text and HTML bodies of an email from the same blocks, with the
 * footer (why the reader got it, and how to stop) under a rule.
 */
export function render(blocks: Block[], footer: Block[]): { text: string; html: string } {
  const textOf = (b: Block) => (typeof b === 'string' ? b : `${b.label}: ${b.link}`);
  const text = [...blocks.map(textOf), '--', ...footer.map(textOf)].join('\n\n') + '\n';
  const htmlOf = (b: Block, small: boolean) =>
    typeof b === 'string'
      ? `<p style="margin:0 0 ${small ? 8 : 16}px;${small ? 'font-size:13px;color:#555;' : ''}">${escapeHtml(b)}</p>`
      : small
        ? `<p style="margin:0 0 8px;font-size:13px;color:#555;"><a href="${escapeHtml(b.link)}" style="color:#555;">${escapeHtml(b.label)}</a></p>`
        : `<p style="margin:0 0 16px;"><a href="${escapeHtml(b.link)}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">${escapeHtml(b.label)}</a></p>`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#fff;color:#111;font:15px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;">
<p style="margin:0 0 16px;font-weight:800;font-size:18px;">Proschi</p>
${blocks.map((b) => htmlOf(b, false)).join('\n')}
<hr style="border:0;border-top:1px solid #ddd;margin:24px 0 16px;">
${footer.map((b) => htmlOf(b, true)).join('\n')}
</div></body></html>`;
  return { text, html };
}
