/**
 * AI design review: the contract between the page and `POST /api/review`
 * (backend/README.md, "Design review"). Pure and dependency-free, so the
 * Worker validates request bodies with the same definition the page builds
 * them from (backend/src/review.ts imports this file).
 *
 * Until an LLM is wired in, the page reviews designs itself with rules over
 * the same request (./rules.ts, ./reviewer.ts); builds with VITE_AI_REVIEW=true
 * call the endpoint, which answers 501 `{error: "not_implemented"}` for now.
 */

/** One node of the design, as the review sees it. */
export interface ReviewNode {
  id: string;
  name: string;
  /** `[Redis]`, `[REST API]`, … (the tech stack as written). */
  tech: string;
  /** The simulation's class of the node: cache, database, service, … */
  kind?: string;
  /** `x3`; 1 when absent. */
  replicas?: number;
  /** Declared by the problem's given (read-only for the solver), not by the design. */
  given?: boolean;
}

export interface ReviewEdge {
  source: string;
  target: string;
  label?: string;
}

/** The parsed design, summarised: what an LLM needs besides the source. */
export interface ModelSummary {
  title?: string;
  nodes: ReviewNode[];
  edges: ReviewEdge[];
  /** Use case names. */
  useCases: string[];
  /** `decision` block titles: the trade-offs the author wrote down. */
  decisions: string[];
  /** Errors and warnings from the parser, with their line in the source. */
  diagnostics: { severity: 'error' | 'warning'; message: string; line?: number }[];
}

export interface ReviewTestResult {
  id: string;
  name: string;
  category: string;
  passed: boolean;
  /** What was measured, e.g. "p99 of Redirect is 41 ms (limit 50 ms)". */
  message: string;
  /** How to fix it, when it failed. */
  hint?: string;
}

export interface ReviewTests {
  passed: number;
  total: number;
  solved: boolean;
  /** Why no test ran: no simulation, or the design has errors. */
  blocked?: 'no-engine' | 'errors';
  results: ReviewTestResult[];
}

/** One node under the design's traffic (NodeAnalysis in frontend/src/sim/analyze.ts). */
export interface ReviewNodeMetrics {
  id: string;
  kind: string;
  replicas: number;
  /** Partitions; 1 when the node is not sharded. */
  shards: number;
  loadRps: number;
  /** How busy it is, 0..1+ (1 is saturated): the larger of request and bandwidth utilisation. */
  utilization: number;
  /** Writes are what fills it, and replicas do not add write capacity (a single-primary store). */
  writeBound?: boolean;
  /** Payload bytes, not requests, are what fills it. */
  bandwidthBound?: boolean;
  /** Mean hop latency under the current load, ms. */
  latencyMs: number;
  /** With its replicas, 0..1. */
  availability: number;
  /** Per month, egress included. */
  costUsd: number;
  /** The instances alone (costUsd without egress). */
  instanceCostUsd: number;
  durable: boolean;
  /** Use cases whose steps send it requests, with the rps each sends (fan-out included), busiest first. */
  loadBy: { useCase: string; rps: number }[];
  /** Use cases whose steps name it, as sender or target, whatever their traffic. */
  usedBy: string[];
}

/** One request on a scenario's synchronous critical path. */
export interface ReviewHop {
  from: string;
  to: string;
  /** Mean latency of the hop, payload transfer included (or the timeout of a failed call), ms. */
  ms: number;
  /** The part of `ms` that moves the payload. */
  transferMs?: number;
  /** `->>`: only the send counts. */
  async?: boolean;
  /** `-x`: costs a timeout. */
  failed?: boolean;
}

/** A use case's scenario with its traffic share and its critical path. */
export interface ReviewScenario {
  name: string;
  /** 0..1 */
  share: number;
  success: boolean;
  path: ReviewHop[];
}

/** A latency requirement on a use case, and what was measured. */
export interface ReviewLatency {
  /** `p99`, `p95`, … */
  percentile: string;
  ms: number;
  limitMs: number;
  /** The scenario that contributes most of the requests slower than the percentile. */
  tailScenario?: string;
  /** The test it is (`req:<n>`), so a review can tell it is the same failure. */
  testId?: string;
}

