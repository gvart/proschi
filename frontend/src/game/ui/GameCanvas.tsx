import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import ReactFlow, { Background, BackgroundVariant, MarkerType, ReactFlowProvider, useReactFlow, type Edge, type Node, type NodeProps } from 'reactflow';
import 'reactflow/dist/style.css';
import ComponentNode from '../../components/Canvas/ComponentNode';
import FlowParticles from '../../components/Overlay/FlowParticles';
import { useFitOnChange } from '../../components/Diagram/useFitOnChange';
import type { NodeOverlay } from '../../sim/overlay';
import type { ComponentMetadata } from '../../types/canvas';
import { USERS } from '../engine/compile';
import { TIERS } from '../engine/rules';
import type { FlowTick, NodeTick } from '../engine/run';
import type { Board, ComponentDef, ScenarioDef } from '../engine/types';
import { layoutBoard, ROW_LABEL, type Row } from './layout';
import { shortName } from './visual';

/**
 * The board on the editor's canvas: the same nodes, icons and connections as
 * a diagram in the editor, laid out in rows (Users at the top, external
 * systems at the bottom, so requests fall down the screen), with the
 * simulation drawn over it: nodes heat up from paper to yellow, pink and red,
 * stack their replicas, shake past 100% and grey out when down, and requests
 * flow along the wires. Every node is a button, so the board works with a
 * keyboard and a screen reader too; dragging from a node's bottom dot to
 * another node wires them.
 */

export interface GameCanvasProps {
  board: Board;
  components: ReadonlyMap<string, ComponentDef>;
  scenario: ScenarioDef;
  wide: boolean;
  /** A phone: narrower columns and smaller nodes. */
  compact?: boolean;
  /** The last tick (or load test): heat, flows, who is down. */
  tick?: { nodes: NodeTick[]; flows: FlowTick[] };
  /** Draw particles (a wave is running and motion is allowed). */
  animate: boolean;
  speed: number;
  selected?: string;
  /** Wiring from this node: valid targets are marked. */
  wiringFrom?: string;
  validTargets?: ReadonlySet<string>;
  /** Placing a component: its row shows a ghost slot. */
  placingRow?: Row;
  /** Nodes placed this plan, which drop in. */
  fresh?: ReadonlySet<string>;
  /** A node to shake once (an invalid wire). */
  shake?: string;
  /** Drawing wires by dragging between nodes is allowed (planning). */
  editable?: boolean;
  onNode: (id: string) => void;
  onGhost: () => void;
  onBackground: () => void;
  onWire?: (from: string, to: string) => void;
  /** For dropping a dragged chip: the row under a point (client coordinates). */
  rowAt?: (fn: (clientX: number, clientY: number) => Row | undefined) => void;
}

const COL = { wide: 210, compact: 150 };
const ROW = { wide: 130, compact: 110 };
const NODE_W = { wide: 186, compact: 132 };

interface LaneData {
  label: string;
  width: number;
}

interface GhostData {
  label: string;
  onPlace: () => void;
}

const Lane = memo(({ data }: NodeProps<LaneData>) => (
  <div className="sf-lane" style={{ width: data.width }} aria-hidden="true">
    <span>{data.label}</span>
  </div>
));
Lane.displayName = 'Lane';

const Ghost = memo(({ data }: NodeProps<GhostData>) => (
  <button
    type="button"
    className="sf-ghost-slot nodrag"
    aria-label={data.label}
    onClick={(e) => {
      e.stopPropagation();
      data.onPlace();
    }}
  >
    +
  </button>
));
Ghost.displayName = 'Ghost';

const nodeTypes = { component: ComponentNode, lane: Lane, ghost: Ghost };

