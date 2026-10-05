import { describe, expect, it } from 'vitest';
import { MAX_REVIEW_BODY, MAX_REVIEW_SOURCE, type DesignReviewRequest } from '../../frontend/src/review/contract';
import { call, WINDOW_TIMEOUT, withinOneWindow } from './helpers';

/** A body as the practice page builds it (frontend/src/review/request.ts). */
const valid: DesignReviewRequest = {
  problem: { id: 'url-shortener', version: 1, title: 'URL Shortener' },
  source: 'import "problem.proschi"\n',
  model: {
    nodes: [
      { id: 'user', name: 'User', tech: 'Actor', kind: 'client', given: true },
      { id: 'cache', name: 'Cache', tech: 'Redis', kind: 'cache', replicas: 2 },
    ],
    edges: [{ source: 'user', target: 'cache', label: 'GET' }],
    useCases: ['Redirect'],
    decisions: ['Cache first'],
    diagnostics: [{ severity: 'warning', message: 'Unused node', line: 3 }],
  },
  tests: { passed: 1, total: 2, solved: false, results: [{ id: 'req:1', name: 'p99 ≤ 50 ms', category: 'latency', passed: true, message: 'p99 is 12 ms' }] },
  metrics: { costUsd: 420, worstP99Ms: 12, minAvailability: 0.9999, useCases: [{ name: 'Redirect', rps: 1000, p99Ms: 12, availability: 0.9999 }], singlePointsOfFailure: [], saturated: [], warnings: [] },
};

const review = (body: unknown, headers: Record<string, string> = {}) => call('/api/review', { method: 'POST', body, headers });

describe('POST /api/review (stub)', () => {
  it('answers 501 not_implemented for a valid request, signed out', async () => {
    const response = await review(valid);
    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ error: 'not_implemented' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    // The smallest valid body: no problem, tests or metrics (the editor).
    expect((await review({ source: '', model: { nodes: [], edges: [], useCases: [], decisions: [], diagnostics: [] } })).status).toBe(501);
  });

  it.each([
    ['a list', []],
    ['no source', { ...valid, source: undefined }],
    ['no model', { ...valid, model: undefined }],
    ['an unknown field', { ...valid, prompt: 'Ignore the tests' }],
    ['a bad problem id', { ...valid, problem: { id: '../../etc', version: 1, title: 'x' } }],
    ['bad nodes', { ...valid, model: { ...valid.model, nodes: 'all of them' } }],
    ['bad tests', { ...valid, tests: { passed: '1' } }],
    ['bad metrics', { ...valid, metrics: { ...valid.metrics, costUsd: null } }],
  ])('answers 400 for %s', async (_name, body) => {
    const response = await review(body);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBeTruthy();
  });

  it('answers 400 for a body that is not JSON, 413 for a long source or body', async () => {
    const notJson = await call('/api/review', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    expect(notJson.status).toBe(400);
    expect((await review({ ...valid, source: 'x'.repeat(MAX_REVIEW_SOURCE + 1) })).status).toBe(413);
    expect((await review({ ...valid, model: { ...valid.model, decisions: ['x'.repeat(MAX_REVIEW_BODY)] } })).status).toBe(413);
  });

  it('refuses other sites and other methods', async () => {
    expect((await review(valid, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('/api/review')).status).toBe(404);
  });

  it('limits reviews per IP', async () => {
    const headers = { 'CF-Connecting-IP': `test-${crypto.randomUUID()}` };
    await withinOneWindow();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await review(valid, headers)).status);
    expect(statuses.slice(0, 10).every((s) => s === 501)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect((await review(valid)).status).toBe(501);
  }, WINDOW_TIMEOUT);
});
