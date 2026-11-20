import type { OutlineItem, OutlineStep, StepKind } from '../../dsl/edit';
import type { Diagram } from '../../dsl/types';

/**
 * What the Flows builder (FlowsPanel.tsx) suggests, as plain functions: the
 * use case and scenario names the problem asks for and the kind of the next
 * step. The labels come from the components' types (dsl/typesys/vocabulary.ts).
 */

/** Every step of an outline, the main flow's, each scenario's and each parallel block's, in text order. */
export function outlineSteps(items: OutlineItem[]): OutlineStep[] {
  return items.flatMap((item) =>
    item.kind === 'step' ? [item.step] : item.kind === 'scenarios' ? item.branches.flatMap((b) => b.steps) : item.kind === 'parallel' ? item.block.steps : [],
  );
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

/**
 * The latest request not answered yet, `from` waiting on `to`: what Reply
 * answers. Messages and failed calls wait for nothing.
 */
export function openRequest(steps: OutlineStep[]): { from: string; to: string } | undefined {
  const open: { from: string; to: string }[] = [];
  for (const s of steps) {
    if (s.kind === 'request') open.push({ from: s.from, to: s.to });
    else if (s.kind === 'response') {
      for (let i = open.length - 1; i >= 0; i--) {
        if (open[i].from !== s.to || open[i].to !== s.from) continue;
        open.splice(i, 1);
        break;
      }
    }
  }
  return open.at(-1);
}

/** A step's ends picked on the canvas: the first click sets where it starts, the next where it goes; a click after both starts over. */
export function nextPick(pick: { from?: string; to?: string }, id: string): { from?: string; to?: string } {
  if (!pick.from || (pick.to && pick.from !== id)) return { from: id };
  return id !== pick.from ? { ...pick, to: id } : pick;
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

/** The Flows pane's height (FlowsPane.tsx): at least this, so its header and a few rows show. */
export const PANE_MIN = 160;
/** …and at most this share of the canvas column, so the canvas above it stays usable. */
export const PANE_MAX_SHARE = 0.7;

/** A pane height kept between PANE_MIN and PANE_MAX_SHARE of a column `column` pixels tall. */
export function clampPaneHeight(height: number, column: number): number {
  const max = Math.max(PANE_MIN, Math.floor(column * PANE_MAX_SHARE));
  return Math.round(Math.min(max, Math.max(PANE_MIN, height)));
}

/**
 * The connection a step travels on the canvas: the one from its start to its
 * end, or, for an answer (or a call against the arrow), the one the other way.
 */
export function stepEdge(step: { from: string; to: string }, edges: readonly { id: string; source: string; target: string }[]): string | undefined {
  return (edges.find((e) => e.source === step.from && e.target === step.to) ?? edges.find((e) => e.source === step.to && e.target === step.from))?.id;
}

const withActive = (className: string | undefined) => (className ? `${className} pc-active` : 'pc-active');

/**
 * The canvas with the Flows pane's selected step lit up as playback lights its
 * current step (`pc-active`, Canvas/canvas.css): its two nodes and the
 * connection it travels. The same arrays when no step is selected.
 */
export function markStep<N extends { id: string; className?: string }, E extends { id: string; source: string; target: string; className?: string }>(
  nodes: N[],
  edges: E[],
  step: { from: string; to: string } | null,
): { nodes: N[]; edges: E[] } {
  if (!step) return { nodes, edges };
  const edge = stepEdge(step, edges);
  return {
    nodes: nodes.map((n) => (n.id === step.from || n.id === step.to ? { ...n, className: withActive(n.className) } : n)),
    edges: edge ? edges.map((e) => (e.id === edge ? { ...e, className: withActive(e.className) } : e)) : edges,
  };
}