export default function GameCanvas(props: GameCanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

function Canvas(props: GameCanvasProps) {
  const { board, components, scenario, wide, compact, tick, animate, speed, selected, wiringFrom, validTargets, placingRow, fresh, shake, editable } = props;
  const size = compact ? 'compact' : 'wide';
  const wrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = wrapper.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // As wide as the fullest row and a free slot (at least three), so the nodes stay readable.
  const slots = Math.max(3, Math.min(wide ? 6 : 4, 1 + Math.max(...['edge', 'compute', 'cache', 'data', 'async', 'external'].map((r) => board.nodes.filter((n) => rowKey(n.component) === r).length))));
  // Lanes from the game's layout; the columns and rows are the canvas's own, sized for its nodes.
  const flowWidth = slots * COL[size];
  const layout = useMemo(() => layoutBoard(board, components, scenario, flowWidth, wide, compact), [board, components, scenario, flowWidth, wide, compact]);
  const rowY = useMemo(() => new Map(layout.rows.map((r, i) => [r.row, 24 + i * ROW[size]])), [layout, size]);
  const flowHeight = 24 + layout.rows.length * ROW[size];
  const nodeTicks = useMemo(() => new Map((tick?.nodes ?? []).map((n) => [n.id, n])), [tick]);

  function rowKey(component: string): string {
    if (component === USERS) return 'users';
    if (scenario.externals.some((e) => e.id === component)) return 'external';
    return components.get(component)?.lane ?? 'compute';
  }

  const nodes = useMemo<Node[]>(() => {
    const out: Node[] = layout.rows.map(({ row }) => ({
      id: `lane:${row}`,
      type: 'lane',
      position: { x: 0, y: rowY.get(row)! - 18 },
      data: { label: ROW_LABEL[row], width: flowWidth },
      draggable: false,
      selectable: false,
      focusable: false,
      connectable: false,
      zIndex: -1,
    }));
    for (const node of board.nodes) {
      const p = layout.nodes.get(node.id);
      if (!p) continue;
      const external = scenario.externals.find((e) => e.id === node.component);
      const c = components.get(node.component);
      const fixed = node.component === USERS || !!external;
      const name = node.component === USERS ? 'Users' : external ? external.name : (c?.name ?? node.component);
      const t = nodeTicks.get(node.id);
      const u = fixed ? undefined : t?.utilization;
      const overlay: NodeOverlay = {
        ...(u !== undefined ? { utilization: u, saturated: t!.saturated } : {}),
        ...(t?.down ? { down: true } : {}),
        ...(fixed ? {} : { replicas: node.replicas }),
        ...((node.tier ?? 0) > 0 ? { size: TIERS[node.tier!].name } : {}),
        ...((node.shards ?? 1) > 1 ? { shards: node.shards } : {}),
      };
      const data: ComponentMetadata = {
        id: node.id,
        name: compact ? shortName(name) : name,
        type: node.component === USERS ? 'shape' : external ? 'external' : 'service',
        techStack: node.component === USERS ? 'Actor' : external ? external.tech : (c?.tech ?? 'Service'),
        overlay,
        fixedSize: true,
      };
      const label = `${name}${fixed ? '' : `, ${node.replicas} replica${node.replicas === 1 ? '' : 's'}`}${u !== undefined ? `, ${Math.round(u * 100)}% busy` : ''}${t?.down ? ', down' : ''}`;
      out.push({
        id: node.id,
        type: 'component',
        position: { x: p.x - NODE_W[size] / 2, y: rowY.get(p.row)! },
        data,
        ariaLabel: label,
        selected: selected === node.id || wiringFrom === node.id,
        draggable: false,
        selectable: false,
        connectable: !!editable,
        className: [
          'sf-canvas-node',
          fresh?.has(node.id) ? 'sf-node--new' : '',
          validTargets?.has(node.id) ? 'sf-target' : '',
          wiringFrom === node.id ? 'sf-wiring' : '',
          shake === node.id ? 'sf-shake' : '',
        ].join(' '),
        style: { width: NODE_W[size] },
      });
    }
    const ghost = placingRow ? layout.ghost(placingRow) : undefined;
    if (ghost && placingRow) {
      out.push({
        id: 'ghost',
        type: 'ghost',
        position: { x: ghost.x - NODE_W[size] / 2, y: rowY.get(placingRow)! },
        data: { label: `Place it in the ${ROW_LABEL[placingRow].toLowerCase()} row`, onPlace: props.onGhost },
        style: { width: NODE_W[size] },
        draggable: false,
        selectable: false,
        focusable: false,
        connectable: false,
      });
    }
    return out;
  }, [board, compact, layout, rowY, nodeTicks, selected, wiringFrom, validTargets, placingRow, fresh, shake, editable, size, flowWidth, components, scenario, props.onGhost]);

  const flowOf = useMemo(() => new Map((tick?.flows ?? []).map((f) => [`${f.from}>${f.to}`, f])), [tick]);
  const edges = useMemo<Edge[]>(
    () =>
      board.edges.map(([from, to]) => {
        const flow = flowOf.get(`${from}>${to}`);
        const dead = nodeTicks.get(from)?.down || nodeTicks.get(to)?.down;
        const color = dead ? 'rgb(var(--c-fail) / 0.6)' : 'rgb(var(--c-ink) / 0.6)';
        return {
          id: `${from}>${to}`,
          source: from,
          target: to,
          focusable: false,
          animated: !!flow?.async,
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
          style: { stroke: color, strokeWidth: flow ? 1.5 + Math.min(4, Math.log10(flow.rps + 1)) : 2 },
        };
      }),
    [board, flowOf, nodeTicks],
  );

  const overlayNodes = useMemo(() => {
    const out: Record<string, NodeOverlay> = {};
    for (const n of nodes) if (n.type === 'component') out[n.id] = (n.data as ComponentMetadata).overlay ?? {};
    return out;
  }, [nodes]);

  const { rowAt } = props;
  useEffect(() => {
    rowAt?.((cx, cy) => {
      const r = wrapper.current?.getBoundingClientRect();
      if (!r || cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return undefined;
      const { y } = screenToFlowPosition({ x: cx, y: cy });
      let best: Row | undefined;
      let distance = Infinity;
      for (const [row, top] of rowY) {
        const d = Math.abs(top + 40 - y);
        if (d < distance) [best, distance] = [row, d];
      }
      return best;
    });
  }, [rowAt, rowY, screenToFlowPosition]);

  // The board keeps the proportions of its rows, like a picture: no panning or zooming, so a phone scrolls the page.
  const height = Math.max(compact ? 260 : 320, Math.min(760, Math.round((width * flowHeight) / flowWidth)));
  useFitOnChange(`${nodes.map((n) => `${n.id}@${n.position.x},${n.position.y}`).join('|')}#${width}x${height}`, { wrapper });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('.react-flow__node-component');
    const id = el?.dataset.id;
    if (!id) return;
    e.preventDefault();
    props.onNode(id);
  };

  return (
    <div
      ref={wrapper}
      role="group"
      aria-label="Your architecture"
      className={`sf-board sf-canvas relative w-full ${compact ? 'sf-canvas--compact' : ''}`}
      style={{ height }}
      onKeyDown={onKeyDown}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_e, node) => node.type === 'component' && props.onNode(node.id)}
        onPaneClick={props.onBackground}
        onConnect={(c) => c.source && c.target && c.source !== c.target && props.onWire?.(c.source, c.target)}
        nodesDraggable={false}
        nodesConnectable={!!editable}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        panOnScroll={false}
        disableKeyboardA11y={false}
        fitView
        fitViewOptions={{ padding: 0.04 }}
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        {animate && tick && <FlowParticles flows={tick.flows} nodes={overlayNodes} speed={speed} />}
      </ReactFlow>
    </div>
  );
}
