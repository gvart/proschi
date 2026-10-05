import type { Diagram, ParseResult } from '../dsl/types';
import type { Analysis } from '../hld/engine';
import type { Problem } from '../practice/types';
import type { RunResult } from '../practice/workspace';
import { MAX_REVIEW_ITEMS, type DesignReviewRequest, type ModelSummary, type ReviewMetrics, type ReviewTests } from './contract';

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
    results: cap(run.results.map((r) => ({ id: r.id, name: r.name, category: r.category, passed: r.passed, message: r.message }))),
  };
}

export function reviewMetrics(analysis: Analysis): ReviewMetrics {
  const useCases = analysis.useCases.map((u) => ({ name: u.name, rps: u.rps, p99Ms: u.percentiles.p99, availability: u.availability }));
  const p99s = useCases.map((u) => u.p99Ms).filter(Number.isFinite);
  const availabilities = useCases.map((u) => u.availability).filter(Number.isFinite);
  return {
    costUsd: finite(analysis.totalCostUsd) ?? 0,
    ...(p99s.length ? { worstP99Ms: Math.max(...p99s) } : {}),
    ...(availabilities.length ? { minAvailability: Math.min(...availabilities) } : {}),
    // JSON has no Infinity: a use case that times out reports the cap as null otherwise.
    useCases: cap(useCases.filter((u) => Number.isFinite(u.p99Ms) && Number.isFinite(u.availability) && Number.isFinite(u.rps))),
    singlePointsOfFailure: cap(analysis.singlePointsOfFailure),
    saturated: cap(analysis.nodes.filter((n) => n.saturated).map((n) => n.id)),
    warnings: cap(analysis.warnings),
  };
}

export function buildReviewRequest({ problem, source, parsed, run, analysis, givenFiles }: ReviewInput): DesignReviewRequest {
  return {
    ...(problem ? { problem: { id: problem.id, version: problem.version ?? 1, title: problem.title } } : {}),
    source,
    model: modelSummary(parsed.diagram, parsed.diagnostics, analysis, givenFiles),
    ...(run ? { tests: reviewTests(run) } : {}),
    ...(analysis ? { metrics: reviewMetrics(analysis) } : {}),
  };
}
