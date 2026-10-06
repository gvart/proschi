import { createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_METRIC_BATCH } from '../../frontend/src/services/metricsEvents';
import type { Env } from '../src/env';
import worker from '../src/index';
import { call, ORIGIN, resetDatabase, signedInUser, WINDOW_TIMEOUT, withinOneWindow } from './helpers';

const TOKEN = 'test-metrics-token-0123456789';
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

const send = (body: unknown, headers: Record<string, string> = {}) => call('/api/metrics', { method: 'POST', body, headers });

async function counts(day = today()): Promise<Record<string, number>> {
  const { results } = await env.DB.prepare('SELECT event, count FROM daily_counts WHERE day = ?').bind(day).all<{ event: string; count: number }>();
  return Object.fromEntries(results.map((r) => [r.event, r.count]));
}

/** The Worker with other bindings, e.g. without METRICS_TOKEN. */
async function callWith(overrides: Partial<Env>, path: string, init: RequestInit = {}): Promise<Response> {
  const exec = createExecutionContext();
  const request = new Request(`${ORIGIN}${path}`, init) as Request<unknown, IncomingRequestCfProperties>;
  const response = await worker.fetch(request, { ...env, ...overrides } as Env, exec);
  await waitOnExecutionContext(exec);
  return response;
}

describe('POST /api/metrics', () => {
  beforeEach(resetDatabase);

  it('counts one event or a batch into today’s row, signed out, and stores nothing else', async () => {
    expect((await send({ event: 'editor_open' })).status).toBe(204);
    expect((await send({ events: ['editor_open', 'test_run', 'test_run'] })).status).toBe(204);
    expect(await counts()).toEqual({ editor_open: 2, test_run: 2 });
    const columns = (await env.DB.prepare('PRAGMA table_info(daily_counts)').all<{ name: string }>()).results.map((c) => c.name);
    expect(columns).toEqual(['day', 'event', 'count']);
  });

  it('ignores a session: signed in counts the same, and writes no user id anywhere', async () => {
    const { token } = await signedInUser();
    expect((await call('/api/metrics', { method: 'POST', token, body: { event: 'practice_open' } })).status).toBe(204);
    expect(await counts()).toEqual({ practice_open: 1 });
  });

  it('refuses unknown events, server-only events and malformed bodies, counting nothing', async () => {
    for (const body of [
      { event: 'page_view' },
      { events: ['editor_open', 'nope'] },
      { event: 'sign_in' },
      { events: [] },
      { events: 'editor_open' },
      { event: 'editor_open', events: ['test_run'] },
      { event: 'editor_open', user: 'u1' },
      {},
      { event: 42 },
    ]) {
      expect((await send(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await counts()).toEqual({});
  });

  it(`caps a batch at ${MAX_METRIC_BATCH} events and the body at 2 KiB`, async () => {
    expect((await send({ events: Array(MAX_METRIC_BATCH).fill('export') })).status).toBe(204);
    expect((await send({ events: Array(MAX_METRIC_BATCH + 1).fill('export') })).status).toBe(413);
    expect((await send({ event: 'export', pad: 'x'.repeat(3000) })).status).toBe(413);
    expect(await counts()).toEqual({ export: MAX_METRIC_BATCH });
  });

  it('refuses another site’s Origin', async () => {
    expect((await send({ event: 'export' }, { Origin: 'https://evil.test' })).status).toBe(403);
    expect(await counts()).toEqual({});
  });

  it(
    'limits requests per IP',
    async () => {
      await withinOneWindow();
      const headers = { 'CF-Connecting-IP': `metrics-${crypto.randomUUID()}` };
      const statuses: number[] = [];
      for (let i = 0; i < 31; i++) statuses.push((await send({ event: 'landing_view' }, headers)).status);
      expect(statuses.slice(0, 30).every((s) => s === 204)).toBe(true);
      expect(statuses[30]).toBe(429);
      expect(await counts()).toEqual({ landing_view: 30 });
    },
    WINDOW_TIMEOUT,
  );
});

describe('GET /api/metrics/summary', () => {
  beforeEach(resetDatabase);

  it('answers each day’s counts and the totals with the token', async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO daily_counts VALUES (?, 'editor_open', 5)").bind(daysAgo(1)),
      env.DB.prepare("INSERT INTO daily_counts VALUES (?, 'editor_open', 7)").bind(daysAgo(40)),
    ]);
    await send({ events: ['editor_open', 'test_run'] });
    const response = await call('/api/metrics/summary?days=7', { headers: { 'X-Metrics-Token': TOKEN } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, any>;
    expect(body.from).toBe(daysAgo(6));
    expect(body.to).toBe(today());
    expect(body.days).toEqual([
      { day: today(), counts: { editor_open: 1, test_run: 1 } },
      { day: daysAgo(1), counts: { editor_open: 5 } },
    ]);
    expect(body.totals).toMatchObject({ editor_open: 6, test_run: 1, sign_in: 0 });
    expect(body.events).toContain('sign_in');

    const longer = (await (await call('/api/metrics/summary?days=60', { headers: { 'X-Metrics-Token': TOKEN } })).json()) as Record<string, any>;
    expect(longer.totals.editor_open).toBe(13);
    expect((await call('/api/metrics/summary?days=0', { headers: { 'X-Metrics-Token': TOKEN } })).status).toBe(400);
    expect((await call('/api/metrics/summary?days=401', { headers: { 'X-Metrics-Token': TOKEN } })).status).toBe(400);
  });

  it('is a 404 without the right token, or without METRICS_TOKEN set', async () => {
    expect((await call('/api/metrics/summary')).status).toBe(404);
    expect((await call('/api/metrics/summary', { headers: { 'X-Metrics-Token': `${TOKEN}x` } })).status).toBe(404);
    const headers = { 'X-Metrics-Token': TOKEN, 'CF-Connecting-IP': 'summary-test' };
    expect((await callWith({ METRICS_TOKEN: undefined }, '/api/metrics/summary', { headers })).status).toBe(404);
    expect((await callWith({ METRICS_TOKEN: 'short' }, '/api/metrics/summary', { headers: { 'X-Metrics-Token': 'short' } })).status).toBe(404);
  });
});

describe('retention', () => {
  beforeEach(resetDatabase);

  it('the daily cron deletes counts older than 400 days', async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO daily_counts VALUES (?, 'export', 1)").bind(daysAgo(401)),
      env.DB.prepare("INSERT INTO daily_counts VALUES (?, 'export', 2)").bind(daysAgo(399)),
    ]);
    await worker.scheduled(createScheduledController({ cron: '17 3 * * *' }), env);
    const { results } = await env.DB.prepare('SELECT day FROM daily_counts').all<{ day: string }>();
    expect(results).toEqual([{ day: daysAgo(399) }]);
  });
});