/** A node a use case needs on a success path. */
export interface ReviewDependency {
  nodeId: string;
  /** A success scenario calls it with `-x` and still completes. */
  fallback: boolean;
  /** What the use case gets from it, 0..1 (a write to a single-primary store needs its primary). */
  availability: number;
}

/** A write the main success scenario makes, and when. */
export interface ReviewWrite {
  nodeId: string;
  /** `sync`: acknowledged before the entry request is answered; `async`: sent with `->>`; `after`: after the answer. */
  timing: 'sync' | 'async' | 'after';
}

export interface ReviewUseCaseMetrics {
  name: string;
  rps: number;
  p99Ms: number;
  availability: number;
  // The rest is optional, so an older page's request stays valid.
  latency?: ReviewLatency[];
  /** `availability … >= x%`, as 0..1. */
  availabilityLimit?: { min: number; testId?: string };
  /** `durable "…"`: the test that checks it. */
  durableTestId?: string;
  /** The entry request is a write (POST, PUT, …). */
  entryWrite?: boolean;
  dependencies?: ReviewDependency[];
  writes?: ReviewWrite[];
  scenarios?: ReviewScenario[];
}

/** The simulation's headline numbers (frontend/src/sim/analyze.ts). */
export interface ReviewMetrics {
  /** Monthly cost of the whole design, USD. */
  costUsd: number;
  /** Worst p99 over the use cases, ms. */
  worstP99Ms?: number;
  /** Lowest availability over the use cases, 0–1. */
  minAvailability?: number;
  useCases: ReviewUseCaseMetrics[];
  /** Node ids whose loss takes a use case down. */
  singlePointsOfFailure: string[];
  /** Node ids at or past their capacity. */
  saturated: string[];
  warnings: string[];
  /** `cost <= …`, and the test that checks it. */
  costLimit?: { maxUsd: number; testId?: string };
  nodes?: ReviewNodeMetrics[];
}

/** What the page sends to `POST /api/review`. */
export interface DesignReviewRequest {
  /** The practice problem, when reviewing a solution to one; absent in the editor. */
  problem?: { id: string; version: number; title: string };
  /** The design as written (for a problem: the solver's file, which imports the given). */
  source: string;
  model: ModelSummary;
  /** The tests of the current source; absent when there are none (outside practice). */
  tests?: ReviewTests;
  /** Absent when the simulation could not run (errors, no engine). */
  metrics?: ReviewMetrics;
}

export type ReviewSeverity = 'info' | 'minor' | 'major' | 'critical';
export const REVIEW_SEVERITIES: readonly ReviewSeverity[] = ['info', 'minor', 'major', 'critical'];

export interface DesignReviewIssue {
  severity: ReviewSeverity;
  title: string;
  detail: string;
  /** The node it is about, so the page can point at it. */
  nodeId?: string;
}

/** What `POST /api/review` answers with, once implemented, and what the rule reviewer gives. */
export interface DesignReview {
  summary: string;
  strengths: string[];
  issues: DesignReviewIssue[];
  suggestions: string[];
  /** Who wrote it: `rules` for the page's own reviewer (./rules.ts); absent for the API's. */
  by?: 'rules';
}

// ---------- limits ----------

/** Same as a recorded run's source (backend/src/progress.ts MAX_SOURCE). */
export const MAX_REVIEW_SOURCE = 64 * 1024;
/** The whole JSON body. */
export const MAX_REVIEW_BODY = 192 * 1024;
export const MAX_REVIEW_ITEMS = 500;
const MAX_TEXT = 2000;
/** reviewRequestProblem's answer for a source past MAX_REVIEW_SOURCE (the Worker answers 413 for it, 400 for the rest). */
export const SOURCE_TOO_LONG = 'source is too long';
const PROBLEM_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// ---------- validation ----------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = MAX_TEXT): v is string => typeof v === 'string' && v.length <= max;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const optional = (v: unknown, check: (v: unknown) => boolean) => v === undefined || check(v);
const listOf = (v: unknown, check: (item: unknown) => boolean) => Array.isArray(v) && v.length <= MAX_REVIEW_ITEMS && v.every(check);

