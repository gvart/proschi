import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { DAY, nextState, replay } from '../../frontend/src/learn/fsrs';
import { localDay } from '../../frontend/src/learn/review';
import { findCard, MAX_CLOCK_SKEW } from '../src/cards';
import { call, resetDatabase, signedInUser, WINDOW_TIMEOUT, withinOneWindow } from './helpers';

const CARD = 'cache-aside';
const OTHER = 'seconds-in-a-day';
const nowSeconds = () => Math.floor(Date.now() / 1000);
/** The UTC date of a Unix time: the tests' "local" date. */
const dayOf = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

let seq = 0;
function review(cardId: string, rating: number, reviewedAt: number, extra: Record<string, unknown> = {}) {
  return { id: crypto.randomUUID(), cardId, version: 1, rating, reviewedAt, durationMs: 4000 + seq++, day: dayOf(reviewedAt), ...extra };
}

const post = (token: string, reviews: unknown) => call('/api/cards/reviews', { method: 'POST', token, body: { reviews } });
const state = async (token: string, day?: string) => (await (await call(`/api/cards/state${day ? `?day=${day}` : ''}`, { token })).json()) as Record<string, any>;

describe('card reviews', () => {
  beforeEach(resetDatabase);

  it('knows the cards the site ships', () => {
    expect(findCard(CARD)).toMatchObject({ id: CARD, topic: 'caching', version: 1 });
    expect(findCard('no-such-card')).toBeUndefined();
  });

  it('needs a session', async () => {
    expect((await call('/api/cards/state')).status).toBe(401);
    expect((await post('nope', [])).status).toBe(401);
  });

  it('stores reviews, answers the states the shared scheduler gives, and lists them', async () => {
    const { token } = await signedInUser();
    const t = nowSeconds();
    const reviews = [review(CARD, 3, t - 5 * DAY), review(CARD, 3, t - 2 * DAY), review(OTHER, 1, t - 60)];
    const response = await post(token, reviews);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, any>;
    expect(body.accepted).toBe(3);
    expect(body.skipped).toEqual([]);
    expect(body.states[CARD]).toEqual(replay(reviews.slice(0, 2).map((r) => ({ version: 1, rating: r.rating as 3, reviewedAt: r.reviewedAt }))));
    expect(body.states[OTHER]).toEqual(nextState(undefined, 1, t - 60));

    const listed = await state(token, dayOf(t));
    expect(listed.states).toEqual(body.states);
    expect(listed.today).toEqual({ reviews: 1, new: 1 });
    expect((await state(token)).today).toBeUndefined();
  });

  it('is idempotent: a resent batch is stored once and gives the same states', async () => {
    const { token } = await signedInUser();
    const t = nowSeconds();
    const batch = [review(CARD, 3, t - 3 * DAY), review(CARD, 4, t - 10)];
    const first = (await (await post(token, batch)).json()) as Record<string, any>;
    const again = (await (await post(token, batch)).json()) as Record<string, any>;
    expect(again.accepted).toBe(0);
    expect(again.states).toEqual(first.states);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM card_reviews').first<{ n: number }>())!.n).toBe(2);

    // A review arriving late from another device is replayed in time order.
    const late = review(CARD, 1, t - DAY);
    const merged = (await (await post(token, [late])).json()) as Record<string, any>;
    expect(merged.states[CARD]).toEqual(replay([batch[0], late, batch[1]].map((r) => ({ version: 1, rating: r.rating as 1, reviewedAt: r.reviewedAt }))));
    expect(merged.states[CARD].lapses).toBe(1);
  });

  it('counts the day’s reviews and new cards from the client’s date', async () => {
    const { token } = await signedInUser();
    const t = nowSeconds();
    const today = localDay(new Date(t * 1000));
    await post(token, [
      review(CARD, 3, t - 3 * DAY),
      review(CARD, 3, t - 100, { day: today }),
      review(OTHER, 3, t - 50, { day: today }),
      review(OTHER, 3, t - 40, { day: today }),
    ]);
    expect((await state(token, today)).today).toEqual({ reviews: 3, new: 1 });
    expect((await call('/api/cards/state?day=2027-02-30', { token })).status).toBe(400);
  });

  it('skips unknown cards and versions, and times in the future or far from the day, and reports them', async () => {
    const { token } = await signedInUser();
    const t = nowSeconds();
    const good = review(CARD, 3, t);
    const unknown = review('no-such-card', 3, t);
    const version = review(CARD, 3, t, { version: 2 });
    const future = review(CARD, 3, t + MAX_CLOCK_SKEW + 60);
    const old = review(CARD, 3, 1_000_000_000, { day: '2001-09-09' });
    const wrongDay = review(CARD, 3, t, { day: '2020-01-01' });
    const body = (await (await post(token, [good, unknown, version, future, old, wrongDay])).json()) as Record<string, any>;
    expect(body.accepted).toBe(1);
    expect(body.skipped).toEqual([
      { id: unknown.id, cardId: 'no-such-card', reason: 'unknown card' },
      { id: version.id, cardId: CARD, reason: 'unknown version' },
      { id: future.id, cardId: CARD, reason: 'reviewedAt is in the future' },
      { id: old.id, cardId: CARD, reason: 'reviewedAt is too old' },
      { id: wrongDay.id, cardId: CARD, reason: 'day does not match reviewedAt' },
    ]);
    expect(Object.keys(body.states)).toEqual([CARD]);
    // Only skipped ones: nothing stored, nothing answered.
    expect(await (await post(token, [unknown])).json()).toEqual({ accepted: 0, skipped: [{ id: unknown.id, cardId: 'no-such-card', reason: 'unknown card' }], states: {} });
  });

  it('refuses malformed reviews and batches over 200', async () => {
    const { token } = await signedInUser();
    const t = nowSeconds();
    const bad = async (patch: Record<string, unknown>) => (await post(token, [{ ...review(CARD, 3, t), ...patch }])).status;
    expect(await bad({ rating: 0 })).toBe(400);
    expect(await bad({ rating: '3' })).toBe(400);
    expect(await bad({ id: 'x' })).toBe(400);
    expect(await bad({ version: 0 })).toBe(400);
    expect(await bad({ reviewedAt: t + 0.5 })).toBe(400);
    expect(await bad({ day: '05/10/2026' })).toBe(400);
    expect(await bad({ durationMs: -1 })).toBe(400);
    expect(await bad({ durationMs: undefined })).toBe(200);
    expect((await call('/api/cards/reviews', { method: 'POST', token, body: { reviews: 'all' } })).status).toBe(400);
    expect((await post(token, [null])).status).toBe(400);
    const tooMany = Array.from({ length: 201 }, () => review(CARD, 3, t));
    expect((await post(token, tooMany)).status).toBe(413);
    // Two hundred go in one request.
    const many = Array.from({ length: 200 }, (_, i) => review(CARD, 3, t - (200 - i) * 60));
    expect(((await (await post(token, many)).json()) as Record<string, any>).accepted).toBe(200);
  });

  it('keeps each user’s reviews apart, exports them and deletes them with the account', async () => {
    const a = await signedInUser();
    const b = await signedInUser();
    const t = nowSeconds();
    const r = review(CARD, 3, t);
    await post(a.token, [r]);
    expect((await state(b.token)).states).toEqual({});
    // Review ids are per user: another user's review with the same id is stored too.
    expect(((await (await post(b.token, [r])).json()) as Record<string, any>).accepted).toBe(1);
    expect((await state(b.token)).states[CARD]).toEqual((await state(a.token)).states[CARD]);

    const exported = (await (await call('/api/me/export', { token: a.token })).json()) as Record<string, any>;
    expect(exported.cardReviews).toEqual([{ id: r.id, cardId: CARD, cardVersion: 1, rating: 3, reviewedAt: t, durationMs: r.durationMs, day: r.day }]);
    expect(exported.cardStates).toEqual([
      {
        cardId: CARD,
        cardVersion: 1,
        dueAt: t + 3 * DAY,
        stability: expect.closeTo(3.173, 6),
        difficulty: expect.any(Number),
        reps: 1,
        lapses: 0,
        lastReviewAt: t,
      },
    ]);

    expect((await call('/api/me', { method: 'DELETE', token: a.token })).status).toBe(204);
    for (const table of ['card_reviews', 'card_state']) {
      const count = (user: string) => env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).bind(user).first<{ n: number }>();
      expect((await count(a.id))!.n, table).toBe(0);
      expect((await count(b.id))!.n, table).toBe(1);
    }
  });

  it('limits review requests per user', async () => {
    const { token } = await signedInUser();
    await withinOneWindow();
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) statuses.push((await call('/api/cards/state', { token })).status);
    expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true);
    expect(statuses[60]).toBe(429);
    expect((await post(token, [])).status).toBe(429);
  }, WINDOW_TIMEOUT);
});
