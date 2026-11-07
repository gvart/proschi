import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_COOKIE } from '../src/adminAuth';
import { SESSION_COOKIE } from '../src/auth';
import { MAX_FILE, PER_HOUR, sniffImage } from '../src/feedback';
import { call, ORIGIN, resetDatabase, signedInUser } from './helpers';
import { createPasskey } from './webauthn';

const SETUP_TOKEN = 'test-admin-setup-token-0123456789';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 1, 2]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 8, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2]);

/** POST /api/feedback as the site's page sends it: multipart, with the session cookie. */
function send(token: string | undefined, fields: Record<string, string>, files: { bytes: Uint8Array; type: string; name?: string }[] = []): Promise<Response> {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  for (const f of files) form.append('screenshot', new File([f.bytes], f.name ?? 'shot.png', { type: f.type }));
  const headers = new Headers({ Origin: ORIGIN, 'CF-Connecting-IP': `test-${crypto.randomUUID()}`, 'User-Agent': 'Mozilla/5.0 (Macintosh) Test/1.0' });
  if (token) headers.set('Cookie', `${SESSION_COOKIE}=${token}`);
  return (exports as unknown as { default: Fetcher }).default.fetch(new Request(`${ORIGIN}/api/feedback`, { method: 'POST', headers, body: form }));
}

function adminCall(path: string, admin: string | undefined, init: Parameters<typeof call>[1] = {}) {
  const headers = new Headers(init.headers);
  if (admin) headers.append('Cookie', `${ADMIN_COOKIE}=${admin}`);
  return call(path, { ...init, headers });
}

