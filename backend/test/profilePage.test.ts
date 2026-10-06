import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { rewritePracticePage } from '../src/profilePage';
import { call, resetDatabase, signedInUser } from './helpers';

/**
 * Public profiles at /u/<id> (src/profilePage.ts): the page with the
 * profile's meta tags and its Open Graph card, only for users who opted in;
 * everyone else's address is the same 404 as an id nobody has.
 */

const nowSeconds = () => Math.floor(Date.now() / 1000);
const SOURCE = 'service SecretDesign { replicas: 3 }';

async function publicUser(name = 'Ada <Lovelace>', publicProfile = true) {
  const user = await signedInUser(name, publicProfile);
  const t = nowSeconds();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO progress (user_id, problem_id, runs, source, first_run_at, updated_at, solved_at, runs_to_solve, best_cost_usd, best_p99_ms)
       VALUES (?, 'url-shortener', 2, ?, ?, ?, ?, 2, 12.5, 80)`,
    ).bind(user.id, SOURCE, t, t, t),
    env.DB.prepare('INSERT INTO achievements (user_id, achievement_id, earned_at) VALUES (?, ?, ?)').bind(user.id, 'first-solve', t - 100),
  ]);
  return user;
}

const meta = (html: string, attr: string, name: string) => new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`).exec(html)?.[1];

describe('public profile pages', () => {
  beforeEach(resetDatabase);

  it('serves an opted-in user’s page with their meta tags, escaped, and nothing private', async () => {
    const user = await publicUser();
    const response = await call(`/u/${user.id}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    const html = await response.text();
    expect(html).toContain('<title>Ada &lt;Lovelace&gt; on Proschi</title>');
    expect(meta(html, 'property', 'og:title')).toBe('Ada &lt;Lovelace&gt; on Proschi');
    expect(meta(html, 'property', 'og:description')).toMatch(/^Solved 1 of \d+ system design problems · 1 badge/);
    expect(meta(html, 'property', 'og:url')).toBe(`https://proschi.test/u/${user.id}`);
    expect(meta(html, 'property', 'og:image')).toMatch(new RegExp(`^https://proschi.test/u/${user.id}\\.png\\?v=[\\w-]{16}$`));
    expect(meta(html, 'name', 'robots')).toBe('index, follow');
    expect(html).toContain(`<link rel="canonical" href="https://proschi.test/u/${user.id}" />`);
    // The summary for crawlers names the problems and badges, never a design.
    expect(html).toContain('<li>URL Shortener</li>');
    expect(html).toContain(`href="/practice/#/u/${user.id}"`);
    expect(html).not.toContain('SecretDesign');
    expect(html).not.toContain('<Lovelace>');
  });

  it('answers 404 for a private user, the same as for an unknown id or a bad path', async () => {
    const hidden = await publicUser('Grace', false);
    for (const path of [`/u/${hidden.id}`, `/u/${hidden.id}.png`, `/u/${crypto.randomUUID()}`, '/u/not%20an%20id', '/u/', `/u/${hidden.id}/extra`]) {
      const response = await call(path);
      expect(response.status, path).toBe(404);
      expect(response.headers.get('X-Robots-Tag'), path).toBe('noindex');
      expect(await response.text(), path).not.toContain('Grace');
    }
  });

  it('hides the page and image as soon as the profile is turned off', async () => {
    const user = await publicUser();
    expect((await call(`/u/${user.id}`)).status).toBe(200);
    await env.DB.prepare('UPDATE users SET public_profile = 0 WHERE id = ?').bind(user.id).run();
    expect((await call(`/u/${user.id}`)).status).toBe(404);
    expect((await call(`/u/${user.id}.png`)).status).toBe(404);
  });

  it('refuses other methods', async () => {
    const user = await publicUser();
    const response = await call(`/u/${user.id}`, { method: 'POST' });
    expect(response.status).toBe(404);
  });

  it('draws the profile card as a PNG, revalidated by its ETag', async () => {
    const user = await publicUser('Ada 🚀 李');
    const response = await call(`/u/${user.id}.png?text=ignored`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe('public, no-cache');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // 1200×630, from the IHDR chunk.
    const view = new DataView(bytes.buffer);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([1200, 630]);

    const etag = response.headers.get('ETag')!;
    expect(etag).toMatch(/^"[\w-]{16}"$/);
    const again = await call(`/u/${user.id}.png`, { headers: { 'If-None-Match': etag } });
    expect(again.status).toBe(304);
    // A new solve is a new card.
    await env.DB.prepare(
      `INSERT INTO progress (user_id, problem_id, runs, source, first_run_at, updated_at, solved_at) VALUES (?, 'pastebin', 1, ?, 1, 1, 1)`,
    ).bind(user.id, SOURCE).run();
    const changed = await call(`/u/${user.id}.png`, { headers: { 'If-None-Match': etag } });
    expect(changed.status).toBe(200);
    expect(changed.headers.get('ETag')).not.toBe(etag);
    await changed.arrayBuffer();
  }, 30_000);

  it('puts the profile’s head and summary into the built practice page', async () => {
    const page = new Response(
      `<!doctype html><html><head><meta charset="UTF-8" /><title>Practice</title><meta name="description" content="old" /><link rel="canonical" href="https://proschi.app/practice/" /><meta property="og:title" content="old" /><meta name="twitter:card" content="summary" /><script type="module" src="./assets/practice.js"></script></head><body><div id="root"></div></body></html>`,
      { headers: { 'Content-Type': 'text/html' } },
    );
    const out = await rewritePracticePage(page, '<title>New</title>', '<main>Summary</main>', new Headers({ 'Content-Type': 'text/html' })).text();
    expect(out).toContain('<head><base href="/practice/" /><meta charset="UTF-8" />');
    expect(out).toContain('<title>New</title>');
    expect(out).not.toContain('Practice</title>');
    expect(out).not.toContain('content="old"');
    expect(out).not.toContain('twitter:card');
    expect(out).toContain('src="./assets/practice.js"');
    expect(out).toContain('<div id="root"><main>Summary</main></div>');
  });
});
