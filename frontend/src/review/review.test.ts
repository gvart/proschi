import { describe, expect, it } from 'vitest';
import { defaultEngine, nullEngine } from '../hld/engine';
import { findProblem } from '../practice/catalog';
import { mapResolver, parse } from '../dsl';
import { MAX_REVIEW_IMPORTS, MAX_REVIEW_SOURCE, parseDesignReview, reviewRequestProblem, type DesignReview } from './contract';
import { editorReviewInput } from './editor';
import { practiceReviewInput } from './practice';
import { buildReviewRequest } from './request';
import { defaultReviewer, ruleReviewer } from './reviewer';

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
    // What a reviewer needs to say why: load by use case, requirements, paths, dependencies and writes.
    const cache = request.metrics!.nodes!.find((n) => n.kind === 'cache')!;
    expect(cache.loadBy.map((l) => l.useCase)).toEqual(['Redirect']);
    expect(cache.usedBy).toEqual(['Redirect']);
    const redirect = request.metrics!.useCases.find((u) => u.name === 'Redirect')!;
    expect(redirect.latency).toEqual([expect.objectContaining({ percentile: 'p99', limitMs: 50, testId: expect.stringMatching(/^req:/) })]);
    expect(redirect.availabilityLimit?.min).toBeCloseTo(0.999, 9);
    expect(redirect.scenarios!.map((s) => s.name)).toEqual(['Cache hit', 'Cache miss']);
    expect(redirect.scenarios![1].path.some((h) => h.async && h.to === 'cache')).toBe(true);
    expect(redirect.dependencies!.find((d) => d.nodeId === 'cache')).toMatchObject({ fallback: false });
    const shorten = request.metrics!.useCases.find((u) => u.name === 'Shorten')!;
    expect(shorten).toMatchObject({ entryWrite: true, durableTestId: expect.stringMatching(/^req:/) });
    expect(shorten.writes).toContainEqual({ nodeId: 'db', timing: 'sync' });
    expect(request.metrics!.costLimit).toMatchObject({ maxUsd: 3000 });
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
    ['a bad path', { source: '', path: 1 }, /path must be a string/],
    ['imports that are not a map', { source: '', imports: ['a.proschi'] }, /imports must be an object/],
    ['too many imports', { source: '', imports: Object.fromEntries(Array.from({ length: MAX_REVIEW_IMPORTS + 1 }, (_, i) => [`f${i}`, ''])) }, /imports must be an object/],
    ['an import that is not text', { source: '', imports: { 'a.proschi': 1 } }, /each import/],
    ['a long import', { source: '', imports: { 'a.proschi': 'x'.repeat(MAX_REVIEW_SOURCE + 1) } }, /source is too long/],
  ])('rejects %s', (_name, body, message) => {
    expect(reviewRequestProblem(body)).toMatch(message);
  });

  it('carries the editor’s path and the files its imports read', () => {
    const files = { 'lib/shared.proschi': 'db "Orders" [PostgreSQL]\n' };
    const source = 'import "lib/shared.proschi"\napi "API" [REST API]\napi -> db\n';
    const parsed = parse(source, { path: 'shop.proschi', resolve: mapResolver(files) });
    const request = buildReviewRequest(editorReviewInput(source, parsed, defaultEngine.analyze(parsed.diagram)!, [], { path: 'shop.proschi', imports: files }));
    expect(request).toMatchObject({ path: 'shop.proschi', imports: files });
    expect(request.model.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['api', 'db']));
    expect(reviewRequestProblem(JSON.parse(JSON.stringify(request)))).toBeUndefined();
    // No imports, no field.
    expect(buildReviewRequest(editorReviewInput('', parse(''), defaultEngine.analyze(parse('').diagram)!, [], { imports: {} }))).not.toHaveProperty('imports');
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
  it('use the rule reviewer: the automatic review, from the simulation and the tests', async () => {
    expect(defaultReviewer).toBe(ruleReviewer);
    expect(ruleReviewer).toMatchObject({ available: true });
    const review = await ruleReviewer.review(buildReviewRequest(practiceReviewInput(shortener, shortener.starter, defaultEngine)));
    expect(review.by).toBe('rules');
    expect(review.issues.length).toBeGreaterThan(0);
  });
});
