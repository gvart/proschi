import { useEffect, useMemo, useRef, useState } from 'react';
import { roleOf } from '../engine/board';
import { heat, ICON } from './visual';
import { USERS } from '../engine/compile';
import { TIERS } from '../engine/rules';
import type { FlowTick, NodeTick } from '../engine/run';
import type { Board, ComponentDef, ScenarioDef } from '../engine/types';
import { edgePath, layoutBoard, pointOn, ROW_LABEL, type Layout, type Row } from './layout';

/**
 * The board: rows of components (Users at the top, external systems at the
 * bottom) and their wires as SVG, with requests drawn as particles on a
 * canvas on top while a wave runs. Nodes heat up from paper to yellow to pink
 * to red with their utilisation, shake past 100%, and grey out when down;
 * replicas stack like cards. Every node is a button, so the board works with
 * a keyboard and a screen reader too.
 */

/** `text` cut to `chars`, with an ellipsis. */
const fit = (text: string, chars: number) => (text.length > chars ? `${text.slice(0, Math.max(1, chars - 1))}…` : text);

export interface BoardViewProps {
  board: Board;
  components: ReadonlyMap<string, ComponentDef>;
  scenario: ScenarioDef;
  wide: boolean;
  /** The last tick (or load test): heat, flows, who is down. */
  tick?: { nodes: NodeTick[]; flows: FlowTick[] };
  /** Draw particles (a wave is running and motion is allowed). */
  animate: boolean;
  /** Speed of the particles, with the run's speed. */
  speed: number;
  selected?: string;
  /** Wiring from this node: valid targets are marked. */
  wiringFrom?: string;
  validTargets?: ReadonlySet<string>;
  /** Placing a component: its row shows a ghost slot. */
  placingRow?: Row;
  /** Nodes placed this plan, which drop in. */
  fresh?: ReadonlySet<string>;
  /** Ids to shake once (an invalid wire). */
  shake?: string;
  onNode: (id: string) => void;
  onGhost: () => void;
  onBackground: () => void;
  /** For dropping a dragged chip: the row under a point (client coordinates). */
  rowAt?: (fn: (clientX: number, clientY: number) => Row | undefined) => void;
  /** Floating text over a node this tick, e.g. "+$120". */
  pops?: { id: string; text: string; tone: 'good' | 'bad' }[];
  popKey?: string | number;
}

