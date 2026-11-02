import type { Edge, Node } from 'reactflow';
import type { FlowStep } from '../../dsl/types';
import { CANVAS_EDGE, CANVAS_FAIL, CANVAS_INK } from '../../utils/canvasColors';
import { AnimatedPlaybackEdge } from './AnimatedPlaybackEdge';
import RoutedEdge from '../Canvas/RoutedEdge';

/** The edge types of a canvas that can play a use case; pass to `<ReactFlow edgeTypes>`. */
export const PLAYBACK_EDGE_TYPES = { default: RoutedEdge, playback: AnimatedPlaybackEdge };

/** A use case (or one scenario of it) being played. `condition` is the `when "…"` text of the scenario. */
export interface PlayedUseCase {
  id?: string;
  name: string;
  steps: FlowStep[];
  condition?: string;
}

/** What the canvas draws: the diagram with the current step picked out. */
export interface PlaybackView {
  nodes: Node[];
  edges: Edge[];
  /** Nodes of the current step(s). */
  highlighted: Set<string>;
  /** Nodes whose call failed or was answered with an error. */
  errorNodes: Set<string>;
  /** A use case is being played. */
  active: boolean;
}

// Only what changes between idle and playing fades; `all` would also animate the path as nodes move.
const EDGE_TRANSITION = 'opacity 0.3s ease, stroke 0.3s ease, stroke-width 0.3s ease';

/** A step that failed outright or was answered with a 4xx/5xx status. */
export function isErrorStep(step: FlowStep): boolean {
  return !!step.failed || (step.statusCode ?? 0) >= 400;
}

const connects = (edge: Edge, step: FlowStep) =>
  (edge.source === step.fromServiceId && edge.target === step.toServiceId) ||
  (edge.target === step.fromServiceId && edge.source === step.toServiceId);

/**
 * One moment of the playback: calls going out (`steps`) and answers coming back
 * (`responses`) at the same time. A `par` group is one frame, and a `-->` written
 * after other steps is a frame of its own (or part of its `par` group's frame).
 */
export interface Frame {
  steps: FlowStep[];
  responses: FlowStep[];
}

/** The frames of a scenario's steps, in the order they play. */
export function framesOf(steps: FlowStep[]): Frame[] {
  const withSteps = new Set(steps.map((step) => step.parallelGroup));
  const deferred = steps.filter((step) => step.deferredResponse);
  const groupOf = (step: FlowStep) => (withSteps.has(step.deferredResponse!.group) ? step.deferredResponse!.group : undefined);
  const frames: Frame[] = [];
  const groups = new Map<number, Frame>();
  steps.forEach((step, i) => {
    const group = step.parallelGroup;
    const open = group === undefined ? undefined : groups.get(group);
    if (open) open.steps.push(step);
    else {
      const frame: Frame = { steps: [step], responses: group === undefined ? [] : deferred.filter((d) => groupOf(d) === group) };
      frames.push(frame);
      if (group !== undefined) groups.set(group, frame);
    }
    for (const d of deferred) if (d.deferredResponse!.after === i + 1 && groupOf(d) === undefined) frames.push({ steps: [], responses: [d] });
  });
  return frames;
}

/** The step a frame is about, as an index into the scenario's steps. */
export function stepIndexOf(steps: FlowStep[], frame: Frame | undefined): number {
  const step = frame?.steps[0] ?? frame?.responses[0];
  return Math.max(step ? steps.indexOf(step) : 0, 0);
}

/** A request is answered on its way back, in one animation, unless the answer is written further down. */
const answeredLater = (step: FlowStep) => !!step.deferredResponse;

/** Steps between nodes with no architecture edge get a hidden edge so they can still animate. */
function withStepEdges(edges: Edge[], steps: FlowStep[]): Edge[] {
  const extra: Edge[] = [];
  for (const step of steps) {
    const connected = [...edges, ...extra].some((e) => connects(e, step));
    if (!connected && step.fromServiceId !== step.toServiceId) {
      extra.push({ id: `step:${step.fromServiceId}->${step.toServiceId}`, source: step.fromServiceId, target: step.toServiceId, data: { hiddenUntilActive: true } });
    }
  }
  return extra.length ? [...edges, ...extra] : edges;
}