function modelProblem(m: unknown): string | undefined {
  if (!isObj(m)) return 'model must be an object';
  if (!optional(m.title, isStr)) return 'model.title must be a string';
  const node = (n: unknown) =>
    isObj(n) && isStr(n.id) && isStr(n.name) && isStr(n.tech) && optional(n.kind, isStr) && optional(n.replicas, isNum) && optional(n.given, (g) => typeof g === 'boolean');
  if (!listOf(m.nodes, node)) return `model.nodes must be a list of at most ${MAX_REVIEW_ITEMS} {id, name, tech, kind?, replicas?, given?}`;
  const edge = (e: unknown) => isObj(e) && isStr(e.source) && isStr(e.target) && optional(e.label, isStr);
  if (!listOf(m.edges, edge)) return `model.edges must be a list of at most ${MAX_REVIEW_ITEMS} {source, target, label?}`;
  if (!listOf(m.useCases, (u) => isStr(u))) return 'model.useCases must be a list of strings';
  if (!listOf(m.decisions, (d) => isStr(d))) return 'model.decisions must be a list of strings';
  const diagnostic = (d: unknown) => isObj(d) && (d.severity === 'error' || d.severity === 'warning') && isStr(d.message) && optional(d.line, isNum);
  if (!listOf(m.diagnostics, diagnostic)) return 'model.diagnostics must be a list of {severity, message, line?}';
  return undefined;
}

function testsProblem(t: unknown): string | undefined {
  if (!isObj(t)) return 'tests must be an object';
  if (!isNum(t.passed) || !isNum(t.total) || typeof t.solved !== 'boolean') return 'tests needs passed, total and solved';
  if (!optional(t.blocked, (b) => b === 'no-engine' || b === 'errors')) return 'tests.blocked must be "no-engine" or "errors"';
  const result = (r: unknown) => isObj(r) && isStr(r.id) && isStr(r.name) && isStr(r.category) && typeof r.passed === 'boolean' && isStr(r.message) && optional(r.hint, isStr);
  if (!listOf(t.results, result)) return 'tests.results must be a list of {id, name, category, passed, message, hint?}';
  return undefined;
}

function metricsProblem(m: unknown): string | undefined {
  if (!isObj(m)) return 'metrics must be an object';
  if (!isNum(m.costUsd)) return 'metrics.costUsd must be a number';
  if (!optional(m.worstP99Ms, isNum) || !optional(m.minAvailability, isNum)) return 'metrics.worstP99Ms and metrics.minAvailability must be numbers';
  if (!listOf(m.useCases, isUseCaseMetrics)) return 'metrics.useCases must be a list of {name, rps, p99Ms, availability, …}';
  for (const key of ['singlePointsOfFailure', 'saturated', 'warnings'] as const) {
    if (!listOf(m[key], (s) => isStr(s))) return `metrics.${key} must be a list of strings`;
  }
  if (!optional(m.costLimit, (c) => isObj(c) && isNum(c.maxUsd) && optional(c.testId, isStr))) return 'metrics.costLimit must be {maxUsd, testId?}';
  if (!optional(m.nodes, (n) => listOf(n, isNodeMetrics))) return 'metrics.nodes must be a list of node metrics';
  return undefined;
}

const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

function isNodeMetrics(n: unknown): boolean {
  return (
    isObj(n) &&
    isStr(n.id) &&
    isStr(n.kind) &&
    [n.replicas, n.shards, n.loadRps, n.utilization, n.latencyMs, n.availability, n.costUsd, n.instanceCostUsd].every(isNum) &&
    optional(n.writeBound, isBool) &&
    optional(n.bandwidthBound, isBool) &&
    isBool(n.durable) &&
    listOf(n.loadBy, (l) => isObj(l) && isStr(l.useCase) && isNum(l.rps)) &&
    listOf(n.usedBy, (u) => isStr(u))
  );
}

