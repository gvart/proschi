import { accessOf, type Access } from '../dsl/access';
import { kindOf } from '../dsl/kinds';
import type { Diagram, DiagramStep } from '../dsl/types';

/**
 * Read or write, per docs/design/hld-and-practice.md §7.2. The parser sets
 * `step.access` on every request step; steps built by hand without one are
 * classified with the parser's own rule (`accessOf` in dsl/access.ts), so the
 * two never drift.
 */
export function stepAccess(step: Pick<DiagramStep, 'access' | 'httpMethod' | 'stepName'>): Access {
  return step.access ?? accessOf(step.httpMethod, step.stepName ?? '');
}

/**
 * Access of the steps of `diagram`: as `stepAccess`, except that a request to
 * a queue is always a write, whatever the arrow and the label (§7.2): the
 * queue stores the message, `api ->> jobs : OrderPlaced` included.
 */
export function accessIn(diagram: Pick<Diagram, 'nodes'>): (step: DiagramStep) => Access {
  const queues = new Set(diagram.nodes.filter((n) => kindOf(n) === 'queue').map((n) => n.id));
  return (step) => (queues.has(step.toServiceId) ? 'write' : stepAccess(step));
}