export default function BoardView(props: BoardViewProps) {
  const { board, components, scenario, wide, tick, animate, speed, selected, wiringFrom, validTargets, placingRow, fresh, shake } = props;
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, Math.min(900, e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => layoutBoard(board, components, scenario, width, wide), [board, components, scenario, width, wide]);
  const nodeTicks = useMemo(() => new Map((tick?.nodes ?? []).map((n) => [n.id, n])), [tick]);
  const flowOf = useMemo(() => new Map((tick?.flows ?? []).map((f) => [`${f.from}>${f.to}`, f])), [tick]);

  const { rowAt } = props;
  useEffect(() => {
    rowAt?.((cx, cy) => {
      const svg = box.current?.querySelector('svg');
      if (!svg) return undefined;
      const r = svg.getBoundingClientRect();
      if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return undefined;
      const y = ((cy - r.top) / r.height) * layout.height;
      return layout.rows.reduce((best, row) => (Math.abs(row.y - y) < Math.abs(best.y - y) ? row : best), layout.rows[0]).row;
    });
  }, [rowAt, layout]);

  const ghost = placingRow ? layout.ghost(placingRow) : undefined;

  return (
    <div ref={box} className="sf-board relative w-full">
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="block w-full h-auto"
        role="group"
        aria-label="Your architecture"
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onBackground();
        }}
      >
        {layout.rows.map(({ row, y }) => (
          <g key={row} aria-hidden="true">
            <line x1={0} x2={layout.width} y1={y + layout.rowHeight / 2} y2={y + layout.rowHeight / 2} stroke="rgb(var(--c-ink) / 0.08)" strokeDasharray="4 6" />
            <text x={6} y={y - layout.rowHeight / 2 + 14} fontSize={10} fontWeight={700} letterSpacing="0.08em" fill="rgb(var(--c-muted))">
              {ROW_LABEL[row].toUpperCase()}
            </text>
          </g>
        ))}

        {board.edges.map(([from, to]) => {
          const a = layout.nodes.get(from);
          const b = layout.nodes.get(to);
          if (!a || !b) return null;
          const flow = flowOf.get(`${from}>${to}`);
          const width = flow ? 1.5 + Math.min(5, Math.log10(flow.rps + 1)) : 2;
          const dead = nodeTicks.get(to)?.down || nodeTicks.get(from)?.down;
          return (
            <path
              key={`${from}>${to}`}
              d={edgePath(a, b)}
              fill="none"
              className={`sf-edge${flow?.async ? ' sf-edge--async' : ''}`}
              stroke={dead ? 'rgb(var(--c-fail) / 0.5)' : 'rgb(var(--c-ink) / 0.55)'}
              strokeWidth={width}
              strokeLinecap="round"
              markerEnd="url(#sf-arrow)"
            />
          );
        })}
        <defs>
          <marker id="sf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="rgb(var(--c-ink) / 0.7)" />
          </marker>
        </defs>

        {ghost && (
          <g
            className="sf-ghost"
            role="button"
            tabIndex={0}
            aria-label={`Place it in the ${ROW_LABEL[placingRow!].toLowerCase()} row`}
            onClick={props.onGhost}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                props.onGhost();
              }
            }}
          >
            <rect x={ghost.x - 52} y={ghost.y - 26} width={104} height={52} rx={8} fill="rgb(var(--c-yellow) / 0.25)" stroke="rgb(var(--c-ink))" strokeWidth={2} strokeDasharray="6 4" />
            <text x={ghost.x} y={ghost.y + 6} textAnchor="middle" fontSize={22} fontWeight={800} fill="rgb(var(--c-ink))">
              +
            </text>
          </g>
        )}

        {board.nodes.map((node) => {
          const p = layout.nodes.get(node.id);
          if (!p) return null;
          const role = roleOf(node, components, scenario) ?? 'app';
          const c = components.get(node.component);
          const external = scenario.externals.find((e) => e.id === node.component);
          const name = node.component === USERS ? 'Users' : external ? external.name : (c?.name ?? node.component);
          const t = nodeTicks.get(node.id);
          const u = t?.utilization;
          const Icon = ICON[role];
          const fixed = role === 'users' || role === 'external';
          const stack = fixed ? 0 : Math.min(2, Math.max(0, node.replicas - 1));
          const isTarget = validTargets?.has(node.id);
          const classes = [
            'sf-node',
            fresh?.has(node.id) ? 'sf-node--new' : '',
            u !== undefined && u >= 0.9 && u < 1 ? 'sf-node--hot' : '',
            t?.saturated && !t.down ? 'sf-node--over' : '',
            t?.down ? 'sf-node--down' : '',
            isTarget ? 'sf-target' : '',
            shake === node.id ? 'sf-shake' : '',
          ].join(' ');
          const label = `${name}${fixed ? '' : `, ${node.replicas} replica${node.replicas === 1 ? '' : 's'}`}${u !== undefined && !fixed ? `, ${Math.round(u * 100)}% busy` : ''}${t?.down ? ', down' : ''}`;
          return (
            <g
              key={node.id}
              className={classes}
              style={{ transformOrigin: `${p.x}px ${p.y}px`, transformBox: 'view-box' }}
              role="button"
              tabIndex={0}
              aria-label={label}
              aria-pressed={selected === node.id}
              data-node={node.id}
              onClick={(e) => {
                e.stopPropagation();
                props.onNode(node.id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  props.onNode(node.id);
                }
              }}
            >
              {Array.from({ length: stack }, (_, i) => (
                <rect
                  key={i}
                  x={p.x - p.w / 2 + (stack - i) * 4}
                  y={p.y - p.h / 2 + (stack - i) * 4}
                  width={p.w}
                  height={p.h}
                  rx={8}
                  fill="rgb(var(--c-surface))"
                  stroke="rgb(var(--c-ink))"
                  strokeWidth={2}
                />
              ))}
              <rect
                className="sf-body"
                x={p.x - p.w / 2}
                y={p.y - p.h / 2}
                width={p.w}
                height={p.h}
                rx={8}
                style={{ fill: heat(fixed ? undefined : u, t?.down) }}
                stroke={selected === node.id || wiringFrom === node.id ? 'rgb(var(--c-blue))' : 'rgb(var(--c-ink))'}
                strokeWidth={selected === node.id || wiringFrom === node.id ? 4 : 2}
              />
              <Icon x={p.x - p.w / 2 + 7} y={p.y - 17} width={16} height={16} color="rgb(var(--c-ink))" aria-hidden="true" />
              <text x={p.x - p.w / 2 + 28} y={p.y - 4} fontSize={11.5} fontWeight={700} fill="rgb(var(--c-ink))">
                {fit(name, Math.floor((p.w - 32) / 6.6))}
              </text>
              {!fixed && (
                <text x={p.x - p.w / 2 + 28} y={p.y + 11} fontSize={10.5} fontFamily="var(--font-mono)" fill="rgb(var(--c-ink) / 0.75)">
                  {`×${node.replicas}`}
                  {(node.tier ?? 0) > 0 ? ` ${TIERS[node.tier!].name}` : ''}
                  {(node.shards ?? 1) > 1 ? ` ⧉${node.shards}` : ''}
                  {u !== undefined ? ` · ${Math.round(u * 100)}%` : ''}
                </text>
              )}
              {!fixed && u !== undefined && (
                <rect x={p.x - p.w / 2 + 6} y={p.y + p.h / 2 - 8} width={Math.max(0, (p.w - 12) * Math.min(1, u))} height={3} rx={1.5} fill={u >= 1 ? 'rgb(var(--c-fail))' : 'rgb(var(--c-ink) / 0.7)'} />
              )}
              {t?.down && (
                <path d={`M${p.x - 12},${p.y - 12} L${p.x + 12},${p.y + 12} M${p.x + 12},${p.y - 12} L${p.x - 12},${p.y + 12}`} stroke="rgb(var(--c-fail))" strokeWidth={4} strokeLinecap="round" />
              )}
            </g>
          );
        })}

        {props.pops?.map((pop) => {
          const p = layout.nodes.get(pop.id);
          if (!p) return null;
          return (
            <text
              key={`${props.popKey}-${pop.id}-${pop.text}`}
              className="sf-pop sf-count"
              x={p.x + p.w / 2 - 4}
              y={p.y - p.h / 2 - 4}
              textAnchor="end"
              fontSize={13}
              fontWeight={800}
              fill={pop.tone === 'good' ? 'rgb(var(--c-pass))' : 'rgb(var(--c-fail))'}
              stroke="rgb(var(--c-paper))"
              strokeWidth={3}
              paintOrder="stroke"
            >
              {pop.text}
            </text>
          );
        })}
      </svg>
      {animate && tick && <Particles layout={layout} flows={tick.flows} nodes={tick.nodes} speed={speed} />}
    </div>
  );
}

