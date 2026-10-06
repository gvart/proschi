import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { checkPng, MAX_SHARE_DOC, MAX_SHARES_PER_USER, newShareId, SHARE_ID, shareIdOf } from '../src/shares';
import { call, ORIGIN, resetDatabase, signedInUser, WINDOW_TIMEOUT, withinOneWindow } from './helpers';

/**
 * Short links (src/shares.ts): only signed-in users create them, with caps
 * on the document and the preview, which must be a real PNG; anyone can open
 * one; only the owner deletes one; they are in the data export and go with
 * the account; /s/<id> carries the preview's meta tags.
 */

/** A real 1×1 PNG. */
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const SOURCE = 'title "Checkout & <Payments>"\n\napi "API" [Go]\ndb "Orders" [Postgres]\napi -> db\n';

/** A PNG's signature, IHDR and IEND around `filler` bytes (CRCs left zero: the Worker does not decode the image). */
function fakePng(width: number, height: number, filler = 0): Uint8Array {
  const bytes = new Uint8Array(8 + 25 + filler + 12);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([...'IHDR'].map((c) => c.charCodeAt(0)), 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  bytes.set([...'IEND'].map((c) => c.charCodeAt(0)), bytes.length - 8);
  return bytes;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

const create = (token: string | undefined, body: unknown, headers?: HeadersInit) => call('/api/shares', { method: 'POST', token, body, headers });

async function createOk(token: string, body: Record<string, unknown> = { source: SOURCE, image: PNG_1X1 }) {
  const response = await create(token, body);
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; url: string; title: string; hasImage: boolean; createdAt: number };
}

describe('short links', () => {
  beforeEach(resetDatabase);

  it('makes unguessable base62 ids', () => {
    const ids = new Set(Array.from({ length: 200 }, newShareId));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(SHARE_ID);
  });

  it('needs a signed-in user and a same-site request', async () => {
    expect((await create(undefined, { source: SOURCE })).status).toBe(401);
    const { token } = await signedInUser();
    expect((await create(token, { source: SOURCE }, { Origin: 'https://evil.example' })).status).toBe(403);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM shares').first('n')).toBe(0);
  });

  it('stores the diagram, its imports and the preview, and anyone can read it back', async () => {
    const { token } = await signedInUser();
    const imports = { 'shared.proschi': 'cache "Cache" [Redis]\n' };
    const share = await createOk(token, { source: SOURCE, imports, image: `data:image/png;base64,${PNG_1X1}` });
    expect(share).toMatchObject({ title: 'Checkout & <Payments>', hasImage: true, url: `${ORIGIN}/s/${share.id}` });

    const read = await call(`/api/shares/${share.id}`);
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ id: share.id, title: 'Checkout & <Payments>', source: SOURCE, imports, hasImage: true, createdAt: share.createdAt });
    expect((await call('/api/shares/AAAAAAAAAA')).status).toBe(404);
    expect((await call('/api/shares/not-an-id')).status).toBe(404);
  });

  it('refuses documents past 64 KiB, malformed imports and empty sources', async () => {
    const { token } = await signedInUser();
    expect((await create(token, { source: 'x'.repeat(MAX_SHARE_DOC + 1) })).status).toBe(413);
    // The imports count toward the same budget.
    expect((await create(token, { source: 'x'.repeat(MAX_SHARE_DOC - 100), imports: { 'a.proschi': 'y'.repeat(200) } })).status).toBe(413);
    expect((await create(token, { source: SOURCE, imports: { 'a.proschi': 42 } })).status).toBe(400);
    expect((await create(token, { source: SOURCE, imports: ['a'] })).status).toBe(400);
    expect((await create(token, { source: '  ' })).status).toBe(400);
    expect((await create(token, { source: 'x'.repeat(MAX_SHARE_DOC) })).status).toBe(201);
  });

  it('accepts only a complete PNG of sane size up to 300 KB', async () => {
    const { token } = await signedInUser();
    expect(checkPng(fakePng(1200, 630))).toEqual({ width: 1200, height: 630 });
    expect((await create(token, { source: SOURCE, image: base64(fakePng(1200, 630)) })).status).toBe(201);
    const refused = async (image: unknown, status: number) => expect((await create(token, { source: SOURCE, image })).status).toBe(status);
    await refused(btoa('GIF89a not a png at all, padded out to some length...'), 400);
    await refused(base64(fakePng(5000, 10)), 400);
    await refused(base64(fakePng(0, 10)), 400);
    await refused(base64(fakePng(100, 100).slice(0, -12)), 400);
    await refused('%%% not base64', 400);
    await refused(42, 400);
    await refused(base64(fakePng(1200, 630, 300 * 1024)), 413);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM shares').first('n')).toBe(1);
  });

  it(
    'limits how fast a user makes them',
    async () => {
      const { token } = await signedInUser();
      await withinOneWindow();
      const statuses: number[] = [];
      for (let i = 0; i < 11; i++) statuses.push((await create(token, { source: SOURCE })).status);
      expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
      expect(statuses[10]).toBe(429);
    },
    WINDOW_TIMEOUT,
  );

  it(`keeps at most ${MAX_SHARES_PER_USER} per user`, async () => {
    const { id, token } = await signedInUser();
    await env.DB.batch(
      Array.from({ length: MAX_SHARES_PER_USER }, (_, i) =>
        env.DB.prepare("INSERT INTO shares (id, user_id, title, source, created_at) VALUES (?, ?, 'T', 'a', ?)").bind(`Fill${String(i).padStart(6, '0')}`, id, i),
      ),
    );
    expect((await create(token, { source: SOURCE })).status).toBe(409);
  });

  it('lists the owner’s shares, and only the owner deletes one', async () => {
    const owner = await signedInUser();
    const other = await signedInUser();
    const first = await createOk(owner.token);
    const second = await createOk(owner.token, { source: 'title Second\n' });

    const list = (await (await call('/api/me/shares', { token: owner.token })).json()) as { shares: { id: string; title: string; hasImage: boolean }[] };
    expect(list.shares.map((s) => s.id).sort()).toEqual([first.id, second.id].sort());
    expect(list.shares.find((s) => s.id === second.id)).toMatchObject({ title: 'Second', hasImage: false });
    expect(((await (await call('/api/me/shares', { token: other.token })).json()) as { shares: unknown[] }).shares).toEqual([]);
    expect((await call('/api/me/shares')).status).toBe(401);

    expect((await call(`/api/shares/${first.id}`, { method: 'DELETE', token: other.token })).status).toBe(404);
    expect((await call(`/api/shares/${first.id}`, { method: 'DELETE' })).status).toBe(401);
    expect((await call(`/api/shares/${first.id}`, { method: 'DELETE', token: owner.token })).status).toBe(204);
    expect((await call(`/api/shares/${first.id}`)).status).toBe(404);
    expect((await call(`/s/${first.id}`)).status).toBe(404);
  });

  it('is in the data export and goes with the account', async () => {
    const { id, token } = await signedInUser();
    const share = await createOk(token);
    const exported = (await (await call('/api/me/export', { token })).json()) as { shares: Record<string, unknown>[] };
    expect(exported.shares).toEqual([
      expect.objectContaining({ id: share.id, url: share.url, title: 'Checkout & <Payments>', source: SOURCE, imageUrl: `${share.url}.png`, imageWidth: 1, imageHeight: 1 }),
    ]);
    expect((await call('/api/me', { method: 'DELETE', token })).status).toBe(204);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM shares WHERE user_id = ?').bind(id).first('n')).toBe(0);
    expect((await call(`/s/${share.id}.png`, { redirect: 'manual' })).status).toBe(302);
  });

  it('serves /s/<id> with the preview’s meta tags and a way into the editor', async () => {
    const { token } = await signedInUser();
    const share = await createOk(token);
    const page = await call(`/s/${share.id}`);
    expect(page.status).toBe(200);
    expect(page.headers.get('Content-Type')).toMatch(/^text\/html/);
    const html = await page.text();
    const title = 'Checkout &amp; &lt;Payments&gt;';
    expect(html).toContain(`<title>${title} · Proschi</title>`);
    expect(html).toContain(`<meta property="og:title" content="${title}">`);
    expect(html).toContain('<meta property="og:description" content="');
    expect(html).toContain(`<meta property="og:image" content="${ORIGIN}/s/${share.id}.png">`);
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/s/${share.id}">`);
    expect(html).toContain(`<meta http-equiv="refresh" content="0; url=/app/?s=${share.id}">`);
    expect(html).toContain('application/json+oembed');
    expect(html).not.toContain('<Payments>');

    // HEAD, as some link-preview bots send it.
    expect((await call(`/s/${share.id}`, { method: 'HEAD' })).status).toBe(200);
    expect((await call('/s/AAAAAAAAAA')).status).toBe(404);
  });

  it('serves the preview with long caching, and falls back to /og.png', async () => {
    const { token } = await signedInUser();
    const withImage = await createOk(token);
    const image = await call(`/s/${withImage.id}.png`);
    expect(image.status).toBe(200);
    expect(image.headers.get('Content-Type')).toBe('image/png');
    expect(image.headers.get('Cache-Control')).toContain('immutable');
    expect(image.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    expect(base64(new Uint8Array(await image.arrayBuffer()))).toBe(PNG_1X1);

    const without = await createOk(token, { source: SOURCE });
    const fallback = await call(`/s/${without.id}.png`, { redirect: 'manual' });
    expect(fallback.status).toBe(302);
    expect(fallback.headers.get('Location')).toBe(`${ORIGIN}/og.png`);
    // The page points link previews straight at the site's image.
    expect(await (await call(`/s/${without.id}`)).text()).toContain(`<meta property="og:image" content="${ORIGIN}/og.png">`);
    expect((await call('/s/AAAAAAAAAA.png', { redirect: 'manual' })).status).toBe(302);
  });

  it('answers oEmbed for short links and embed links', async () => {
    const { token } = await signedInUser();
    const share = await createOk(token);
    expect(shareIdOf(`${ORIGIN}/embed/?s=${share.id}`, ORIGIN)).toBe(share.id);
    expect(shareIdOf(`https://evil.example/s/${share.id}`, ORIGIN)).toBeUndefined();

    const answer = await call(`/api/oembed?url=${encodeURIComponent(share.url)}&maxwidth=600`);
    expect(answer.status).toBe(200);
    const body = (await answer.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ version: '1.0', type: 'rich', provider_name: 'Proschi', title: 'Checkout & <Payments>', width: 600, height: 480 });
    expect(body.html).toBe(
      `<iframe src="${ORIGIN}/embed/?s=${share.id}" title="Checkout &amp; &lt;Payments&gt; · Proschi" width="600" height="480" style="border:0" loading="lazy" allowfullscreen></iframe>`,
    );
    expect((await call(`/api/oembed?url=${encodeURIComponent(`${ORIGIN}/s/AAAAAAAAAA`)}`)).status).toBe(404);
    expect((await call(`/api/oembed?url=${encodeURIComponent(share.url)}&format=xml`)).status).toBe(501);
  });
});
