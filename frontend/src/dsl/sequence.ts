import type { FlowStep } from '../services/api';
import type { Diagram, DiagramNode, DiagramScenario, DiagramUseCase } from './types';

/**
 * A scenario as a sequence diagram: the parser folds each `-->` into its
 * request (status code and response body), so this puts the responses back
 * where they happened. Shared by the Mermaid export and the SVG renderer.
 */

export interface SequenceMessage {
  kind: 'request' | 'response';
  from: string;
  to: string;
  /** 1-based number of the request (a response carries its request's number). */
  number: number;
  label: string;
  /** `->>` (fire and forget or async request/response). */
  async: boolean;
  /** `-x`: the call never got an answer. */
  failed: boolean;
  /** A failed call, or a response with a 4xx/5xx status. */
  error: boolean;
  status?: number;
  step: FlowStep;
}

export type SequenceItem = { kind: 'message'; message: SequenceMessage } | { kind: 'par'; branches: SequenceMessage[][] };

export interface Participant {
  id: string;
  name: string;
  tech?: string;
}

export interface Sequence {
  useCase: DiagramUseCase;
  scenario: DiagramScenario;
  participants: Participant[];
  items: SequenceItem[];
  /** The scenario's `when` condition, if the parser provides one. */
  condition?: string;
}

const PAYLOAD_LIMIT = 40;

/** Collapses whitespace and cuts `text` to `max` characters, ending with an ellipsis. */
export function shorten(text: string, max = PAYLOAD_LIMIT): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** `POST /orders {"sku": …}`, `INSERT order`; the parser's `a → b` placeholder becomes empty. */
export function requestLabel(step: FlowStep): string {
  const name = !step.httpMethod && step.stepName === `${step.fromServiceId} → ${step.toServiceId}` ? '' : step.stepName;
  return [name, step.description, step.requestBody && shorten(step.requestBody)].filter(Boolean).join(' ');
}

/** `201 {"id": 1}`, or empty when the response has neither a status nor a body. */
export function responseLabel(step: FlowStep): string {
  return [step.statusCode, step.responseBody && shorten(step.responseBody)].filter((p) => p !== undefined && p !== '').join(' ');
}

function hasResponse(step: FlowStep): boolean {
  return !step.failed && (step.statusCode !== undefined || !!step.responseBody);
}

function request(step: FlowStep): SequenceMessage {
  return {
    kind: 'request',
    from: step.fromServiceId,
    to: step.toServiceId,
    number: step.stepOrder + 1,
    label: requestLabel(step),
    async: step.executionType !== 'SYNC_REQUEST_RESPONSE',
    failed: !!step.failed,
    error: !!step.failed,
    step,
  };
}

function response(step: FlowStep): SequenceMessage {
  return {
    kind: 'response',
    from: step.toServiceId,
    to: step.fromServiceId,
    number: step.stepOrder + 1,
    label: responseLabel(step),
    async: false,
    failed: false,
    error: (step.statusCode ?? 0) >= 400,
    status: step.statusCode,
    step,
  };
}

/**
 * Orders the messages of one scenario. Answered requests are kept on a call
 * stack; a step sent by someone other than the innermost callee answers the
 * calls above it first, and whatever is still open is answered at the end.
 * Inside `par`, each branch's response follows its request directly.
 */
export function buildSequence(useCase: DiagramUseCase, scenario: DiagramScenario, nodes: DiagramNode[] = []): Sequence {
  const items: SequenceItem[] = [];
  const stack: FlowStep[] = [];
  const emit = (message: SequenceMessage) => items.push({ kind: 'message', message });
  const unwindFor = (from: string) => {
    const depth = stack.map((s) => s.toServiceId).lastIndexOf(from);
    while (stack.length > depth + 1) emit(response(stack.pop()!));
  };

  const steps = scenario.steps;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.parallelGroup === undefined) {
      unwindFor(step.fromServiceId);
      emit(request(step));
      if (hasResponse(step)) stack.push(step);
      continue;
    }
    const group: FlowStep[] = [];
    while (i < steps.length && steps[i].parallelGroup === step.parallelGroup) group.push(steps[i++]);
    i--;
    unwindFor(step.fromServiceId);
    items.push({ kind: 'par', branches: group.map((s) => (hasResponse(s) ? [request(s), response(s)] : [request(s)])) });
  }
  while (stack.length) emit(response(stack.pop()!));

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const participants: Participant[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const node = byId.get(id);
    participants.push({ id, name: node?.name ?? id, tech: node && !node.implicit ? node.techStack : undefined });
  };
  for (const step of steps) {
    add(step.fromServiceId);
    add(step.toServiceId);
  }

  const condition = (scenario as { condition?: unknown }).condition;
  return { useCase, scenario, participants, items, condition: typeof condition === 'string' && condition ? condition : undefined };
}

/** Finds a use case and scenario (the first one by default), or undefined. */
export function findScenario(diagram: Diagram, useCaseId: string, scenarioId?: string): { useCase: DiagramUseCase; scenario: DiagramScenario } | undefined {
  const useCase = diagram.useCases.find((u) => u.id === useCaseId);
  const scenario = scenarioId ? useCase?.scenarios.find((s) => s.id === scenarioId) : useCase?.scenarios[0];
  return useCase && scenario ? { useCase, scenario } : undefined;
}

/** Every message in display order, flattening `par` branches. */
export function sequenceMessages(items: SequenceItem[]): SequenceMessage[] {
  return items.flatMap((item) => (item.kind === 'message' ? [item.message] : item.branches.flat()));
}
