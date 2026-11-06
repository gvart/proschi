import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { newShareToken, SHARE_TOKEN } from '../src/documentShares';
import { call, ORIGIN, resetDatabase, signedInUser } from './helpers';

/**
 * Live share links (src/documentShares.ts): only Pro makes them, for a synced
 * diagram; anyone with the link reads the diagram as it is now, without the
 * owner's identity; revoking, deleting the diagram or the account, or a
 * guessed token all answer 404; they are in the data export.
 */

const SOURCE = 'title "Checkout"\n\napi "API" [Go]\ndb "Orders" [Postgres]\napi -> db\n';

interface Share {
  token: string;
  url: string;
  createdAt: number;
}

const put = (token: string, id: string, source: string, baseVersion = 0) =>
  call(`/api/me/documents/${id}`, { method: 'PUT', token, body: { name: `${id}.proschi`, source, baseVersion, imports: { 'db.proschi': 'cache "C" [Redis]\n' } } });
const share = (token: string | undefined, id: string, method = 'POST') => call(`/api/me/documents/${id}/share`, { method, token });
const view = (token: string) => call(`/api/share/${token}`);

async function proUser(): Promise<{ id: string; token: string }> {
  const user = await signedInUser('Ada Owner');
  await env.DB.prepare("UPDATE users SET plan = 'pro' WHERE id = ?").bind(user.id).run();
  return user;
}

async function shared(token: string, id = 'doc1'): Promise<Share> {
  expect((await put(token, id, SOURCE)).status).toBe(200);
  const response = await share(token, id);
  expect(response.status).toBe(201);
  return ((await response.json()) as { share: Share }).share;
}