interface Particle {
  from: string;
  to: string;
  t: number;
  async: boolean;
  /** Dropped requests fall instead. */
  fall?: { x: number; y: number; vy: number; vx: number };
}

/** Requests as dots flowing along the wires: more dots for more traffic, hollow for async; dropped ones fall off overloaded nodes. */
function Particles({ layout, flows, nodes, speed }: { layout: Layout; flows: FlowTick[]; nodes: NodeTick[]; speed: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef({ layout, flows, nodes, speed });
  live.current = { layout, flows, nodes, speed };

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const g = el.getContext('2d');
    if (!g) return;
    const particles: Particle[] = [];
    const spawnDebt = new Map<string, number>();
    let frame = 0;
    let last = performance.now();
    const css = getComputedStyle(document.documentElement);
    const rgb = (name: string) => `rgb(${css.getPropertyValue(name).trim().split(/\s+/).join(',')})`;
    const colors = { sync: rgb('--c-blue'), async: rgb('--c-lilac'), drop: rgb('--c-fail') };

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { layout: L, flows: F, nodes: N, speed: S } = live.current;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
      }
      const k = (w / L.width) * dpr;
      g.setTransform(k, 0, 0, k, 0, 0);
      g.clearRect(0, 0, L.width, L.height);

      if (!document.hidden) {
        for (const f of F) {
          if (!L.nodes.has(f.from) || !L.nodes.has(f.to) || f.rps <= 0) continue;
          const key = `${f.from}>${f.to}`;
          const rate = (1.5 + Math.log10(f.rps + 1) * 1.6) * S;
          const debt = (spawnDebt.get(key) ?? Math.random()) + rate * dt;
          const n = Math.floor(debt);
          spawnDebt.set(key, debt - n);
          for (let i = 0; i < n && particles.length < 220; i++) particles.push({ from: f.from, to: f.to, t: 0, async: f.async });
        }
        for (const n of N) {
          if (!n.saturated || n.down) continue;
          const p = L.nodes.get(n.id);
          if (!p || Math.random() > Math.min(0.9, (n.utilization - 1) * 2 + 0.15) * S * dt * 8) continue;
          if (particles.length < 240) particles.push({ from: n.id, to: n.id, t: 0, async: false, fall: { x: p.x + (Math.random() - 0.5) * p.w, y: p.y + p.h / 2, vx: (Math.random() - 0.5) * 40, vy: -40 } });
        }
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const q = particles[i];
        if (q.fall) {
          q.fall.vy += 420 * dt;
          q.fall.x += q.fall.vx * dt;
          q.fall.y += q.fall.vy * dt;
          q.t += dt;
          if (q.t > 1.2) {
            particles.splice(i, 1);
            continue;
          }
          g.globalAlpha = Math.max(0, 1 - q.t / 1.2);
          g.fillStyle = colors.drop;
          g.fillRect(q.fall.x - 2.5, q.fall.y - 2.5, 5, 5);
          g.globalAlpha = 1;
          continue;
        }
        const a = L.nodes.get(q.from);
        const b = L.nodes.get(q.to);
        if (!a || !b) {
          particles.splice(i, 1);
          continue;
        }
        q.t += dt * 1.25 * S;
        if (q.t >= 1) {
          particles.splice(i, 1);
          continue;
        }
        const { x, y } = pointOn(a, b, q.t);
        g.beginPath();
        g.arc(x, y, 3, 0, Math.PI * 2);
        if (q.async) {
          g.strokeStyle = colors.async;
          g.lineWidth = 1.6;
          g.stroke();
        } else {
          g.fillStyle = colors.sync;
          g.fill();
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return <canvas ref={canvas} aria-hidden="true" className="pointer-events-none absolute inset-0 w-full h-full" />;
}
