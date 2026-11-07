import type { OutlineItem, OutlineStep, StepKind } from '../../dsl/edit';
import type { Diagram, Kind } from '../../dsl/types';

/**
 * What the Flows builder (FlowsPanel.tsx) suggests, as plain functions: the
 * use case and scenario names the problem asks for, the kind of the next step
 * and labels to pick from. Typing anything else always works.
 */

/** Every step of an outline, the main flow's and each scenario's, in text order. */
export function outlineSteps(items: OutlineItem[]): OutlineStep[] {
  return items.flatMap((item) => (item.kind === 'step' ? [item.step] : item.kind === 'scenarios' ? item.branches.flatMap((b) => b.steps) : []));
}

/**
 * A response when `from` was sent a request by `to` that is not answered yet
 * (the next thing after a call is usually its answer), else a request.
 */
export function defaultStepKind(steps: OutlineStep[], from: string, to: string): StepKind {
  let open = 0;
  for (const s of steps) {
    if (s.kind === 'request' && s.from === to && s.to === from) open++;
    else if (s.kind === 'response' && s.from === from && s.to === to) open = Math.max(0, open - 1);
  }
  return open > 0 ? 'response' : 'request';
}

/** Labels to pick from for a step of `kind` going to a component of `target` kind. */
export function labelSuggestions(kind: StepKind, target: Kind | undefined): string[] {
  if (kind === 'response') return ['200 OK', '201 Created', '302 Found', '404 Not found', 'ok', 'result'];
  if (kind === 'async') return target === 'queue' || target === 'broker' ? ['publish event', 'enqueue job'] : ['SET', 'notify', 'log'];
  switch (target) {
    case 'database':
    case 'search':
    case 'analytics':
      return ['SELECT', 'INSERT', 'UPDATE', 'query'];
    case 'cache':
      return ['GET', 'SET'];
    case 'queue':
    case 'broker':
      return ['publish', 'consume'];
    case 'storage':
      return ['GET object', 'PUT object'];
    default:
      return ['GET /', 'POST /', 'PUT /', 'DELETE /'];
  }
}

/** The use cases the problem's traffic names, which the design does not define yet. */
export function missingUseCases(diagram: Diagram, defined: string[]): string[] {
  return (diagram.traffic ?? []).map((t) => t.useCase).filter((name, i, all) => !defined.includes(name) && all.indexOf(name) === i);
}

/** The scenarios the problem's traffic mix names for a use case, which it does not have yet. */
export function missingScenarios(diagram: Diagram, useCase: string, defined: string[]): string[] {
  const entry = diagram.traffic?.find((t) => t.useCase === useCase);
  return (entry?.mix ?? []).map((m) => m.scenario).filter((name) => !defined.includes(name));
}