describe('live share links', () => {
  beforeEach(resetDatabase);

  it('make 128-bit base64url tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, newShareToken));
    expect(tokens.size).toBe(200);
    for (const t of tokens) expect(t).toMatch(SHARE_TOKEN);
  });

  it('need a session and a same-site request', async () => {
    expect((await share(undefined, 'doc1')).status).toBe(401);
    expect((await share(undefined, 'doc1', 'DELETE')).status).toBe(401);
    expect((await share(undefined, 'doc1', 'GET')).status).toBe(401);
    const { token } = await proUser();
    await put(token, 'doc1', SOURCE);
    const evil = await call('/api/me/documents/doc1/share', { method: 'POST', token, headers: { Origin: 'https://evil.example' } });
    expect(evil.status).toBe(403);
  });

  it('are Pro only: 402 plan_required on another plan', async () => {
    const { token } = await signedInUser();
    expect((await put(token, 'doc1', SOURCE)).status).toBe(200);
    const response = await share(token, 'doc1');
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ error: 'plan_required' });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM document_shares').first('n')).toBe(0);
  });

  it('need a synced, live diagram', async () => {
    const { token } = await proUser();
    expect((await share(token, 'nope')).status).toBe(404);
    await put(token, 'doc1', SOURCE);
    expect((await call('/api/me/documents/doc1?baseVersion=1', { method: 'DELETE', token })).status).toBe(200);
    expect((await share(token, 'doc1')).status).toBe(404);
  });

  it('give one live link per diagram, which the owner can read back', async () => {
    const { token } = await proUser();
    const first = await shared(token);
    expect(first.url).toBe(`${ORIGIN}/share/${first.token}`);
    const again = await share(token, 'doc1');
    expect(again.status).toBe(200);
    expect(((await again.json()) as { share: Share }).share).toEqual(first);
    const listed = await share(token, 'doc1', 'GET');
    expect(await listed.json()).toEqual({ share: first });
  });

  it('show the diagram as it is now to anyone, without the owner', async () => {
    const { id: ownerId, token } = await proUser();
    const link = await shared(token);
    const response = await view(link.token);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ name: 'doc1.proschi', title: 'Checkout', source: SOURCE, imports: { 'db.proschi': 'cache "C" [Redis]\n' }, updatedAt: expect.any(Number) });
    const text = JSON.stringify(body);
    expect(text).not.toContain(ownerId);
    expect(text).not.toContain('Ada Owner');
    expect(text).not.toContain('"doc1"');

    // A later save shows at the same link.
    expect((await put(token, 'doc1', 'title "Checkout v2"\n', 1)).status).toBe(200);
    expect(((await (await view(link.token)).json()) as { title: string }).title).toBe('Checkout v2');
  });

  it('answer 404 to a guessed or malformed token', async () => {
    const { token } = await proUser();
    await shared(token);
    expect((await view(newShareToken())).status).toBe(404);
    expect((await view('AAAAAAAAAAAAAAAAAAAAAA')).status).toBe(404);
    expect((await view('short')).status).toBe(404);
    expect((await view(`${'A'.repeat(21)}%27`)).status).toBe(404);
  });

  it('stop working once revoked, and sharing again gives a new token', async () => {
    const { token } = await proUser();
    const link = await shared(token);
    expect((await share(token, 'doc1', 'DELETE')).status).toBe(204);
    expect((await view(link.token)).status).toBe(404);
    expect((await share(token, 'doc1', 'DELETE')).status).toBe(404);
    expect(await (await share(token, 'doc1', 'GET')).json()).toEqual({ share: null });
    const next = await share(token, 'doc1');
    expect(next.status).toBe(201);
    const fresh = ((await next.json()) as { share: Share }).share;
    expect(fresh.token).not.toBe(link.token);
    expect((await view(fresh.token)).status).toBe(200);
    expect((await view(link.token)).status).toBe(404);
  });

  it("only the owner revokes, and another user's link is out of reach", async () => {
    const owner = await proUser();
    const link = await shared(owner.token);
    const other = await proUser();
    expect((await share(other.token, 'doc1', 'DELETE')).status).toBe(404);
    expect(await (await share(other.token, 'doc1', 'GET')).json()).toEqual({ share: null });
    expect((await view(link.token)).status).toBe(200);
  });

  it('answer 404 when the diagram is deleted, the owner leaves Pro or is blocked', async () => {
    const { id, token } = await proUser();
    const link = await shared(token);
    await env.DB.prepare("UPDATE users SET plan = 'free' WHERE id = ?").bind(id).run();
    expect((await view(link.token)).status).toBe(404);
    await env.DB.prepare("UPDATE users SET plan = 'pro' WHERE id = ?").bind(id).run();
    expect((await view(link.token)).status).toBe(200);
    await env.DB.prepare('UPDATE users SET blocked_at = 1 WHERE id = ?').bind(id).run();
    expect((await view(link.token)).status).toBe(404);
    await env.DB.prepare('UPDATE users SET blocked_at = NULL WHERE id = ?').bind(id).run();
    expect((await call('/api/me/documents/doc1?baseVersion=1', { method: 'DELETE', token })).status).toBe(200);
    expect((await view(link.token)).status).toBe(404);
  });

  it('go with "Delete my cloud copies"', async () => {
    const { token } = await proUser();
    const link = await shared(token);
    expect((await call('/api/me/documents', { method: 'DELETE', token })).status).toBe(200);
    expect((await view(link.token)).status).toBe(404);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM document_shares').first('n')).toBe(0);
  });

  it('are in the data export and go with the account', async () => {
    const { token } = await proUser();
    const link = await shared(token);
    await share(token, 'doc1', 'DELETE');
    const live = await share(token, 'doc1');
    const second = ((await live.json()) as { share: Share }).share;
    const exported = (await (await call('/api/me/export', { token })).json()) as { documentShares: Record<string, unknown>[] };
    expect(exported.documentShares).toEqual([
      { url: link.url, documentId: 'doc1', createdAt: link.createdAt, revokedAt: expect.any(Number) },
      { url: second.url, documentId: 'doc1', createdAt: second.createdAt, revokedAt: null },
    ]);
    expect((await call('/api/me', { method: 'DELETE', token })).status).toBe(204);
    expect((await view(second.token)).status).toBe(404);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM document_shares').first('n')).toBe(0);
  });

  it('serve the share page at /share/<token>, noindex', async () => {
    const response = await call(`/share/${newShareToken()}`);
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
  });
});
