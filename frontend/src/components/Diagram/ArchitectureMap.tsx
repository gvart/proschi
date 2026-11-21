import { useMemo, type CSSProperties } from 'react';
import { ChevronUp, Map as MapIcon, Minus } from 'lucide-react';
import { useStore, type Edge, type ReactFlowState } from 'reactflow';
import { useEdgeGeometry } from '../Canvas/useEdgeGeometry';
import { stepEdge } from './flows';

/**
 * The architecture, small and read-only, floating in a corner of the Flows
 * view (FlowsPanel.tsx), so a step is never far from where it happens. It is
 * drawn from the canvas's own React Flow store (the canvas stays mounted,
 * hidden, under the view): the same nodes where the layout put them and the
 * same routed connections, fitted to the components the use case touches.
 * The selected steps' components and the connections they travel light up,
 * the rest fades. While a step's ends are picked, a click on a component
 * picks it. It collapses to a pill, and whether it is open is remembered
 * (useMapOpen, canvasEditState.ts).
 */

/** The drawing's size inside the card. */
const MAP_W = 300;
const MAP_H = 184;
/** Flow units around the fitted components. */
const MARGIN = 36;

interface ArchitectureMapProps {
  open: boolean;
  onOpen: (open: boolean) => void;
  /** The steps to light up (the selected ones): their two components and the connection each travels. */
  steps: { from: string; to: string }[];
  /** Components marked apart from the steps: a step's ends being picked. */
  marked: string[];
  /** The components the use case touches, which the drawing is fitted to; all of them when empty. */
  focus: string[];
  /** While a step's ends are picked: a click on a component picks it. */
  onPick?: (id: string) => void;
  /** The title bar's words while a click picks: what to click. */
  hint?: string;
  className?: string;
  style?: CSSProperties;
}

type Box = { id: string; name: string; x: number; y: number; width: number; height: number };

const boxesOf = (state: ReactFlowState): string =>
  JSON.stringify(
    [...state.nodeInternals.values()]
      .filter((n) => (n.type === 'componentNode' || n.type === 'systemNode') && !n.hidden && n.width && n.height && n.positionAbsolute)
      .map((n) => ({ id: n.id, name: String((n.data as { name?: string } | undefined)?.name ?? n.id), x: n.positionAbsolute!.x, y: n.positionAbsolute!.y, width: n.width!, height: n.height! })),
  );
const edgesOf = (state: ReactFlowState) => state.edges;

