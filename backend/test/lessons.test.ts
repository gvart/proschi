import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AchievementsAnswer } from '../../frontend/src/learn/achievements';
import { call, resetDatabase, signedInUser } from './helpers';

const send = (token: string | undefined, body: unknown) => call('/api/me/lessons', { method: 'POST', token, body });

describe('lessons read', () => {
  beforeEach(resetDatabase);

  it('needs a sign-in and a list of ids', async () => {
    expect((await send(undefined, { ids: ['url-shortener'] })).status).toBe(401);
    const { token } = await signedInUser();
    for (const body of [{}, { ids: [] }, { ids: 'url-shortener' }, { ids: [1] }, { ids: ['x'.repeat(101)] }, { ids: Array.from({ length: 201 }, (_, i) => `id-${i}`) }]) {
      expect((await send(token, body)).status, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
  });

  it('keeps problems and guides once each, skips other ids, and answers them with the account', async () => {
    const { id, token } = await signedInUser();
    const first = await send(token, { ids: ['url-shortener', 'approach', 'no-such-lesson', 'url-shortener'] });
    expect(first.status).toBe(200);
    expect(first.headers.get('Cache-Control')).toBe('no-store');
    expect(await first.json()).toEqual({ added: 2, skipped: ['no-such-lesson'] });
    const { read_at } = (await env.DB.prepare('SELECT read_at FROM lesson_reads WHERE user_id = ? AND lesson_id = ?').bind(id, 'url-shortener').first<{ read_at: number }>())!;

    // Sent again (another device), a read keeps its first time.
    expect(await (await send(token, { ids: ['url-shortener', 'pastebin'] })).json()).toEqual({ added: 1, skipped: [] });
    expect((await env.DB.prepare('SELECT read_at FROM lesson_reads WHERE user_id = ? AND lesson_id = ?').bind(id, 'url-shortener').first<{ read_at: number }>())!.read_at).toBe(read_at);

    const me = (await (await call('/api/me', { token })).json()) as { lessons: string[] };
    expect(me.lessons).toEqual(['approach', 'pastebin', 'url-shortener']);
    // Another user's reads are their own.
    const other = await signedInUser();
    expect(((await (await call('/api/me', { token: other.token })).json()) as { lessons: string[] }).lessons).toEqual([]);
  });

  it('earns the reading badges and goes with the export and the account', async () => {
    const { id, token } = await signedInUser();
    const badge = async (badgeId: string) => ((await (await call('/api/me/achievements', { token })).json()) as AchievementsAnswer).achievements.find((a) => a.id === badgeId)!;
    expect((await badge('lesson-first')).earned).toBe(false);
    // A guide is not a problem lesson: it earns no reading badge.
    await send(token, { ids: ['approach'] });
    expect((await badge('lesson-first')).earned).toBe(false);
    await send(token, { ids: ['hello-proschi', 'url-shortener'] });
    expect((await badge('lesson-first')).earned).toBe(true);
    expect(await badge('lessons-10')).toMatchObject({ earned: false, current: 2, target: 10 });

    const exported = (await (await call('/api/me/export', { token })).json()) as { lessonReads: { lessonId: string; readAt: number }[] };
    expect(exported.lessonReads.map((r) => r.lessonId).sort()).toEqual(['approach', 'hello-proschi', 'url-shortener']);

    expect((await call('/api/me', { method: 'DELETE', token })).status).toBe(204);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM lesson_reads WHERE user_id = ?').bind(id).first<{ n: number }>())!.n).toBe(0);
  });
});