/**
 * The diagram as drawn at a step of `useCase`, or as it is when nothing plays.
 * Every edge has the playback type either way, so starting playback restyles
 * the canvas instead of remounting its edges.
 */
export function playbackView(nodes: Node[], architectureEdges: Edge[], useCase: PlayedUseCase | undefined, frameIndex: number): PlaybackView {
  if (!useCase || useCase.steps.length === 0) {
    return {
      nodes,
      edges: architectureEdges.map((edge) => ({ ...edge, type: 'playback', style: { ...edge.style, transition: EDGE_TRANSITION } })),
      highlighted: new Set(),
      errorNodes: new Set(),
      active: false,
    };
  }

  const steps = useCase.steps;
  const frame = framesOf(steps)[frameIndex] ?? { steps: [], responses: [] };
  // A request whose answer comes later has no error yet; the answer carries it.
  const moving = [
    ...frame.steps.map((step) => ({ step, response: false, error: !answeredLater(step) && isErrorStep(step) })),
    ...frame.responses.map((step) => ({ step, response: true, error: isErrorStep(step) })),
  ];
  const highlighted = new Set<string>();
  const errorNodes = new Set<string>();
  for (const { step, error } of moving) {
    highlighted.add(step.fromServiceId);
    highlighted.add(step.toServiceId);
    if (error) errorNodes.add(step.toServiceId);
  }
  // Nodes this scenario never touches fade further than the ones it passes through later.
  const scenarioNodes = new Set(steps.flatMap((step) => [step.fromServiceId, step.toServiceId]));

  const shownNodes: Node[] = nodes.map((node) => ({
    ...node,
    style: {
      ...node.style,
      opacity: highlighted.has(node.id) ? 1 : scenarioNodes.has(node.id) || node.type === 'groupNode' ? 0.45 : 0.15,
      transition: 'opacity 0.3s ease',
    },
    // Styled in Canvas/canvas.css: one accent for the step's nodes, red for the one that failed.
    className: errorNodes.has(node.id) ? 'pc-failing' : highlighted.has(node.id) ? 'pc-active' : '',
  }));

  const edges = withStepEdges(architectureEdges, steps);
  const active = new Map<string, (typeof moving)[number]>();
  for (const item of moving) {
    const edge = edges.find((e) => connects(e, item.step));
    if (edge && !active.has(edge.id)) active.set(edge.id, item);
  }

  const shownEdges: Edge[] = edges.map((edge) => {
    const item = active.get(edge.id);
    const step = item?.step;
    const isActive = !!item;
    const isError = !!item?.error;
    const onPath = steps.some((s) => connects(edge, s));
    return {
      ...edge,
      type: 'playback',
      data: {
        ...(edge.data || {}),
        isActive,
        isRequestResponse: !item?.response && !!step && !answeredLater(step) && step.executionType === 'SYNC_REQUEST_RESPONSE' && !step.failed,
        // An answer rides the edge from the node that answers.
        reverse: !!item?.response && edge.source !== step?.toServiceId,
        isError,
        failed: !!step?.failed,
      },
      style: {
        ...edge.style,
        // The line is ink; the packet riding it (AnimatedPlaybackEdge) carries the accent.
        stroke: isActive ? (isError ? CANVAS_FAIL : CANVAS_INK) : (edge.style?.stroke ?? CANVAS_EDGE),
        strokeWidth: isActive ? 3 : 2,
        strokeDasharray: isActive && step?.failed ? '6 4' : edge.style?.strokeDasharray,
        opacity: isActive ? 1 : edge.data?.hiddenUntilActive ? 0 : onPath ? 0.45 : 0.12,
        transition: EDGE_TRANSITION,
      },
    };
  });

  return { nodes: shownNodes, edges: shownEdges, highlighted, errorNodes, active: true };
}
