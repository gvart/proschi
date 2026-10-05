import type { Diagram, DiagramStep, DiagramUseCase, ParseResult } from '../dsl/types';
import type { Analysis } from '../hld/engine';
import type { Problem } from '../practice/types';
import type { RunResult } from '../practice/workspace';
import { accessIn } from '../sim/access';
import { bandwidthBound, DEFAULT_TIMEOUT_MS, mainScenarioIndex, mainWrites, multiplierOf, PERCENTILE_KEYS, profilesOf, resolveTraffic, transferMs, writeBound } from '../sim/analyze';
import { criticalPath, fallbacksFor, findUseCase, needs, requestOrder } from '../sim/flow';
import {
  MAX_REVIEW_ITEMS,
  type DesignReviewRequest,
  type ModelSummary,
  type ReviewMetrics,
  type ReviewNodeMetrics,
  type ReviewTests,
  type ReviewUseCaseMetrics,
  type ReviewWrite,
} from './contract';

/**
 * Builds a DesignReviewRequest from what the page already has: the source,
 * its parse, the last test run and the simulation's analysis. Pure.
 */

export interface ReviewInput {
  /** The practice problem being solved; absent in the editor. */
  problem?: Pick<Problem, 'id' | 'title' | 'version'>;
  source: string;
  parsed: ParseResult;
  /** The tests of this source, when it was run. */
  run?: RunResult;
  /** The simulation of this source's diagram, when it ran. */
  analysis?: Analysis;
  /** Files the given is in (the problem's `problem.proschi`): their nodes are marked `given`. */
  givenFiles?: string[];
}

const cap = <T,>(items: T[]): T[] => items.slice(0, MAX_REVIEW_ITEMS);
const finite = (n: number) => (Number.isFinite(n) ? n : undefined);
const num = (n: number) => finite(n) ?? 0;

export function modelSummary(diagram: Diagram, diagnostics: ParseResult['diagnostics'], analysis?: Analysis, givenFiles: string[] = []): ModelSummary {
  const kinds = new Map(analysis?.nodes.map((n) => [n.id, n.kind]));
  return {
    ...(diagram.title ? { title: diagram.title } : {}),
    nodes: cap(
      diagram.nodes
        .filter((n) => n.kind === 'component')
        .map((n) => {
          const kind = kinds.get(n.id) ?? n.inferredKind;
          return {
            id: n.id,
            name: n.name,
            tech: String(n.techStack),
            ...(kind ? { kind } : {}),
            ...(n.replicas !== undefined ? { replicas: n.replicas } : {}),
            ...(n.loc.file !== undefined && givenFiles.includes(n.loc.file) ? { given: true } : {}),
          };
        }),
    ),
    edges: cap(diagram.edges.map((e) => ({ source: e.source, target: e.target, ...(e.label ? { label: e.label } : {}) }))),
    useCases: cap(diagram.useCases.map((u) => u.name)),
    decisions: cap((diagram.decisions ?? []).map((d) => d.title)),
    // Only the reviewed file's own lines; the given is error-free by construction.
    diagnostics: cap(diagnostics.filter((d) => d.file === undefined).map((d) => ({ severity: d.severity, message: d.message, line: d.line }))),
  };
}

export function reviewTests(run: RunResult): ReviewTests {
  return {
    passed: run.passed,
    total: run.results.length,
    solved: run.solved,
    ...(run.blocked ? { blocked: run.blocked } : {}),
    results: cap(
      run.results.map((r) => ({ id: r.id, name: r.name, category: r.category, passed: r.passed, message: r.message, ...(!r.passed && r.hint ? { hint: r.hint } : {}) })),
    ),
  };
}

/**
 * The simulation's numbers. With the diagram, also what a reviewer needs to
 * say why: each node's load by use case, and each use case's requirements,
 * critical paths, dependencies and writes.
 */