export default function ArchitectureMap({ open, onOpen, steps, marked, focus, onPick, hint, className = '', style }: ArchitectureMapProps) {
  const boxesKey = useStore(boxesOf);
  const boxes = useMemo(() => JSON.parse(boxesKey) as Box[], [boxesKey]);
  const edges = useStore(edgesOf);

  // The fitted view: the use case's components (all of them when it has none yet), with a margin, centred in the card.
  const view = useMemo(() => {
    const fitted = boxes.filter((b) => focus.includes(b.id));
    const shown = fitted.length ? fitted : boxes;
    if (!shown.length) return undefined;
    const x0 = Math.min(...shown.map((b) => b.x)) - MARGIN;
    const y0 = Math.min(...shown.map((b) => b.y)) - MARGIN;
    const x1 = Math.max(...shown.map((b) => b.x + b.width)) + MARGIN;
    const y1 = Math.max(...shown.map((b) => b.y + b.height)) + MARGIN;
    const scale = Math.min(MAP_W / (x1 - x0), MAP_H / (y1 - y0), 0.9);
    return { scale, dx: (MAP_W - (x1 - x0) * scale) / 2 - x0 * scale, dy: (MAP_H - (y1 - y0) * scale) / 2 - y0 * scale };
  }, [boxes, focus]);

  // What lights up: each step's two components, and the connection it travels (or a dashed line where there is none).
  const lit = useMemo(() => {
    const nodes = new Set<string>(marked);
    const ways = new Map<string, 'forward' | 'back'>();
    const unconnected: { from: string; to: string }[] = [];
    for (const s of steps) {
      nodes.add(s.from);
      nodes.add(s.to);
      if (s.from === s.to) continue;
      const id = stepEdge(s, edges);
      const edge = id ? edges.find((e) => e.id === id) : undefined;
      if (edge) ways.set(edge.id, edge.source === s.from ? 'forward' : 'back');
      else unconnected.push(s);
    }
    return { nodes, ways, unconnected, any: nodes.size > 0 };
  }, [steps, marked, edges]);

  if (!open) {
    return (
      <button
        type="button"
        data-testid="flows-map"
        aria-expanded={false}
        aria-label="Show the architecture map"
        title="Show the architecture (M)"
        onClick={() => onOpen(true)}
        className={`inline-flex h-9 items-center gap-1.5 rounded-full border-bw-1 border-ink bg-surface pl-3 pr-2.5 text-xs font-bold text-ink shadow-brutal-sm hover:bg-pop-yellow/40 ${className}`}
        style={style}
      >
        <MapIcon size={14} aria-hidden="true" />
        Architecture
        <ChevronUp size={14} aria-hidden="true" />
      </button>
    );
  }

  const at = (b: Box) =>
    view && {
      left: b.x * view.scale + view.dx,
      top: b.y * view.scale + view.dy,
      width: b.width * view.scale,
      height: b.height * view.scale,
    };
  const centre = (id: string) => {
    const b = boxes.find((n) => n.id === id);
    return b && view && { x: (b.x + b.width / 2) * view.scale + view.dx, y: (b.y + b.height / 2) * view.scale + view.dy };
  };

  return (
    <section
      data-testid="flows-map"
      aria-label="Architecture map"
      className={`w-[302px] overflow-hidden rounded-sm border-bw-1 border-ink bg-surface text-ink shadow-brutal-md ${className}`}
      style={style}
    >
      <div className="flex h-8 items-center gap-1.5 border-b border-ink/15 pl-2.5 pr-1">
        <MapIcon size={13} aria-hidden="true" className="shrink-0 text-ink/70" />
        <h3 className="min-w-0 flex-1 truncate text-[11px] font-bold uppercase tracking-[0.08em] text-ink/75">Architecture</h3>
        <button
          type="button"
          aria-label="Collapse the architecture map"
          aria-expanded={true}
          title="Collapse (M)"
          onClick={() => onOpen(false)}
          className="grid h-6 w-6 place-items-center rounded-sm text-ink/70 hover:bg-ink/10 hover:text-ink"
        >
          <Minus size={14} />
        </button>
      </div>
      {/* While a step's ends are picked: what to click, small, over the map. */}
      {hint && (
        <p data-map-hint className="flex items-center gap-1.5 border-b border-pop-pink/40 bg-pop-pink/[0.07] px-2.5 py-1 text-xs font-semibold text-ink/85">
          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-pop-pink" />
          {hint}
        </p>
      )}
      <div className="relative bg-paper" style={{ width: MAP_W, height: MAP_H }}>
        {!view ? (
          <p className="grid h-full place-items-center px-6 text-center text-xs text-muted">No components yet.</p>
        ) : (
          <>
            <svg className="pointer-events-none absolute inset-0" width={MAP_W} height={MAP_H} aria-hidden="true">
              <g transform={`translate(${view.dx} ${view.dy}) scale(${view.scale})`}>
                {edges.map((e) => (
                  <MapEdge key={e.id} edge={e} way={lit.ways.get(e.id)} faded={lit.any && !lit.ways.has(e.id)} scale={view.scale} />
                ))}
              </g>
              {lit.unconnected.map((s) => {
                const [a, b] = [centre(s.from), centre(s.to)];
                return a && b ? <line key={`${s.from}>${s.to}`} data-map-missing="" x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="stroke-pop-pink" strokeWidth={2} strokeDasharray="4 3" /> : null;
              })}
            </svg>
            {boxes.map((b) => {
              const box = at(b)!;
              const active = lit.nodes.has(b.id);
              const faded = lit.any && !active;
              const Tag = onPick ? 'button' : 'div';
              return (
                <Tag
                  key={b.id}
                  data-map-node={b.id}
                  data-active={active || undefined}
                  title={b.name}
                  {...(onPick ? { type: 'button' as const, 'aria-label': b.name, onClick: () => onPick(b.id) } : { 'aria-hidden': true })}
                  className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[3px] border-bw-1 px-1.5 text-[10.5px] font-bold leading-none transition-opacity ${
                    active ? 'z-10 border-pop-pink bg-surface text-ink ring-2 ring-pop-pink' : 'border-ink bg-surface text-ink'
                  } ${faded ? 'opacity-40' : ''} ${onPick ? 'cursor-pointer hover:bg-pop-yellow focus-visible:bg-pop-yellow focus-visible:outline-2 focus-visible:outline-ink' : ''}`}
                  style={{ left: box.left + box.width / 2, top: box.top + box.height / 2, minWidth: Math.min(box.width, 96), maxWidth: Math.max(box.width, 104), height: Math.max(20, Math.min(box.height, 26)) }}
                >
                  <span className="truncate">{b.name}</span>
                </Tag>
              );
            })}
          </>
        )}
      </div>
    </section>
  );
}

/** A connection along its routed path, thick and pink with its head the step's way when a selected step travels it. */
function MapEdge({ edge, way, faded, scale }: { edge: Edge; way?: 'forward' | 'back'; faded: boolean; scale: number }) {
  const geometry = useEdgeGeometry(edge.id, edge.source, edge.target);
  if (!geometry) return null;
  const tone = way ? 'stroke-pop-pink' : 'stroke-ink/55';
  const fill = way ? 'fill-pop-pink' : 'fill-ink/55';
  const back = way === 'back' && `back-${edge.id.replace(/[^\w-]/g, '_')}`;
  return (
    <g data-map-edge={edge.id} data-active={way ? '' : undefined} opacity={faded ? 0.35 : 1}>
      {back && (
        <defs>
          <marker id={back} viewBox="0 0 10 10" refX="10" refY="5" markerWidth={10 / scale} markerHeight={10 / scale} markerUnits="userSpaceOnUse" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="fill-pop-pink" />
          </marker>
        </defs>
      )}
      <path d={geometry.path} fill="none" className={tone} strokeWidth={way ? 3 : 1.25} vectorEffect="non-scaling-stroke" markerStart={back ? `url(#${back})` : undefined} />
      {way !== 'back' && <path d={geometry.head} className={fill} stroke="none" />}
    </g>
  );
}
