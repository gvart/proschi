import type { Edge, Node } from 'reactflow';
import type { FlowStep } from '../../dsl/types';
import { CANVAS_EDGE, CANVAS_FAIL, CANVAS_INK } from '../../utils/canvasColors';
import { AnimatedPlaybackEdge } from './AnimatedPlaybackEdge';

/** The edge types of a canvas that can play a use case; pass to `<ReactFlow edgeTypes>`. */
export const PLAYBACK_EDGE_TYPES = { playback: AnimatedPlaybackEdge };

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

/** The current step, with the earlier steps of its parallel group. */
export function currentStepsOf(steps: FlowStep[], index: number): FlowStep[] {
  const group = steps[index]?.parallelGroup;
  return steps.filter((step, i) => i === index || (i < index && group !== undefined && step.parallelGroup === group));
}

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
export function playbackView(nodes: Node[], architectureEdges: Edge[], useCase: PlayedUseCase | undefined, stepIndex: number): PlaybackView {
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
  const currentSteps = currentStepsOf(steps, stepIndex);
  const highlighted = new Set<string>();
  const errorNodes = new Set<string>();
  for (const step of currentSteps) {
    highlighted.add(step.fromServiceId);
    highlighted.add(step.toServiceId);
    if (isErrorStep(step)) errorNodes.add(step.toServiceId);
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
  const active = new Map<string, FlowStep>();
  for (const step of currentSteps) {
    const edge = edges.find((e) => connects(e, step));
    if (edge && !active.has(edge.id)) active.set(edge.id, step);
  }

  const shownEdges: Edge[] = edges.map((edge) => {
    const step = active.get(edge.id);
    const isActive = !!step;
    const isError = !!step && isErrorStep(step);
    const onPath = steps.some((s) => connects(edge, s));
    return {
      ...edge,
      type: 'playback',
      data: {
        ...(edge.data || {}),
        isActive,
        isRequestResponse: step?.executionType === 'SYNC_REQUEST_RESPONSE' && !step.failed,
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