export function reviewMetrics(analysis: Analysis, diagram?: Diagram): ReviewMetrics {
  const useCases = analysis.useCases.map((u) => ({ name: u.name, rps: u.rps, p99Ms: u.percentiles.p99, availability: u.availability }));
  const p99s = useCases.map((u) => u.p99Ms).filter(Number.isFinite);
  const availabilities = useCases.map((u) => u.availability).filter(Number.isFinite);
  const details = diagram ? detailsByUseCase(diagram, analysis) : undefined;
  const costLimits = (diagram?.requirements ?? []).flatMap((r, i) => (r.kind === 'cost' ? [{ maxUsd: r.maxUsdPerMonth, testId: `req:${i + 1}` }] : []));
  return {
    costUsd: finite(analysis.totalCostUsd) ?? 0,
    ...(p99s.length ? { worstP99Ms: Math.max(...p99s) } : {}),
    ...(availabilities.length ? { minAvailability: Math.min(...availabilities) } : {}),
    // JSON has no Infinity: a use case that times out reports the cap as null otherwise.
    useCases: cap(
      useCases
        .map((u, i) => ({ ...u, ...details?.[i] }))
        .filter((u) => Number.isFinite(u.p99Ms) && Number.isFinite(u.availability) && Number.isFinite(u.rps)),
    ),
    singlePointsOfFailure: cap(analysis.singlePointsOfFailure),
    saturated: cap(analysis.nodes.filter((n) => n.saturated).map((n) => n.id)),
    warnings: cap(analysis.warnings),
    ...(costLimits.length ? { costLimit: costLimits.reduce((a, b) => (b.maxUsd < a.maxUsd ? b : a)) } : {}),
    ...(diagram ? { nodes: cap(nodeMetrics(diagram, analysis)) } : {}),
  };
}

function nodeMetrics(diagram: Diagram, analysis: Analysis): ReviewNodeMetrics[] {
  const traffic = resolveTraffic(diagram);
  const loadBy = new Map<string, Map<string, number>>();
  const usedBy = new Map<string, Set<string>>();
  for (const u of diagram.useCases) {
    const { rps, shares } = traffic.get(u.id) ?? { rps: 0, shares: [] };
    u.scenarios.forEach((s, i) => {
      for (const step of s.steps) {
        for (const id of [step.fromServiceId, step.toServiceId]) usedBy.set(id, (usedBy.get(id) ?? new Set<string>()).add(u.name));
        const rate = rps * (shares[i] ?? 0) * multiplierOf(step);
        if (step.failed || !(rate > 0)) continue;
        const byUseCase = loadBy.get(step.toServiceId) ?? new Map<string, number>();
        byUseCase.set(u.name, (byUseCase.get(u.name) ?? 0) + rate);
        loadBy.set(step.toServiceId, byUseCase);
      }
    });
  }
  return analysis.nodes.map((n) => ({
    id: n.id,
    kind: n.kind,
    replicas: n.replicas,
    shards: n.shards,
    loadRps: num(n.loadRps),
    utilization: num(n.utilization),
    ...(n.loadRps > 0 && writeBound(n) ? { writeBound: true } : {}),
    ...(n.loadRps > 0 && bandwidthBound(n) ? { bandwidthBound: true } : {}),
    latencyMs: num(n.latencyMs),
    availability: num(n.availability),
    costUsd: num(n.costUsd),
    instanceCostUsd: num(n.costUsd - n.egressUsd),
    durable: n.durable,
    loadBy: cap([...(loadBy.get(n.id) ?? [])].map(([useCase, rps]) => ({ useCase, rps: num(rps) })).sort((a, b) => b.rps - a.rps)),
    usedBy: cap([...(usedBy.get(n.id) ?? [])]),
  }));
}

