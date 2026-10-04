import { buildSequence, sequenceMessages, type SequenceMessage } from '../dsl/sequence';
import type { Diagram, DiagramNode, DiagramScenario, DiagramStep, DiagramUseCase, Selector } from '../dsl/types';
import { kindOf } from './kinds';

/**
 * How scenarios run, as the simulation and the tests read them: which steps
 * hold up the entry request, what happens before it is answered, and how
 * selectors pick nodes. Order is the sequence order of dsl/sequence.ts.
 */

/** Finds a use case by name (exact, then ignoring case), or by id. */
export function findUseCase(diagram: Diagram, name: string): DiagramUseCase | undefined {
  const lower = name.toLowerCase();
  return (
    diagram.useCases.find((u) => u.name === name) ??
    diagram.useCases.find((u) => u.name.toLowerCase() === lower) ??
    diagram.useCases.find((u) => u.id === name)
  );
}

/** Finds a scenario by its full name (`A › B`, also written `A > B`), ignoring case, or by id. */
export function findScenario(useCase: DiagramUseCase, name: string): DiagramScenario | undefined {
  const norm = (s: string) => s.replace(/\s*(›|>)\s*/g, ' › ').trim().toLowerCase();
  const wanted = norm(name);
  return useCase.scenarios.find((s) => s.name === name) ?? useCase.scenarios.find((s) => norm(s.name) === wanted || s.id === name);
}

/**
 * Whether `step` is written after the line that answers the entry request.
 * The parser folds each `-->` into its request, and buildSequence answers
 * calls only when the call stack unwinds, so `api --> client` followed by
 * `api -> db` would otherwise read as a write before responding.
 */
function afterEntryResponse(entry: DiagramStep, step: DiagramStep): boolean {
  const r = entry.responseLoc;
  if (!r || step === entry || step.loc.file !== r.file) return false;
  return step.loc.line > r.line || (step.loc.line === r.line && step.loc.col > r.col);
}

/** One request on the critical path of the entry request. */
export interface Hop {
  step: DiagramStep;
  target: string;
  /** `-x`: costs a timeout. */
  failed: boolean;
  /** `->>`: only the send counts, not what the receiver does next. */
  async: boolean;
}

/**
 * The synchronous critical path of a scenario's entry request, as a list of
 * parts that run one after another; a part with several hops is a `par` group,
 * whose slowest member counts.
 *
 * A request counts when it is sent before the entry request is answered, by a
 * node that is working on it synchronously: the entry's sender, or the target
 * of a counted synchronous request that has not answered yet. So async sends
 * count their own hop but not the receiver's work, and nothing after the entry
 * response counts (in sequence order, or written after its `-->` line).
 */
export function criticalPath(useCase: DiagramUseCase, scenario: DiagramScenario): Hop[][] {
  const entry = scenario.steps[0];
  if (!entry) return [];
  const { items } = buildSequence(useCase, scenario);
  const working = new Map<string, number>([[entry.fromServiceId, 1]]);
  const opened = new Set<DiagramStep>();
  let answered = false;
  const parts: Hop[][] = [];

  const visit = (m: SequenceMessage, hops: Hop[]) => {
    if (m.kind === 'response') {
      if (opened.delete(m.step)) working.set(m.step.toServiceId, (working.get(m.step.toServiceId) ?? 1) - 1);
      if (m.step === entry) answered = true;
      return;
    }
    if (afterEntryResponse(entry, m.step)) answered = true;
    if (answered || !working.get(m.from)) return;
    hops.push({ step: m.step, target: m.to, failed: m.failed, async: m.async });
    if (!m.async && !m.failed) {
      opened.add(m.step);
      working.set(m.to, (working.get(m.to) ?? 0) + 1);
    }
  };

  for (const item of items) {
    const hops: Hop[] = [];
    if (item.kind === 'message') visit(item.message, hops);
    else for (const branch of item.branches) for (const m of branch) visit(m, hops);
    if (hops.length) parts.push(hops);
  }
  return parts;
}

