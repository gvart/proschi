import { isKind, kindMatches, kindOf } from '../../dsl/kinds';
import type { Diagram, DiagramNode, Kind } from '../../dsl/types';
import type { TestResult } from '../../hld/engine';
import { hasText, metaOf, numberedLines, readItem, splitAt, type FileIssue } from './mdItems';

/**
 * A problem's guided walkthrough, `guided.md` in its folder (docs/PRACTICE.md,
 * "Guided mode"): steps from the starter to a passing design, each with a
 * short explanation and a checkpoint, structural checks on the parsed design
 * or tests that must pass, before the next step unlocks. Only the roadmap's
 * first stage has them. Pure.
 *
 *   ## Put an API in front of the data
 *   - node: any service
 *   - edge: visitor -> any service
 *
 *   Markdown explaining the step.
 *
 * A node is written as its id (`visitor`) or `any <kind>` (`any cache`), the
 * same selectors as the tests in problem.proschi.
 */

export type Selector = { id: string } | { kind: Kind };

export type GuidedCheck =
  /** At least one node matches. */
  | { type: 'node'; node: Selector }
  /** A connection, or a use case step, from a node matching `from` to one matching `to`. */
  | { type: 'edge'; from: Selector; to: Selector }
  /** A use case with this name. */
  | { type: 'usecase'; name: string }
  /** At least one node matches, and every matching node has at least `min` replicas. */
  | { type: 'replicas'; node: Selector; min: number }
  /** The requirement or test of this name passes. */
  | { type: 'test'; name: string };

export interface GuidedStep {
  title: string;
  /** Markdown. */
  explanation: string;
  checks: GuidedCheck[];
}

export const MIN_STEPS = 2;
export const MAX_STEPS = 10;
const KEYS = ['node', 'edge', 'usecase', 'replicas', 'test'] as const;

/** `visitor` or `any cache`; undefined for anything else. */
export function readSelector(text: string): Selector | undefined {
  const t = text.trim();
  const any = /^any\s+([a-z]+)$/.exec(t);
  if (any) return isKind(any[1]) ? { kind: any[1] } : undefined;
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(t) ? { id: t } : undefined;
}

export function selectorText(s: Selector): string {
  return 'id' in s ? s.id : `any ${s.kind}`;
}

/** Reads guided.md. Never throws: what is wrong is in `issues`, the steps that could be read in `steps`. */
export function parseGuided(text: string): { steps: GuidedStep[]; issues: FileIssue[] } {
  const issues: FileIssue[] = [];
  const steps: GuidedStep[] = [];
  if (!text.trim()) return { steps, issues: [{ message: 'The walkthrough is empty' }] };
  const { preamble, parts } = splitAt(numberedLines(text), 2);
  if (hasText(preamble)) issues.push({ message: 'Each step is a "## " heading; nothing goes before the first one', line: preamble.find((l) => l.text.trim())?.line });
  for (const part of parts) {
    const item = readItem(part);
    const meta = metaOf(item, KEYS, issues, KEYS);
    const checks: GuidedCheck[] = [];
    const bad = (line: number, message: string) => issues.push({ message: `"${item.title}": ${message}`, line });
    for (const m of item.meta) {
      if (!(KEYS as readonly string[]).includes(m.key)) continue;
      if (m.key === 'node') {
        const node = readSelector(m.value);
        if (node) checks.push({ type: 'node', node });
        else bad(m.line, `"- node:" takes a node id or "any <kind>", not "${m.value}"`);
      } else if (m.key === 'edge') {
        const e = /^(.+?)\s*->\s*(.+)$/.exec(m.value);
        const from = e ? readSelector(e[1]) : undefined;
        const to = e ? readSelector(e[2]) : undefined;
        if (from && to) checks.push({ type: 'edge', from, to });
        else bad(m.line, `"- edge:" takes "<node> -> <node>", each an id or "any <kind>", not "${m.value}"`);
      } else if (m.key === 'usecase' || m.key === 'test') {
        const name = m.value.replace(/^"(.*)"$/, '$1');
        if (name) checks.push({ type: m.key, name });
        else bad(m.line, `"- ${m.key}:" takes a name`);
      } else if (m.key === 'replicas') {
        const r = /^(.+?)\s+x(\d+)$/.exec(m.value);
        const node = r ? readSelector(r[1]) : undefined;
        const min = r ? Number(r[2]) : 0;
        if (node && min >= 2) checks.push({ type: 'replicas', node, min });
        else bad(m.line, `"- replicas:" takes "<node> x<n>" with n of 2 or more, e.g. "any service x2"`);
      }
    }
    if (meta.size === 0) bad(item.line, 'a step needs at least one check (- node, - edge, - usecase, - replicas or - test)');
    if (!item.body) bad(item.line, 'write what to do and why under the checks');
    steps.push({ title: item.title, explanation: item.body, checks });
  }
  if (steps.length < MIN_STEPS) issues.push({ message: `At least ${MIN_STEPS} steps (there are ${steps.length})` });
  if (steps.length > MAX_STEPS) issues.push({ message: `At most ${MAX_STEPS} steps (there are ${steps.length})` });
  return { steps, issues };
}

function matches(node: DiagramNode, s: Selector): boolean {
  return 'id' in s ? node.id === s.id : kindMatches(kindOf(node), s.kind);
}

export interface CheckResult {
  check: GuidedCheck;
  passed: boolean;
  /** What the check asks for, as a sentence. */
  label: string;
}

