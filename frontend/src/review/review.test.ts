import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultEngine, nullEngine } from '../hld/engine';
import { findProblem } from '../practice/catalog';
import { MAX_REVIEW_SOURCE, parseDesignReview, reviewRequestProblem, type DesignReview } from './contract';
import { practiceReviewInput } from './practice';
import { buildReviewRequest } from './request';
import { apiReviewer, defaultReviewer, placeholderReviewer, ReviewUnavailableError } from './reviewer';

const shortener = findProblem('url-shortener')!;

describe('review request', () => {
  it('carries the problem, the source, the model, the tests and the metrics of a practice solution', () => {
    const request = buildReviewRequest(practiceReviewInput(shortener, shortener.solution, defaultEngine));
    expect(request.problem).toEqual({ id: 'url-shortener', version: shortener.version ?? 1, title: 'URL Shortener' });
    expect(request.source).toBe(shortener.solution);
    expect(request.model.nodes.length).toBeGreaterThan(2);
    // The given's client is marked; the solver's own nodes are not.
    expect(request.model.nodes.some((n) => n.given)).toBe(true);
    expect(request.model.nodes.some((n) => !n.given && n.kind === 'cache')).toBe(true);
    expect(request.model.useCases).toContain('Redirect');
    expect(request.model.diagnostics).toEqual([]);
    expect(request.tests).toMatchObject({ solved: true });
    expect(request.tests!.passed).toBe(request.tests!.total);
    expect(request.metrics!.costUsd).toBeGreaterThan(0);
    expect(request.metrics!.worstP99Ms).toBeGreaterThan(0);
    expect(request.metrics!.minAvailability).toBeGreaterThan(0.99);
    // What the page sends is what the Worker accepts.
    expect(reviewRequestProblem(JSON.parse(JSON.stringify(request)))).toBeUndefined();
    expect(JSON.stringify(request).length).toBeLessThan(64 * 1024);
  });

  it('says the tests were blocked, and has no metrics, when the design has errors or no simulation', () => {
    const broken = buildReviewRequest(practiceReviewInput(shortener, `${shortener.starter}\nx [Redis]\nx [Redis]\n`, defaultEngine));
    expect(broken.tests?.blocked).toBe('errors');
    expect(broken.metrics).toBeUndefined();
    expect(broken.model.diagnostics.some((d) => d.severity === 'error')).toBe(true);
    expect(reviewRequestProblem(broken)).toBeUndefined();
    const noEngine = buildReviewRequest(practiceReviewInput(shortener, shortener.starter, nullEngine));
    expect(noEngine.tests?.blocked).toBe('no-engine');
    expect(reviewRequestProblem(noEngine)).toBeUndefined();
  });

  it.each([
    ['not an object', [], /JSON object/],
    ['no source', { model: {} }, /source must be a string/],
    ['a long source', { source: 'x'.repeat(MAX_REVIEW_SOURCE + 1) }, /source is too long/],
    ['an unknown field', { source: '', extra: 1 }, /Unknown field "extra"/],
    ['a bad problem id', { source: '', problem: { id: '../x', version: 1, title: 'X' } }, /problem\.id/],
    ['a bad version', { source: '', problem: { id: 'x', version: 0, title: 'X' } }, /problem\.version/],
    ['no model', { source: '' }, /model must be an object/],
    ['bad nodes', { source: '', model: { nodes: [{ id: 1 }], edges: [], useCases: [], decisions: [], diagnostics: [] } }, /model\.nodes/],
    ['bad tests', { source: '', model: { nodes: [], edges: [], useCases: [], decisions: [], diagnostics: [] }, tests: { passed: 1 } }, /tests needs/],
    ['bad metrics', { source: '', model: { nodes: [], edges: [], useCases: [], decisions: [], diagnostics: [] }, metrics: { costUsd: 'a lot' } }, /metrics\.costUsd/],
  ])('rejects %s', (_name, body, message) => {
    expect(reviewRequestProblem(body)).toMatch(message);
  });
});

describe('design review answers', () => {
  const review: DesignReview = {
    summary: 'Solid.',
    strengths: ['Cache first'],
    issues: [{ severity: 'major', title: 'One database', detail: 'Add a replica.', nodeId: 'db' }],
    suggestions: ['Shard later'],
  };

  it('reads a well-formed review and drops unknown fields', () => {
    expect(parseDesignReview({ ...review, model: 'x' })).toEqual(review);
  });

  it.each([
    ['no summary', { ...review, summary: undefined }],
    ['a bad severity', { ...review, issues: [{ severity: 'fatal', title: 't', detail: 'd' }] }],
    ['strengths that are not strings', { ...review, strengths: [1] }],
    ['not an object', 'great design'],
  ])('rejects %s', (_name, data) => {
    expect(() => parseDesignReview(data)).toThrow(/Malformed design review/);
  });
});

describe('reviewers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('use the placeholder unless built with VITE_AI_REVIEW=true, and the placeholder gives no feedback', async () => {
    expect(defaultReviewer).toBe(placeholderReviewer);
    expect(placeholderReviewer.available).toBe(false);
    await expect(placeholderReviewer.review(buildReviewRequest(practiceReviewInput(shortener, shortener.starter, defaultEngine)))).rejects.toBeInstanceOf(ReviewUnavailableError);
  });

  it('read the stub endpoint’s 501 as not available yet, and other failures as errors', async () => {
    const request = buildReviewRequest(practiceReviewInput(shortener, shortener.starter, defaultEngine));
    const answer = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

    const notImplemented = answer(501, { error: 'not_implemented' });
    vi.stubGlobal('fetch', notImplemented);
    await expect(apiReviewer.review(request)).rejects.toBeInstanceOf(ReviewUnavailableError);
    expect(notImplemented).toHaveBeenCalledWith('/api/review', expect.objectContaining({ method: 'POST', body: JSON.stringify(request) }));

    vi.stubGlobal('fetch', answer(429, { error: 'Too many reviews; wait a minute' }));
    await expect(apiReviewer.review(request)).rejects.toThrow('Too many reviews');

    vi.stubGlobal('fetch', answer(200, { summary: 'ok', strengths: [], issues: [], suggestions: [] }));
    await expect(apiReviewer.review(request)).resolves.toEqual({ summary: 'ok', strengths: [], issues: [], suggestions: [] });
  });
});