async function setUpAdmin(): Promise<string> {
  const passkey = await createPasskey();
  const options = (await (await call('/api/admin/setup/options', { method: 'POST', body: { setupToken: SETUP_TOKEN } })).json()) as { challenge: string; rp: { id: string } };
  const response = await call('/api/admin/setup', { method: 'POST', body: { setupToken: SETUP_TOKEN, name: 'Laptop', response: await passkey.register(options, ORIGIN) } });
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${ADMIN_COOKIE}=`))!;
  return cookie.split(';')[0].split('=')[1];
}

const bucketKeys = async () => (await env.FEEDBACK_BUCKET!.list()).objects.map((o) => o.key).sort();

async function clearBucket() {
  const keys = await bucketKeys();
  if (keys.length) await env.FEEDBACK_BUCKET!.delete(keys);
}

const base = { kind: 'bug', subject: 'Canvas freezes', message: 'It froze after I dragged a node.', path: '/app/#x', viewport: '1440x900' };

describe('sending feedback', () => {
  beforeEach(async () => {
    await resetDatabase();
    await clearBucket();
  });

  it('refuses a signed-out sender', async () => {
    expect((await send(undefined, base)).status).toBe(401);
  });

  it('stores a message with its context, without a diagram or screenshot', async () => {
    const { id: userId, token } = await signedInUser();
    const response = await send(token, base);
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    const row = await env.DB.prepare('SELECT * FROM feedback_messages WHERE id = ?').bind(id).first<Record<string, string | null>>();
    expect(row).toMatchObject({ user_id: userId, kind: 'bug', subject: 'Canvas freezes', message: 'It froze after I dragged a node.', diagram: null, status: 'new' });
    expect(JSON.parse(row!.context!)).toMatchObject({ path: '/app/#x', viewport: '1440x900', userAgent: 'Mozilla/5.0 (Macintosh) Test/1.0', plan: 'free' });
    expect(await bucketKeys()).toEqual([]);
  });

  it('stores the diagram and screenshots, checking their type by their bytes', async () => {
    const { token } = await signedInUser();
    const response = await send(token, { ...base, diagram: 'service api' }, [
      { bytes: PNG, type: 'image/png' },
      { bytes: JPEG, type: 'image/png' },
      { bytes: WEBP, type: 'application/octet-stream' },
    ]);
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    const files = (await env.DB.prepare('SELECT key, type, bytes FROM feedback_files WHERE message_id = ? ORDER BY position').bind(id).all<{ key: string; type: string; bytes: number }>()).results;
    expect(files.map((f) => f.type)).toEqual(['image/png', 'image/jpeg', 'image/webp']);
    expect(files.map((f) => f.bytes)).toEqual([PNG.length, JPEG.length, WEBP.length]);
    expect(await bucketKeys()).toEqual(files.map((f) => f.key).sort());
    expect(files.every((f) => /^[A-Za-z0-9_-]{22}$/.test(f.key))).toBe(true);
    expect((await env.DB.prepare('SELECT diagram FROM feedback_messages WHERE id = ?').bind(id).first<{ diagram: string }>())!.diagram).toBe('service api');
  });

  it('refuses what is not a PNG, JPEG or WebP, whatever its MIME type says', async () => {
    const { token } = await signedInUser();
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect((await send(token, base, [{ bytes: svg, type: 'image/png' }])).status).toBe(415);
    expect((await send(token, base, [{ bytes: new TextEncoder().encode('<html>'), type: 'image/jpeg' }])).status).toBe(415);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM feedback_messages').first('n')).toBe(0);
    expect(await bucketKeys()).toEqual([]);
  });

  it('validates the type, the message and the sizes', async () => {
    const { token } = await signedInUser();
    expect((await send(token, { ...base, kind: 'praise' })).status).toBe(400);
    expect((await send(token, { ...base, message: '   ' })).status).toBe(400);
    expect((await send(token, { ...base, message: 'x'.repeat(5001) })).status).toBe(400);
    expect((await send(token, { ...base, subject: 'x'.repeat(201) })).status).toBe(400);
    expect((await send(token, { ...base, diagram: 'x'.repeat(64 * 1024 + 1) })).status).toBe(413);
    const four = Array.from({ length: 4 }, () => ({ bytes: PNG, type: 'image/png' }));
    expect((await send(token, base, four)).status).toBe(400);
    const big = new Uint8Array(MAX_FILE + 1);
    big.set(PNG);
    expect((await send(token, base, [{ bytes: big, type: 'image/png' }])).status).toBe(413);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM feedback_messages').first('n')).toBe(0);
    expect(await bucketKeys()).toEqual([]);
  });

  it(`allows ${PER_HOUR} messages an hour`, async () => {
    const { token } = await signedInUser();
    for (let i = 0; i < PER_HOUR; i++) expect((await send(token, base)).status).toBe(201);
    const refused = await send(token, base);
    expect(refused.status).toBe(429);
    expect(refused.headers.get('Retry-After')).toBe('3600');
    // Another user is not affected.
    expect((await send((await signedInUser()).token, base)).status).toBe(201);
  });

  it('allows 20 messages a day', async () => {
    const { id, token } = await signedInUser();
    const t = Math.floor(Date.now() / 1000);
    await env.DB.batch(
      Array.from({ length: 20 }, (_, i) =>
        env.DB.prepare("INSERT INTO feedback_messages (id, user_id, kind, message, context, created_at, updated_at) VALUES (?, ?, 'other', 'hi', '{}', ?, ?)").bind(
          crypto.randomUUID(),
          id,
          t - 7200 - i,
          t - 7200 - i,
        ),
      ),
    );
    expect((await send(token, base)).status).toBe(429);
  });

  it('is in Download my data without the operator note, and goes with the account', async () => {
    const { id: userId, token } = await signedInUser();
    const { id } = (await (await send(token, base, [{ bytes: PNG, type: 'image/png' }])).json()) as { id: string };
    await env.DB.prepare("UPDATE feedback_messages SET note = 'secret note' WHERE id = ?").bind(id).run();
    const exported = (await (await call('/api/me/export', { token })).json()) as { feedback: Record<string, unknown>[] };
    expect(exported.feedback).toEqual([
      expect.objectContaining({ id, kind: 'bug', subject: 'Canvas freezes', message: base.message, status: 'new', screenshots: [{ type: 'image/png', bytes: PNG.length }] }),
    ]);
    expect(JSON.stringify(exported)).not.toContain('secret note');
    expect((await bucketKeys()).length).toBe(1);

    expect((await call('/api/me', { method: 'DELETE', token })).status).toBe(204);
    expect(await bucketKeys()).toEqual([]);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM feedback_messages WHERE user_id = ?').bind(userId).first('n')).toBe(0);
  });
});

describe('the admin inbox', () => {
  beforeEach(async () => {
    await resetDatabase();
    await clearBucket();
  });

  async function message(fields = {}, files: { bytes: Uint8Array; type: string }[] = []) {
    const user = await signedInUser('Ada');
    const { id } = (await (await send(user.token, { ...base, ...fields }, files)).json()) as { id: string };
    return { ...user, messageId: id };
  }

  it('is admin only', async () => {
    const { messageId, token } = await message();
    for (const [method, path] of [
      ['GET', '/api/admin/feedback'],
      ['GET', `/api/admin/feedback/${messageId}`],
      ['PATCH', `/api/admin/feedback/${messageId}`],
      ['DELETE', `/api/admin/feedback/${messageId}`],
      ['GET', `/api/admin/feedback/${messageId}/files/AAAAAAAAAAAAAAAAAAAAAA`],
    ]) {
      // A user's session is not an admin's.
      const response = await call(path, { method, token, ...(method === 'GET' ? {} : { body: { status: 'done', reason: 'x' } }) });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
  });

  it('lists with filters, counts unread and open, and opens one with its sender, context and screenshots', async () => {
    const admin = await setUpAdmin();
    const first = await message({}, [{ bytes: PNG, type: 'image/png' }]);
    await env.DB.prepare("INSERT INTO email_logins (user_id, email, normalized, password_hash, confirmed_at, created_at) VALUES (?, 'ada@example.com', 'ada@example.com', 'x', 1, 1)").bind(first.id).run();
    await message({ kind: 'proposal', subject: 'Dark mode for exports', message: 'Please' });

    const list = (await (await adminCall('/api/admin/feedback', admin)).json()) as { total: number; counts: Record<string, number>; messages: { id: string; kind: string; read: boolean; screenshots: number }[] };
    expect(list.total).toBe(2);
    expect(list.counts).toEqual({ unread: 2, open: 2, new: 2, inProgress: 0, done: 0 });
    expect(list.messages.find((m) => m.id === first.messageId)).toMatchObject({ kind: 'bug', read: false, screenshots: 1 });
    expect(((await (await adminCall('/api/admin/feedback?kind=proposal', admin)).json()) as { total: number }).total).toBe(1);
    expect(((await (await adminCall('/api/admin/feedback?q=exports', admin)).json()) as { total: number }).total).toBe(1);
    expect(((await (await adminCall('/api/admin/feedback?status=done', admin)).json()) as { total: number }).total).toBe(0);
    expect((await adminCall('/api/admin/feedback?status=junk', admin)).status).toBe(400);

    const detail = (await (await adminCall(`/api/admin/feedback/${first.messageId}`, admin)).json()) as {
      sender: { id: string; email: string | null };
      context: { viewport: string };
      screenshots: { key: string; type: string }[];
    };
    expect(detail.sender).toMatchObject({ id: first.id, email: 'ada@example.com' });
    expect(detail.context.viewport).toBe('1440x900');
    const file = await adminCall(`/api/admin/feedback/${first.messageId}/files/${detail.screenshots[0].key}`, admin);
    expect(file.status).toBe(200);
    expect(file.headers.get('Content-Type')).toBe('image/png');
    expect(file.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PNG);
    // A key of another message is not served through this one.
    const other = list.messages.find((m) => m.id !== first.messageId)!.id;
    expect((await adminCall(`/api/admin/feedback/${other}/files/${detail.screenshots[0].key}`, admin)).status).toBe(404);

    const after = (await (await adminCall('/api/admin/feedback', admin)).json()) as { counts: Record<string, number> };
    expect(after.counts.unread).toBe(1);
  });

  it("shows the address GitHub or Google gave when there is no email sign-in, and none without either", async () => {
    const admin = await setUpAdmin();
    const withContact = await message();
    await env.DB.prepare("INSERT INTO contact_emails (user_id, email, provider, updated_at) VALUES (?, 'gh@example.com', 'github', 1)").bind(withContact.id).run();
    const without = await message();
    const email = async (id: string) => ((await (await adminCall(`/api/admin/feedback/${id}`, admin)).json()) as { sender: { email: string | null } }).sender.email;
    expect(await email(withContact.messageId)).toBe('gh@example.com');
    expect(await email(without.messageId)).toBeNull();
  });

  it('keeps the text as written, for plain-text rendering', async () => {
    const admin = await setUpAdmin();
    const html = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const { messageId } = await message({ subject: html, message: html });
    const response = await adminCall(`/api/admin/feedback/${messageId}`, admin);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(await response.json()).toMatchObject({ subject: html, message: html });
  });

  it('changes the status and the note, in the audit log', async () => {
    const admin = await setUpAdmin();
    const { messageId } = await message();
    const patched = await adminCall(`/api/admin/feedback/${messageId}`, admin, { method: 'PATCH', body: { status: 'in_progress', note: 'Repro on Safari' } });
    expect(await patched.json()).toEqual({ status: 'in_progress', note: 'Repro on Safari' });
    expect((await adminCall(`/api/admin/feedback/${messageId}`, admin, { method: 'PATCH', body: { status: 'closed' } })).status).toBe(400);
    const audit = await env.DB.prepare("SELECT target, detail FROM admin_audit WHERE action = 'feedback.update'").all<{ target: string; detail: string }>();
    expect(audit.results).toHaveLength(1);
    expect(audit.results[0].target).toBe(messageId);
    expect(JSON.parse(audit.results[0].detail)).toMatchObject({ status: { from: 'new', to: 'in_progress' }, note: { chars: 15 } });
    const list = (await (await adminCall('/api/admin/feedback?status=open', admin)).json()) as { total: number; counts: { inProgress: number } };
    expect(list).toMatchObject({ total: 1, counts: { inProgress: 1 } });
  });

  it('deletes a message with its screenshots, only with a reason', async () => {
    const admin = await setUpAdmin();
    const { messageId } = await message({}, [{ bytes: PNG, type: 'image/png' }, { bytes: JPEG, type: 'image/jpeg' }]);
    expect((await bucketKeys()).length).toBe(2);
    expect((await adminCall(`/api/admin/feedback/${messageId}`, admin, { method: 'DELETE', body: {} })).status).toBe(400);
    expect((await adminCall(`/api/admin/feedback/${messageId}`, admin, { method: 'DELETE', body: { reason: 'Spam' } })).status).toBe(204);
    expect(await bucketKeys()).toEqual([]);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM feedback_files').first('n')).toBe(0);
    const audit = await env.DB.prepare("SELECT detail FROM admin_audit WHERE action = 'feedback.delete'").first<{ detail: string }>();
    expect(JSON.parse(audit!.detail)).toMatchObject({ reason: 'Spam', kind: 'bug' });
    expect((await adminCall(`/api/admin/feedback/${messageId}`, admin)).status).toBe(404);
  });

  it("deletes the screenshots when the admin deletes the account", async () => {
    const admin = await setUpAdmin();
    const { id } = await message({}, [{ bytes: PNG, type: 'image/png' }]);
    expect((await adminCall(`/api/admin/users/${id}`, admin, { method: 'DELETE' })).status).toBe(204);
    expect(await bucketKeys()).toEqual([]);
  });
});

describe('sniffImage', () => {
  it('knows PNG, JPEG and WebP by their first bytes', () => {
    expect(sniffImage(PNG)).toBe('image/png');
    expect(sniffImage(JPEG)).toBe('image/jpeg');
    expect(sniffImage(WEBP)).toBe('image/webp');
    expect(sniffImage(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]))).toBeUndefined();
    expect(sniffImage(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBeUndefined();
    expect(sniffImage(new Uint8Array())).toBeUndefined();
  });
});