function isUseCaseMetrics(u: unknown): boolean {
  if (!(isObj(u) && isStr(u.name) && isNum(u.rps) && isNum(u.p99Ms) && isNum(u.availability))) return false;
  const latency = (l: unknown) => isObj(l) && isStr(l.percentile) && isNum(l.ms) && isNum(l.limitMs) && optional(l.tailScenario, isStr) && optional(l.testId, isStr);
  const dependency = (d: unknown) => isObj(d) && isStr(d.nodeId) && isBool(d.fallback) && isNum(d.availability);
  const write = (w: unknown) => isObj(w) && isStr(w.nodeId) && (w.timing === 'sync' || w.timing === 'async' || w.timing === 'after');
  const hop = (h: unknown) => isObj(h) && isStr(h.from) && isStr(h.to) && isNum(h.ms) && optional(h.transferMs, isNum) && optional(h.async, isBool) && optional(h.failed, isBool);
  const scenario = (s: unknown) => isObj(s) && isStr(s.name) && isNum(s.share) && isBool(s.success) && listOf(s.path, hop);
  return (
    optional(u.latency, (l) => listOf(l, latency)) &&
    optional(u.availabilityLimit, (a) => isObj(a) && isNum(a.min) && optional(a.testId, isStr)) &&
    optional(u.durableTestId, isStr) &&
    optional(u.entryWrite, isBool) &&
    optional(u.dependencies, (d) => listOf(d, dependency)) &&
    optional(u.writes, (w) => listOf(w, write)) &&
    optional(u.scenarios, (s) => listOf(s, scenario))
  );
}

/**
 * What is wrong with a review request body, or undefined when it is a valid
 * DesignReviewRequest. The size of the source is checked here; the size of
 * the whole body is the caller's (MAX_REVIEW_BODY).
 */
export function reviewRequestProblem(body: unknown): string | undefined {
  if (!isObj(body)) return 'The body must be a JSON object';
  const known = ['problem', 'source', 'model', 'tests', 'metrics'];
  const unknown = Object.keys(body).find((k) => !known.includes(k));
  if (unknown) return `Unknown field ${JSON.stringify(unknown.slice(0, 64))}`;
  if (typeof body.source !== 'string') return 'source must be a string';
  if (body.source.length > MAX_REVIEW_SOURCE) return SOURCE_TOO_LONG;
  if (body.problem !== undefined) {
    const p = body.problem;
    if (!isObj(p) || typeof p.id !== 'string' || !PROBLEM_ID.test(p.id) || p.id.length > 100) return 'problem.id must be a problem id';
    if (!(isNum(p.version) && Number.isInteger(p.version) && p.version >= 1)) return 'problem.version must be a whole number from 1';
    if (!isStr(p.title)) return 'problem.title must be a string';
  }
  return modelProblem(body.model) ?? (body.tests === undefined ? undefined : testsProblem(body.tests)) ?? (body.metrics === undefined ? undefined : metricsProblem(body.metrics));
}

/** A DesignReview from an untrusted answer; throws on anything else. Unknown fields are dropped. */
export function parseDesignReview(data: unknown): DesignReview {
  const fail = (what: string): never => {
    throw new Error(`Malformed design review: ${what}`);
  };
  if (!isObj(data)) return fail('not an object');
  const strings = (v: unknown, key: string) => (Array.isArray(v) && v.every((s) => typeof s === 'string') ? (v as string[]) : fail(`${key} must be a list of strings`));
  if (typeof data.summary !== 'string') fail('summary must be a string');
  if (!Array.isArray(data.issues)) fail('issues must be a list');
  const issues = (data.issues as unknown[]).map((i): DesignReviewIssue => {
    if (!isObj(i) || !REVIEW_SEVERITIES.includes(i.severity as ReviewSeverity) || typeof i.title !== 'string' || typeof i.detail !== 'string') {
      return fail('each issue needs severity, title and detail');
    }
    if (i.nodeId !== undefined && typeof i.nodeId !== 'string') fail('issue nodeId must be a string');
    return { severity: i.severity as ReviewSeverity, title: i.title, detail: i.detail, ...(typeof i.nodeId === 'string' ? { nodeId: i.nodeId } : {}) };
  });
  return { summary: data.summary as string, strengths: strings(data.strengths, 'strengths'), issues, suggestions: strings(data.suggestions, 'suggestions') };
}
