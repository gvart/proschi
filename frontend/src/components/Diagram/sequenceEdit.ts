import { addParallelStep, addStep, addStepAfter, type EditResult, type NewStep, type OutlineStep } from '../../dsl/edit';
import type { Diagram } from '../../dsl/types';
import type { Slot } from './sequenceLayout';

/**
 * The Flows pane's edits on its sequence diagram (FlowsPanel.tsx), as plain
 * functions: adding a step at an insertion point, and finding the step (or
 * steps) an edit made or moved, so the selection goes with it. Every edit is
 * one of dsl/edit.ts, which addresses steps by line.
 */

/** Adds `step` at `slot` of the use case `useCase`. */
export function insertAt(source: string, useCase: string, slot: Slot, step: NewStep, design?: Diagram): EditResult {
  if (slot.kind === 'before') return addStep(source, useCase, step, undefined, slot.line, design);
  if (slot.kind === 'scenario') return addStep(source, useCase, step, slot.name, undefined, design);
  if (slot.kind === 'after') return addStepAfter(source, useCase, step, slot.line, design);
  if (slot.kind === 'par') return addParallelStep(source, slot.line, step, design);
  return addStep(source, useCase, step, undefined, undefined, design);
}

const same = (a: OutlineStep, b: OutlineStep) => a.from === b.from && a.to === b.to && a.kind === b.kind && a.label === b.label;

/**
 * The step an insertion added: the first place the steps differ, in text
 * order (sequenceLayout.ts allSteps). Lines shift, so steps are compared by
 * what they say. A step added before its twin (one that says the same) is
 * the first of the two, which `slot` tells.
 */
export function insertedStep(before: OutlineStep[], after: OutlineStep[], slot?: Slot): OutlineStep | undefined {
  if (after.length !== before.length + 1) return undefined;
  const found = before.findIndex((s, k) => !same(s, after[k]));
  let i = found === -1 ? before.length : found;
  if (slot?.kind === 'before') while (i > 0 && same(after[i - 1], after[i])) i--;
  return after[i];
}

/**
 * The steps that `selected` are after an edit that kept every step and their
 * order (a step changed in place, steps grouped or ungrouped): the same
 * places in the new list. Undefined when the steps are not one for one.
 */
export function samePlaces(before: OutlineStep[], after: OutlineStep[], selected: OutlineStep[]): OutlineStep[] | undefined {
  if (after.length !== before.length) return undefined;
  const found = selected.map((s) => after[before.findIndex((b) => b.line === s.line)]);
  return found.every(Boolean) ? found : undefined;
}

/**
 * Where the step on `line` went after moving it `direction`: the step that
 * says the same, nearest on that side of its old line (two steps can say the
 * same; moving adds no lines).
 */
export function movedStep(after: OutlineStep[], step: OutlineStep, direction: 'up' | 'down'): OutlineStep | undefined {
  const side = after.filter((s) => same(s, step) && (direction === 'up' ? s.line < step.line : s.line > step.line));
  return side.sort((a, b) => Math.abs(a.line - step.line) - Math.abs(b.line - step.line))[0];
}

/** The insertion point nearest a height in the diagram (a drop of a drag between lifelines). */
export function slotNear<T extends { y: number }>(slots: T[], y: number): T | undefined {
  return slots.reduce<T | undefined>((best, s) => (!best || Math.abs(s.y - y) < Math.abs(best.y - y) ? s : best), undefined);
}
