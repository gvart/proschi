import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_KEPT_MISTAKES } from '../src/mistakes';
import { call, resetDatabase, signedInUser } from './helpers';

const send = (token: string | undefined, body: unknown) => call('/api/me/mistakes', { method: 'POST', token, body });
const list = async (token: string) => ((await (await call('/api/me/mistakes', { token })).json()) as { mistakes: { problem: string; id: string; title: string; at: number }[] }).mistakes;
const AT = Math.floor(Date.UTC(2026, 10, 1) / 1000);
const mistake = (over: Record<string, unknown> = {}) => ({ problem: 'url-shortener', id: 'miss-never-fills-cache', title: 'Cache misses that never fill the cache', at: AT, ...over });
const count = async (userId: string) => (await env.DB.prepare('SELECT COUNT(*) AS n FROM practice_mistakes WHERE user_id = ?').bind(userId).first<{ n: number }>())!.n;

describe('practice mistakes', () => {
  beforeEach(resetDatabase);

  it('needs a sign-in and well-formed mistakes', async () => {
    expect((await send(undefined, { mistakes: [mistake()] })).status).toBe(401);
    expect((await call('/api/me/mistakes', {})).status).toBe(401);
    const { token } = await signedInUser();
    for (const body of [
      {},
      { mistakes: [] },
      { mistakes: 'x' },
      { mistakes: [mistake({ id: 'Not An Id' })] },
      { mistakes: [mistake({ title: '' })] },
      { mistakes: [mistake({ title: 'x'.repeat(201) })] },
      { mistakes: [mistake({ at: 1.5 })] },
      { mistakes: [mistake({ at: Math.floor(Date.UTC(2020, 0, 1) / 1000) })] },
      { mistakes: [mistake({ at: Math.floor(Date.now() / 1000) + 3600 })] },
      { mistakes: [mistake({ problem: 7 })] },
      { mistakes: Array.from({ length: 51 }, (_, i) => mistake({ at: AT + i })) },
    ]) {
      expect((await send(token, body)).status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
  });

  it('upserts each problem and mistake once, the newest wins, and skips unknown ones', async () => {
    const { token } = await signedInUser();
    expect(await list(token)).toEqual([]);
    const first = await send(token, {
      mistakes: [mistake(), mistake({ problem: 'pastebin', id: 'redis-cache-instead-of-cdn', title: 'A cache, not a CDN', at: AT + 5 }), mistake({ problem: 'no-such-problem' }), mistake({ id: 'no-such-design' })],
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ stored: 2 });
    // Sent again older: nothing changes. Newer: its time and title are taken.
    expect(await (await send(token, { mistakes: [mistake({ at: AT - 10, title: 'old' })] })).json()).toEqual({ stored: 0 });
    expect(await (await send(token, { mistakes: [mistake({ at: AT + 10, title: 'Misses never fill' })] })).json()).toEqual({ stored: 1 });
    expect(await list(token)).toEqual([
      { problem: 'url-shortener', id: 'miss-never-fills-cache', title: 'Misses never fill', at: AT + 10 },
      { problem: 'pastebin', id: 'redis-cache-instead-of-cdn', title: 'A cache, not a CDN', at: AT + 5 },
    ]);
    // Another account sees none of them.
    const other = await signedInUser();
    expect(await list(other.token)).toEqual([]);
  });

  it(`keeps the newest ${MAX_KEPT_MISTAKES} per account`, async () => {
    const { id, token } = await signedInUser();
    await env.DB.batch(
      Array.from({ length: MAX_KEPT_MISTAKES }, (_, i) =>
        env.DB.prepare('INSERT INTO practice_mistakes (user_id, problem_id, mistake_id, title, at) VALUES (?, ?, ?, ?, ?)').bind(id, `p${i}`, 'm', 'old', AT - 1000 + i),
      ),
    );
    expect(await (await send(token, { mistakes: [mistake()] })).json()).toEqual({ stored: 1 });
    expect(await count(id)).toBe(MAX_KEPT_MISTAKES);
    const kept = await list(token);
    expect(kept).toHaveLength(MAX_KEPT_MISTAKES);
    expect(kept[0].problem).toBe('url-shortener');
    // The oldest went.
    expect(kept.some((m) => m.problem === 'p0')).toBe(false);
  });

  it('is in the data export and goes with the account', async () => {
    const { id, token } = await signedInUser();
    await send(token, { mistakes: [mistake()] });
    const exported = (await (await call('/api/me/export', { token })).json()) as { practiceMistakes: unknown[] };
    expect(exported.practiceMistakes).toEqual([mistake()]);
    expect((await call('/api/me', { method: 'DELETE', token })).status).toBe(204);
    expect(await count(id)).toBe(0);
  });
});
