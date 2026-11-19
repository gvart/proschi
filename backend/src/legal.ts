import type { Ctx } from './context';
import { emailConfigured, sendEmail } from './email';
import { assertSameOrigin, HttpError, rateLimit } from './http';
import { errorText, log } from './log';
import { turnstileSiteKey, verifyTurnstile } from './turnstile';

/**
 * /impressum: the provider's details (§ 5 DDG, § 18 MStV), rendered from the
 * Worker's LEGAL_* secrets so they stay out of the repository and the built
 * site, and a public contact form, the direct channel § 5 DDG asks for next
 * to the email address. A message is emailed to LEGAL_EMAIL and never stored.
 * 404 until the name, address and email are all set.
 *
 *   GET  /impressum   the page (?sent=1: with the confirmation)
 *   POST /impressum   name, email, message, cf-turnstile-response; 303 back to the page
 */

const MAX_NAME = 100;
const MAX_EMAIL = 254;
const MIN_MESSAGE = 10;
const MAX_MESSAGE = 5000;
const MAX_BODY = 16 * 1024;
const EMAIL_FORMAT = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

interface Details {
  name: string;
  address: string[];
  email: string;
}

function detailsOf(ctx: Ctx): Details | undefined {
  const name = ctx.env.LEGAL_NAME?.trim();
  const address = ctx.env.LEGAL_ADDRESS?.split('|').map((line) => line.trim()).filter(Boolean);
  const email = ctx.env.LEGAL_EMAIL?.trim();
  return name && address?.length && email ? { name, address, email } : undefined;
}

const headers = (ctx: Ctx): Record<string, string> => ({
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  // Turnstile's script and frame come from challenges.cloudflare.com, as on the sign-in page.
  'Content-Security-Policy':
    "default-src 'none'; script-src https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'X-Request-Id': ctx.requestId,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  // Not no-referrer: with it the browser sends the form's POST with `Origin: null`, which assertSameOrigin refuses.
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Robots-Tag': 'noindex',
});

interface Form {
  name?: string;
  email?: string;
  message?: string;
  error?: string;
  sent?: boolean;
}

function contactForm(ctx: Ctx, form: Form): string {
  if (!emailConfigured(ctx.env)) return '';
  const siteKey = turnstileSiteKey(ctx.env);
  const notice = form.sent
    ? '<p class="notice" role="status">Danke, Ihre Nachricht wurde gesendet. <span lang="en">Thank you, your message was sent.</span></p>'
    : form.error
      ? `<p class="notice notice--error" role="alert">${escapeHtml(form.error)}</p>`
      : '';
  return `<h2 id="kontaktformular">Kontaktformular <span lang="en">/ Contact form</span></h2>
${notice}
<form method="post" action="/impressum#kontaktformular">
<label for="name">Name</label>
<input id="name" name="name" autocomplete="name" maxlength="${MAX_NAME}" value="${escapeHtml(form.name ?? '')}">
<label for="email">E-Mail <span lang="en">/ Email</span> (Pflichtfeld <span lang="en">/ required</span>)</label>
<input id="email" name="email" type="email" autocomplete="email" required maxlength="${MAX_EMAIL}" value="${escapeHtml(form.email ?? '')}">
<label for="message">Nachricht <span lang="en">/ Message</span> (Pflichtfeld <span lang="en">/ required</span>)</label>
<textarea id="message" name="message" rows="7" required minlength="${MIN_MESSAGE}" maxlength="${MAX_MESSAGE}">${escapeHtml(form.message ?? '')}</textarea>
<div class="trap" aria-hidden="true"><label for="website">Website</label><input id="website" name="website" tabindex="-1" autocomplete="off"></div>
${siteKey ? `<div class="cf-turnstile" data-sitekey="${escapeHtml(siteKey)}" data-action="contact"></div>\n<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>` : ''}
<p class="hint">Ihre Angaben werden nur zur Bearbeitung Ihrer Anfrage per E-Mail an uns übermittelt und nicht auf dem Server gespeichert. Mehr dazu in der <a href="/docs/datenschutz/">Datenschutzerklärung</a>.</p>
<button type="submit">Senden <span lang="en">/ Send</span></button>
</form>`;
}