/** Nodes the entry request needs up: its sender and every non-failed hop of the critical path. */
export function pathNodes(useCase: DiagramUseCase, scenario: DiagramScenario): string[] {
  const entry = scenario.steps[0];
  if (!entry) return [];
  const ids = [entry.fromServiceId, ...criticalPath(useCase, scenario).flatMap((part) => part.filter((h) => !h.failed).map((h) => h.target))];
  return [...new Set(ids)];
}

/** Requests in sequence order, and how many of them are sent before the entry request is answered. */
export function requestOrder(useCase: DiagramUseCase, scenario: DiagramScenario): { requests: SequenceMessage[]; beforeResponse: number } {
  const entry = scenario.steps[0];
  const messages = sequenceMessages(buildSequence(useCase, scenario).items);
  const requests: SequenceMessage[] = [];
  let beforeResponse = -1;
  for (const m of messages) {
    if (m.kind === 'request') {
      if (beforeResponse < 0 && entry && afterEntryResponse(entry, m.step)) beforeResponse = requests.length;
      requests.push(m);
    } else if (m.step === entry && beforeResponse < 0) beforeResponse = requests.length;
  }
  return { requests, beforeResponse: beforeResponse < 0 ? requests.length : beforeResponse };
}

/**
 * Whether the scenario sends a synchronous, non-failed request to a node
 * accepted by `accept` before its entry request is answered.
 */
export function writesBeforeResponse(useCase: DiagramUseCase, scenario: DiagramScenario, accept: (nodeId: string) => boolean): boolean {
  const { requests, beforeResponse } = requestOrder(useCase, scenario);
  return requests.slice(0, beforeResponse).some((m) => !m.async && !m.failed && accept(m.to));
}

/** The scenario calls `nodeId` and gets an answer (or at least does not fail). */
export function callsOk(scenario: DiagramScenario, nodeId: string): boolean {
  return scenario.steps.some((s) => s.toServiceId === nodeId && !s.failed);
}

/** A success scenario of the use case needs `nodeId`. */
export function needs(useCase: DiagramUseCase, nodeId: string): boolean {
  return useCase.scenarios.some((s) => s.outcome === 'success' && callsOk(s, nodeId));
}

/** Success scenarios that call `nodeId` with `-x` and complete without it. */
export function fallbacksFor(useCase: DiagramUseCase, nodeId: string): DiagramScenario[] {
  return useCase.scenarios.filter(
    (s) => s.outcome === 'success' && s.steps.some((step) => step.toServiceId === nodeId && step.failed) && !callsOk(s, nodeId),
  );
}

/** `db`, `[PostgreSQL]`, `any database`. */
export function selectorText(selector: Selector): string {
  if ('node' in selector) return selector.node;
  if ('tech' in selector) return `[${selector.tech}]`;
  return `any ${selector.kind}`;
}

/** Components (not groups or text) the selector picks. */
export function selectNodes(diagram: Diagram, selector: Selector): DiagramNode[] {
  return diagram.nodes.filter((n) => n.kind === 'component' && matches(n, selector));
}

export function matches(node: DiagramNode, selector: Selector): boolean {
  if (node.kind !== 'component') return false;
  if ('node' in selector) return node.id === selector.node;
  if ('tech' in selector) return node.techStack.toLowerCase() === selector.tech.toLowerCase();
  return kindOf(node) === selector.kind;
}

/** `PostgreSQL` for a declared node, nothing for one only referenced. */
export function techOf(node: DiagramNode | undefined): string | undefined {
  return node && !node.implicit ? node.techStack : undefined;
}

/** `db (PostgreSQL)` */
export function nodeLabel(diagram: Diagram, id: string): string {
  const tech = techOf(diagram.nodes.find((n) => n.id === id));
  return tech ? `${id} (${tech})` : id;
}
