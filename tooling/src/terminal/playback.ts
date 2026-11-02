import type { FlowStep } from '../../../frontend/src/dsl/types';
import { E, N, S, W } from './grid';
import { fallbackPath, type Cell, type Path, type Scene } from './scene';

/**
 * A scenario played over the diagram the way the editor's player does it
 * (components/UseCases): one step per call, the packet going out and, for a
 * request-response call, coming back; the step's two nodes lit, the rest of
 * the scenario's path faded, everything else faded further; a failed call
 * cut off part way with a cross.
 */

/** How long the packet takes to travel one step's edge, and how long each step shows while playing (playbackClock.ts, UseCasePlayback.tsx). */
export const TRAVEL_MS = 1500;
export const STEP_MS = 2000;
/** How far along the edge (in %) a failed call gets before it is cut off (AnimatedPlaybackEdge.tsx). */
const FAIL_AT = 55;

/** A step that failed outright or was answered with a 4xx/5xx status. */
export function isErrorStep(step: FlowStep): boolean {
  return !!step.failed || (step.statusCode ?? 0) >= 400;
}

/** The current step, with the earlier steps of its parallel group (playbackView.ts). */
export function currentStepsOf<T extends FlowStep>(steps: T[], index: number): T[] {
  const group = steps[index]?.parallelGroup;
  return steps.filter((step, i) => i === index || (i < index && group !== undefined && step.parallelGroup === group));
}

export interface ActiveEdge {
  path: Path;
  error: boolean;
  failed: boolean;
  /** The packet has arrived: the line flows (React Flow's animated dashes). */
  flowing: boolean;
}

export interface Packet {
  at: Cell;
  /** 4xx/5xx on its way back, or a call that failed. */
  error: boolean;
  /** Cut off: drawn as a cross. */
  cut: boolean;
}

/** What one moment of playback draws over the diagram. */
export interface Play {
  /** The current steps' nodes, and those whose call failed or was answered with an error. */
  active: Set<string>;
  failing: Set<string>;
  /** Every node and edge the scenario passes through, faded less than the rest. */
  pathNodes: Set<string>;
  pathEdges: Set<string>;
  edges: ActiveEdge[];
  packets: Packet[];
  /** Frame counter, for the flowing dashes. */
  tick: number;
}

/** The cells a call travels, from caller to callee: its edge either way round, or a route of its own. */
export function stepPath(scene: Scene, from: string, to: string): Path | undefined {
  const forward = scene.edges.find((e) => e.edge.source === from && e.edge.target === to);
  if (forward) return forward.path;
  const back = scene.edges.find((e) => e.edge.source === to && e.edge.target === from);
  if (back) return reverse(back.path);
  const a = scene.nodes.get(from);
  const b = scene.nodes.get(to);
  return a && b && a !== b ? fallbackPath(a.rect, b.rect) : undefined;
}

function reverse(path: Path): Path {
  const cells = path.cells.slice().reverse();
  // The first cell's directions lead into its box and on to the second cell; the new head points into that box.
  const first = path.cells[0];
  const intoBox = path.dirs[0] & ~(path.cells.length > 1 ? stepDir(first, path.cells[1]) : 0);
  const head = intoBox || (cells.length > 1 ? stepDir(cells[cells.length - 2], cells[cells.length - 1]) : path.head);
  // The old last cell held the arrowhead; as a line it points to its neighbour and into its box.
  const dirs = path.dirs.slice();
  if (path.cells.length > 1) dirs[dirs.length - 1] = stepDir(path.cells[path.cells.length - 1], path.cells[path.cells.length - 2]) | path.head;
  return { cells, dirs: dirs.reverse(), head };
}

function stepDir(a: Cell, b: Cell): number {
  return b.x > a.x ? E : b.x < a.x ? W : b.y > a.y ? S : N;
}

const connects = (edge: { source: string; target: string }, step: FlowStep) =>
  (edge.source === step.fromServiceId && edge.target === step.toServiceId) || (edge.target === step.fromServiceId && edge.source === step.toServiceId);

/** Playback at step `index`, `progress` (0..100) of the way through the packet's travel. */
export function playAt(scene: Scene, steps: FlowStep[], index: number, progress: number, tick = 0): Play {
  const current = currentStepsOf(steps, index);
  const active = new Set<string>();
  const failing = new Set<string>();
  for (const step of current) {
    active.add(step.fromServiceId);
    active.add(step.toServiceId);
    if (isErrorStep(step)) failing.add(step.toServiceId);
  }
  const pathNodes = new Set(steps.flatMap((s) => [s.fromServiceId, s.toServiceId]));
  const pathEdges = new Set(scene.edges.filter((e) => steps.some((s) => connects(e.edge, s))).map((e) => e.edge.id));

  const edges: ActiveEdge[] = [];
  const packets: Packet[] = [];
  for (const step of current) {
    const path = stepPath(scene, step.fromServiceId, step.toServiceId);
    if (!path) continue;
    const failed = !!step.failed;
    const error = isErrorStep(step);
    const roundTrip = step.executionType === 'SYNC_REQUEST_RESPONSE' && !failed;
    edges.push({ path, error, failed, flowing: progress >= 100 && !failed });
    // Request-response: 0–50% goes out, 50–100% comes back.
    const share = failed ? Math.min(progress, FAIL_AT) / 100 : roundTrip ? (progress <= 50 ? progress / 50 : 1 - (progress - 50) / 50) : progress / 100;
    const last = path.cells.length - 1;
    const at = path.cells[Math.max(0, Math.min(last, Math.round(share * last)))];
    if (failed && progress >= FAIL_AT) packets.push({ at, error: true, cut: true });
    else if (progress < 100) packets.push({ at, error: error && (!roundTrip || progress > 50), cut: false });
  }
  return { active, failing, pathNodes, pathEdges, edges, packets, tick };
}
