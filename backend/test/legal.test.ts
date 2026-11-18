import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Ctx } from '../src/context';
import type { Env } from '../src/env';
import { impressum } from '../src/legal';

const LEGAL = { LEGAL_NAME: 'Erika Muster', LEGAL_ADDRESS: 'c/o Service | Musterweg 1 | 12345 Musterstadt', LEGAL_EMAIL: 'kontakt@example.com' };
const URL = 'https://proschi.test/impressum';
const VALID = { name: 'Ada', email: 'ada@example.com', message: 'A question about the service.' };

function setup(vars: Partial<Env> = {}, { allowed = true, failSend = false } = {}) {
  const sent: Record<string, unknown>[] = [];
  const EMAIL = {
    async send(message: Record<string, unknown>) {
      if (failSend) throw new Error('refused');
      sent.push(message);
      return { messageId: 'm1' };
    },
  };
  const EMAIL_LIMITER = { limit: async () => ({ success: allowed }) };
  const ctx = { env: { ...LEGAL, EMAIL, EMAIL_LIMITER, ...vars }, ip: '192.0.2.1', requestId: 'req-1', setCookies: [] } as unknown as Ctx;
  return { ctx, sent };
}

const post = (fields: Record<string, string>, origin = 'https://proschi.test') => {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return new Request(URL, { method: 'POST', body, headers: { Origin: origin } });
};

afterEach(() => vi.restoreAllMocks());

describe('GET /impressum', () => {
  it('renders the provider from the secrets, one address part per line, and the form', async () => {
    const response = await impressum(new Request(URL), setup().ctx);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('Erika Muster<br>c/o Service<br>Musterweg 1<br>12345 Musterstadt');
    expect(html).toContain('href="mailto:kontakt@example.com"');
    expect(html).toContain('<form method="post"');
    expect(html).not.toContain('Telefon');
  });

  it.each(['LEGAL_NAME', 'LEGAL_ADDRESS', 'LEGAL_EMAIL'] as const)('answers 404 without %s', async (key) => {
    expect((await impressum(new Request(URL), setup({ [key]: ' ' }).ctx)).status).toBe(404);
  });

  it('escapes the values', async () => {
    const html = await (await impressum(new Request(URL), setup({ LEGAL_NAME: '<script>x</script>' }).ctx)).text();
    expect(html).not.toContain('<script>x');
    expect(html).toContain('&lt;script&gt;');
  });

  it('shows the Turnstile widget only with both keys, and allows its script', async () => {
    const on = await impressum(new Request(URL), setup({ TURNSTILE_SITE_KEY: 'site-key', TURNSTILE_SECRET_KEY: 'secret' }).ctx);
    expect(await on.text()).toContain('data-sitekey="site-key"');
    expect(on.headers.get('Content-Security-Policy')).toContain('script-src https://challenges.cloudflare.com');
    expect(await (await impressum(new Request(URL), setup().ctx)).text()).not.toContain('data-sitekey');
  });

  it('keeps the form POST same-origin checkable: never no-referrer', async () => {
    expect((await impressum(new Request(URL), setup().ctx)).headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('confirms a sent message', async () => {
    expect(await (await impressum(new Request(`${URL}?sent=1`), setup().ctx)).text()).toContain('Ihre Nachricht wurde gesendet');
  });
});

describe('POST /impressum', () => {
  it('emails the message to the provider with the sender as reply-to, then redirects', async () => {
    const { ctx, sent } = setup();
    const response = await impressum(post(VALID), ctx);
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/impressum?sent=1#kontaktformular');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'kontakt@example.com', replyTo: 'ada@example.com', subject: 'Proschi contact form: Ada' });
    expect(sent[0].text).toContain(VALID.message);
  });

  it('keeps line breaks out of the subject and escapes the HTML body', async () => {
    const { ctx, sent } = setup();
    await impressum(post({ ...VALID, name: 'Ada\r\nBcc: x@example.com', message: '<b>hello</b> there' }), ctx);
    expect(sent[0].subject).toBe('Proschi contact form: Ada Bcc: x@example.com');
    expect(sent[0].html).toContain('&lt;b&gt;hello&lt;/b&gt;');
  });

  it('answers a filled hidden field like a success, and sends nothing', async () => {
    const { ctx, sent } = setup();
    expect((await impressum(post({ ...VALID, website: 'https://spam.example' }), ctx)).status).toBe(303);
    expect(sent).toHaveLength(0);
  });

  it.each([
    ['a bad address', { email: 'not-an-address' }],
    ['a short message', { message: 'short' }],
    ['a long message', { message: 'x'.repeat(5001) }],
    ['a long name', { name: 'x'.repeat(101) }],
  ])('refuses %s, keeps what was typed and sends nothing', async (_, change) => {
    const { ctx, sent } = setup();
    const response = await impressum(post({ ...VALID, ...change }), ctx);
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('role="alert"');
    expect(sent).toHaveLength(0);
  });

  it('refuses another site', async () => {
    const { ctx, sent } = setup();
    expect((await impressum(post(VALID, 'https://evil.example'), ctx)).status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it('answers 429 past the rate limit', async () => {
    const { ctx, sent } = setup({}, { allowed: false });
    expect((await impressum(post(VALID), ctx)).status).toBe(429);
    expect(sent).toHaveLength(0);
  });

  it('refuses a failed human check', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ success: false }));
    const { ctx, sent } = setup({ TURNSTILE_SITE_KEY: 'site-key', TURNSTILE_SECRET_KEY: 'secret' });
    expect((await impressum(post({ ...VALID, 'cf-turnstile-response': 'bad' }), ctx)).status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it('sends after a passed human check', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ success: true, action: 'contact' }));
    const { ctx, sent } = setup({ TURNSTILE_SITE_KEY: 'site-key', TURNSTILE_SECRET_KEY: 'secret' });
    expect((await impressum(post({ ...VALID, 'cf-turnstile-response': 'good' }), ctx)).status).toBe(303);
    expect(sent).toHaveLength(1);
  });

  it('keeps the message and names the address when sending fails', async () => {
    const response = await impressum(post(VALID), setup({}, { failSend: true }).ctx);
    const html = await response.text();
    expect(response.status).toBe(503);
    expect(html).toContain(VALID.message);
    expect(html).toContain('Bitte schreiben Sie an kontakt@example.com');
  });
});