const kindWord = (k: Kind) => (k === 'loadbalancer' ? 'load balancer' : k);
const nodeText = (s: Selector) => ('id' in s ? `\`${s.id}\`` : `a ${kindWord(s.kind)}`);

/** What a check asks for, in words: "A connection from `visitor` to a service". */
export function describeCheck(c: GuidedCheck): string {
  switch (c.type) {
    case 'node':
      return 'id' in c.node ? `The node ${nodeText(c.node)}` : `A node of kind ${kindWord(c.node.kind)}`;
    case 'edge':
      return `A connection from ${nodeText(c.from)} to ${nodeText(c.to)}`;
    case 'usecase':
      return `The use case **${c.name}**`;
    case 'replicas':
      return 'id' in c.node ? `${nodeText(c.node)} with at least ${c.min} replicas` : `Every ${kindWord(c.node.kind)} with at least ${c.min} replicas (\`x${c.min}\`)`;
    case 'test':
      return `The test “${c.name}” passes`;
  }
}

/**
 * Runs a step's checks on a parsed design. `tests` is called at most once,
 * and only when a check needs a test result (it runs the simulation); it
 * returns undefined when the tests cannot run (errors in the design).
 */
export function evaluateChecks(checks: GuidedCheck[], diagram: Diagram, tests: () => TestResult[] | undefined): CheckResult[] {
  let results: TestResult[] | undefined | null = null;
  const testResults = () => {
    if (results === null) results = tests();
    return results;
  };
  const connected = (from: Selector, to: Selector) => {
    const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
    const pairs: [string, string][] = [
      ...diagram.edges.map((e): [string, string] => [e.source, e.target]),
      ...diagram.useCases.flatMap((u) => u.scenarios.flatMap((s) => s.steps.map((st): [string, string] => [st.fromServiceId, st.toServiceId]))),
    ];
    return pairs.some(([a, b]) => {
      const na = byId.get(a);
      const nb = byId.get(b);
      return !!na && !!nb && matches(na, from) && matches(nb, to);
    });
  };
  return checks.map((check) => {
    let passed = false;
    switch (check.type) {
      case 'node':
        passed = diagram.nodes.some((n) => matches(n, check.node));
        break;
      case 'edge':
        passed = connected(check.from, check.to);
        break;
      case 'usecase':
        passed = diagram.useCases.some((u) => u.name === check.name);
        break;
      case 'replicas': {
        const nodes = diagram.nodes.filter((n) => matches(n, check.node));
        passed = nodes.length > 0 && nodes.every((n) => (n.replicas ?? 1) >= check.min);
        break;
      }
      case 'test':
        passed = !!testResults()?.find((r) => r.name === check.name)?.passed;
        break;
    }
    return { check, passed, label: describeCheck(check) };
  });
}

/**
 * Everything wrong with a problem's guided.md: the file's own issues, ids,
 * use cases and tests the problem does not have, and checks the reference
 * solution fails (every step must be reachable on the way to it).
 */
export function guidedIssues(text: string, solution: Diagram, solutionTests: TestResult[] | undefined): FileIssue[] {
  const { steps, issues } = parseGuided(text);
  const ids = new Set(solution.nodes.map((n) => n.id));
  const testNames = new Set((solutionTests ?? []).map((r) => r.name));
  const lines = text.split('\n');
  const lineOf = (title: string) => lines.findIndex((l) => /^##\s/.test(l) && l.includes(title)) + 1 || undefined;
  for (const step of steps) {
    const line = lineOf(step.title);
    for (const c of step.checks) {
      const selectors = c.type === 'edge' ? [c.from, c.to] : c.type === 'node' || c.type === 'replicas' ? [c.node] : [];
      for (const s of selectors) if ('id' in s && !ids.has(s.id)) issues.push({ message: `"${step.title}": no node "${s.id}" in the given or the reference solution; use a given id or "any <kind>"`, line });
      if (c.type === 'usecase' && !solution.useCases.some((u) => u.name === c.name)) issues.push({ message: `"${step.title}": the reference solution has no use case "${c.name}"`, line });
      if (c.type === 'test' && solutionTests && !testNames.has(c.name)) issues.push({ message: `"${step.title}": no requirement or test is named "${c.name}"`, line });
    }
    const failed = evaluateChecks(step.checks, solution, () => solutionTests).filter((r) => !r.passed);
    for (const r of failed) issues.push({ message: `"${step.title}": the reference solution fails the check "${r.label}"`, line });
  }
  return issues;
}

export interface GuidedProgress {
  /** Per step, in order: passed its checkpoint, or skipped. */
  done: ('passed' | 'skipped')[];
}

export type GuidedAction = { type: 'pass' | 'skip'; step: number } | { type: 'restart' };

/** The step to work on: the first one not done (`steps` when all are). */
export function currentStep(p: GuidedProgress): number {
  return p.done.length;
}

/** Steps unlock in order: only the current step can pass or be skipped. */
export function guidedReducer(p: GuidedProgress, a: GuidedAction, steps: number): GuidedProgress {
  if (a.type === 'restart') return { done: [] };
  if (a.step !== currentStep(p) || a.step >= steps) return p;
  return { done: [...p.done, a.type === 'pass' ? 'passed' : 'skipped'] };
}

/** Progress from storage; anything damaged reads as not started. */
export function readGuidedProgress(raw: unknown, steps: number): GuidedProgress {
  const done = (raw as Partial<GuidedProgress> | null)?.done;
  if (!Array.isArray(done) || !done.every((d) => d === 'passed' || d === 'skipped')) return { done: [] };
  return { done: done.slice(0, steps) };
}