function page(ctx: Ctx, details: Details, form: Form, status = 200): Response {
  const provider = [details.name, ...details.address].map(escapeHtml).join('<br>');
  const mail = escapeHtml(details.email);
  const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Impressum | Proschi</title>
<style>
:root { color-scheme: light dark; }
body { font: 16px/1.6 system-ui, sans-serif; max-width: 40rem; margin: 0 auto; padding: 2rem 1rem; }
h1 { font-size: 1.75rem; }
h2 { font-size: 1.125rem; margin-top: 2rem; }
label { display: block; margin-top: 1rem; font-weight: 600; }
input, textarea { box-sizing: border-box; width: 100%; padding: .5rem; font: inherit; }
button { margin-top: .5rem; padding: .5rem 1.25rem; font: inherit; font-weight: 600; cursor: pointer; }
.cf-turnstile { margin-top: 1rem; }
.hint { font-size: .875rem; }
.notice { padding: .75rem 1rem; border: 2px solid #15803d; border-radius: .375rem; }
.notice--error { border-color: #b91c1c; }
.trap { position: absolute; left: -9999px; }
</style>
</head>
<body>
<h1>Impressum</h1>
<p lang="en">Legal notice</p>
<h2>Angaben gemäß § 5 DDG</h2>
<p>${provider}</p>
<h2>Kontakt <span lang="en">/ Contact</span></h2>
<p>E-Mail: <a href="mailto:${mail}">${mail}</a></p>
${contactForm(ctx, form)}
<h2>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2>
<p>${provider}</p>
<p><a href="/docs/datenschutz/">Datenschutz</a> · <a href="/docs/agb/">AGB</a> · <a href="/">Proschi</a></p>
</body>
</html>
`;
  return new Response(html, { status, headers: headers(ctx) });
}

/** One line of a form field, safe for a mail header. */
const oneLine = (value: unknown): string => (typeof value === 'string' ? value.replace(/[\r\n\t]+/g, ' ').trim() : '');

async function sendMessage(request: Request, ctx: Ctx, details: Details, data: FormData, form: Required<Pick<Form, 'name' | 'email' | 'message'>>): Promise<void> {
  assertSameOrigin(request);
  await rateLimit(ctx.env.EMAIL_LIMITER, `contact:${ctx.ip}`, 'Zu viele Nachrichten, bitte warten Sie eine Minute. / Too many messages, please wait a minute.');
  if (form.name.length > MAX_NAME) throw new HttpError(400, 'Der Name ist zu lang. / The name is too long.');
  if (form.email.length > MAX_EMAIL || !EMAIL_FORMAT.test(form.email)) throw new HttpError(400, 'Bitte geben Sie eine gültige E-Mail-Adresse an. / Please enter a valid email address.');
  if (form.message.length < MIN_MESSAGE || form.message.length > MAX_MESSAGE) {
    throw new HttpError(400, `Die Nachricht muss ${MIN_MESSAGE} bis ${MAX_MESSAGE} Zeichen lang sein. / The message must be ${MIN_MESSAGE} to ${MAX_MESSAGE} characters long.`);
  }
  await verifyTurnstile(ctx, data.get('cf-turnstile-response'), 'contact');
  const from = form.name || form.email;
  await sendEmail(ctx.env, {
    to: details.email,
    replyTo: form.email,
    subject: `Proschi contact form: ${from}`,
    text: `From: ${from} <${form.email}>\n\n${form.message}\n`,
    html: `<p>From: ${escapeHtml(from)} &lt;${escapeHtml(form.email)}&gt;</p><p style="white-space:pre-wrap">${escapeHtml(form.message)}</p>`,
  });
}

/** GET and POST /impressum. */
export async function impressum(request: Request, ctx: Ctx): Promise<Response> {
  const details = detailsOf(ctx);
  if (!details) return new Response('Not found', { status: 404, headers: { ...headers(ctx), 'Content-Type': 'text/plain; charset=utf-8' } });
  if (request.method === 'GET' || request.method === 'HEAD') return page(ctx, details, { sent: new URL(request.url).searchParams.get('sent') === '1' });
  if (request.method !== 'POST' || !emailConfigured(ctx.env)) return new Response('Method not allowed', { status: 405, headers: { ...headers(ctx), 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' } });

  const sent = new Response(null, { status: 303, headers: { ...headers(ctx), Location: '/impressum?sent=1#kontaktformular' } });
  if (Number(request.headers.get('Content-Length') ?? 0) > MAX_BODY) return page(ctx, details, { error: 'Die Nachricht ist zu lang. / The message is too long.' }, 413);
  let data: FormData;
  try {
    data = await request.formData();
  } catch {
    return page(ctx, details, { error: 'Das Formular konnte nicht gelesen werden. / The form could not be read.' }, 400);
  }
  // Only bots fill the hidden field: they get the same answer as a person, and nothing is sent.
  if (oneLine(data.get('website'))) return sent;
  const message = data.get('message');
  const form = { name: oneLine(data.get('name')), email: oneLine(data.get('email')), message: typeof message === 'string' ? message.trim() : '' };
  try {
    await sendMessage(request, ctx, details, data, form);
    return sent;
  } catch (e) {
    if (e instanceof HttpError) return page(ctx, details, { ...form, error: e.message }, e.status);
    log('error', 'Contact form: sending failed', { requestId: ctx.requestId, error: errorText(e) });
    return page(ctx, details, { ...form, error: `Die Nachricht konnte nicht gesendet werden. Bitte schreiben Sie an ${details.email}. / The message could not be sent. Please write to ${details.email}.` }, 503);
  }
}