/** Per use case of `analysis.useCases` (the diagram's order): requirements, critical paths, dependencies and writes. */
function detailsByUseCase(diagram: Diagram, analysis: Analysis): Partial<ReviewUseCaseMetrics>[] {
  const nodes = new Map(analysis.nodes.map((n) => [n.id, n]));
  const profiles = profilesOf(diagram);
  const access = accessIn(diagram);
  const isWrite = (step: DiagramStep) => access(step) === 'write';
  const timeoutOf = (id: string) => profiles.get(id)?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const bandwidthOf = (id: string) => profiles.get(id)?.bandwidthMBps ?? Infinity;
  const traffic = resolveTraffic(diagram);
  const requirements = (diagram.requirements ?? []).map((r, i) => ({ r, testId: `req:${i + 1}` }));
  const withTraffic = diagram.useCases.filter((u) => (traffic.get(u.id)?.rps ?? 0) > 0);
  /** Use cases a requirement applies to, as the tests read it: the one it names, or every one with traffic. */
  const targets = (name: string | undefined, anyWithoutTraffic = false): DiagramUseCase[] => {
    if (name !== undefined) {
      const u = findUseCase(diagram, name);
      return u ? [u] : [];
    }
    return withTraffic.length === 0 && anyWithoutTraffic ? diagram.useCases : withTraffic;
  };

  return diagram.useCases.map((u, index) => {
    const result = analysis.useCases[index];
    if (!result) return {};
    const shares = traffic.get(u.id)?.shares ?? [];
    const latency = requirements.flatMap(({ r, testId }) => {
      if (r.kind !== 'latency' || r.scenario !== undefined || !targets(r.useCase).includes(u)) return [];
      const key = PERCENTILE_KEYS[r.percentile];
      const ms = result.percentiles[key];
      if (!Number.isFinite(ms)) return [];
      const tail = u.scenarios[result.tailScenario[key] ?? 0];
      return [{ percentile: key, ms, limitMs: r.maxMs, ...(tail && u.scenarios.length > 1 ? { tailScenario: tail.name } : {}), testId }];
    });
    const availabilityLimits = requirements.flatMap(({ r, testId }) =>
      r.kind === 'availability' && targets(r.useCase, true).includes(u) ? [{ min: r.minPercent / 100, testId }] : [],
    );
    const durable = requirements.find(({ r }) => r.kind === 'durable' && findUseCase(diagram, r.useCase) === u);

    const writesOfMain = mainWrites(u, shares, isWrite);
    const dependencies = analysis.nodes
      .filter((n) => n.kind !== 'client' && n.kind !== 'other' && needs(u, n.id))
      .map((n) => ({
        nodeId: n.id,
        fallback: fallbacksFor(u, n.id).length > 0,
        availability: num(writesOfMain.has(n.id) ? n.writeAvailability : n.availability),
      }));

    // The writes of the main scenario (or the first success scenario, when the main one fails).
    const main = u.scenarios[mainScenarioIndex(shares)];
    const success = main?.outcome === 'success' ? main : u.scenarios.find((s) => s.outcome === 'success');
    const writes = new Map<string, ReviewWrite['timing']>();
    const rank = { sync: 0, async: 1, after: 2 } as const;
    if (success) {
      const { requests, beforeResponse } = requestOrder(u, success);
      requests.forEach((m, i) => {
        if (m.failed || !isWrite(m.step)) return;
        const timing: ReviewWrite['timing'] = i >= beforeResponse ? 'after' : m.async ? 'async' : 'sync';
        const seen = writes.get(m.to);
        if (seen === undefined || rank[timing] < rank[seen]) writes.set(m.to, timing);
      });
    }
    const entry = u.scenarios[0]?.steps[0];

    return {
      ...(latency.length ? { latency } : {}),
      ...(availabilityLimits.length ? { availabilityLimit: availabilityLimits.reduce((a, b) => (b.min > a.min ? b : a)) } : {}),
      ...(durable ? { durableTestId: durable.testId } : {}),
      ...(entry ? { entryWrite: isWrite(entry) } : {}),
      dependencies: cap(dependencies),
      writes: cap([...writes].map(([nodeId, timing]) => ({ nodeId, timing }))),
      scenarios: cap(
        u.scenarios.map((s, i) => ({
          name: s.name,
          share: num(shares[i] ?? 0),
          success: s.outcome === 'success',
          path: cap(
            criticalPath(u, s)
              .flat()
              .map((h) => {
                const transfer = h.failed ? 0 : num(transferMs(h.step, bandwidthOf));
                return {
                  from: h.step.fromServiceId,
                  to: h.target,
                  ms: num(h.failed ? timeoutOf(h.target) : (nodes.get(h.target)?.latencyMs ?? 0) + transfer),
                  ...(transfer > 0 ? { transferMs: transfer } : {}),
                  ...(h.async ? { async: true } : {}),
                  ...(h.failed ? { failed: true } : {}),
                };
              }),
          ),
        })),
      ),
    };
  });
}

export function buildReviewRequest({ problem, source, parsed, run, analysis, givenFiles }: ReviewInput): DesignReviewRequest {
  return {
    ...(problem ? { problem: { id: problem.id, version: problem.version ?? 1, title: problem.title } } : {}),
    source,
    model: modelSummary(parsed.diagram, parsed.diagnostics, analysis, givenFiles),
    ...(run ? { tests: reviewTests(run) } : {}),
    ...(analysis ? { metrics: reviewMetrics(analysis, parsed.diagram) } : {}),
  };
}
