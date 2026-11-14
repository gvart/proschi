import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { SequenceMessage } from '../../dsl/sequence';
import type { DiagramNode, DiagramScenario, DiagramUseCase } from '../../dsl/types';
import { getTechStackIcon } from '../../utils/iconMapping';
import { ZoomControls } from '../Diagram/ZoomControls';
import { CutOffMark, PacketMark } from './AnimatedPlaybackEdge';
import { FAIL_AT, usePlaybackProgress } from './playbackClock';
import {
  SEQ,
  ZOOM,
  arrowPoints,
  clampZoom,
  fitZoom,
  layoutSequence,
  litParticipants,
  lookAt,
  packetWindows,
  pointAlong,
  type SeqBox,
  type SeqLook,
  type SeqMessageRow,
} from './sequenceLayout';
import '../Canvas/canvas.css';
import './sequence.css';

export interface SequenceSource {
  useCase: DiagramUseCase;
  scenario: DiagramScenario;
  /** The diagram's nodes, for the participants' names, tech and icons. */
  nodes: DiagramNode[];
}

interface SequenceViewProps extends SequenceSource {
  /** The playback frame shown (UseCasePlayback's step): its messages lit, the ones to come faded. */
  frame: number;
  /** Clicking a message jumps playback to its frame. */
  onSelectFrame?: (frame: number) => void;
  className?: string;
}

/** How far (px) the mouse moves before a press becomes a pan rather than a click. */
const PAN_SLOP = 4;

/** How the zoom follows the pane: fitting its width, fitting the whole diagram, or as the reader set it. */
type FitMode = 'width' | 'all' | null;

/** Where to scroll once a new zoom is drawn: keep a point of the diagram under the same spot of the pane, or go to the top left. */
type Anchor = { x: number; y: number; cx: number; cy: number } | 'origin';

/**
 * The scenario being played as a sequence diagram, in the canvas's look:
 * participants as small cards on the dotted paper, dashed lifelines, numbered
 * calls in ink, answers dashed, failures in red, `par` regions and titled
 * `section` frames. The current step is drawn in the accent like the canvas's
 * active nodes, and its packets ride its arrows on the playback clock
 * (PlaybackClockContext) as the canvas's ride its edges; steps still to come are faded. The cards stay at the top while
 * the messages scroll, and the view follows playback.
 *
 * It opens fitted to the pane's width. The controls (bottom left, like the
 * canvas's) zoom in and out, fit the whole diagram and go back to 100%;
 * Ctrl/⌘ + wheel or a trackpad pinch zooms around the pointer, and dragging
 * the paper pans.
 */
function SequenceView({ useCase, scenario, nodes, frame, onSelectFrame, className = '' }: SequenceViewProps) {
  const layout = useMemo(() => layoutSequence(useCase, scenario, nodes), [useCase, scenario, nodes]);
  const ids = `seq${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const lit = useMemo(() => litParticipants(layout.rows, frame), [layout, frame]);
  const name = useMemo(() => {
    const names = new Map(layout.columns.map((c) => [c.id, c.name]));
    return (id: string) => names.get(id) ?? id;
  }, [layout]);

  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState<FitMode>('width');
  const zoomRef = useRef(zoom);
  const anchorRef = useRef<Anchor | null>(null);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  /** Where the diagram starts in the scrolled content, in screen pixels: it is centred while narrower than the pane. */
  const originX = () => {
    const box = scrollRef.current!;
    return innerRef.current!.getBoundingClientRect().left - box.getBoundingClientRect().left + box.scrollLeft;
  };

  // While fitted, the zoom follows the pane as it is resized.
  useEffect(() => {
    const box = scrollRef.current;
    if (!box || !fit) return;
    const apply = () => setZoom(fitZoom(layout, box.clientWidth, box.clientHeight, fit));
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(apply);
    observer.observe(box);
    return () => observer.disconnect();
  }, [layout, fit]);

  /** Zooms to `next`, keeping the diagram's point under (cx, cy) of the pane (its middle by default) where it is. */
  const zoomTo = useCallback((next: number, at?: { cx: number; cy: number }) => {
    const box = scrollRef.current;
    const z = clampZoom(next);
    if (!box || z === zoomRef.current) return;
    const cx = at?.cx ?? box.clientWidth / 2;
    const cy = at?.cy ?? box.clientHeight / 2;
    anchorRef.current = { x: (box.scrollLeft + cx - originX()) / zoomRef.current, y: (box.scrollTop + cy) / zoomRef.current, cx, cy };
    setFit(null);
    setZoom(z);
  }, []);

  const fitAll = () => {
    anchorRef.current = 'origin';
    setFit('all');
  };

  // Once the new zoom is drawn, scroll so the anchored point is back under the pointer.
  useLayoutEffect(() => {
    const box = scrollRef.current;
    const anchor = anchorRef.current;
    if (!box || !anchor) return;
    anchorRef.current = null;
    if (anchor === 'origin') {
      box.scrollLeft = 0;
      box.scrollTop = 0;
      return;
    }
    box.scrollLeft = originX() + anchor.x * zoom - anchor.cx;
    box.scrollTop = anchor.y * zoom - anchor.cy;
  }, [zoom, fit]);

  // Ctrl/⌘ + wheel, and a trackpad pinch (which the browser sends as one), zoom around the pointer
  // instead of the page. Plain wheel scrolls. Listened to directly: React's wheel listener is passive.
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = box.getBoundingClientRect();
      const delta = Math.max(-50, Math.min(50, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY));
      zoomTo(zoomRef.current * Math.exp(-delta * 0.005), { cx: e.clientX - rect.left, cy: e.clientY - rect.top });
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => box.removeEventListener('wheel', onWheel);
  }, [zoomTo]);

  // Dragging with the mouse pans, from anywhere on the diagram; touch pans natively. A press that
  // moves less than PAN_SLOP is still a click, so messages keep theirs; one that pans swallows its click.
  const panRef = useRef<{ x: number; y: number; left: number; top: number; id: number; moved: boolean } | null>(null);
  const pannedRef = useRef(false);
  const [panning, setPanning] = useState(false);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    pannedRef.current = false;
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const box = e.currentTarget;
    panRef.current = { x: e.clientX, y: e.clientY, left: box.scrollLeft, top: box.scrollTop, id: e.pointerId, moved: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (!pan || pan.id !== e.pointerId) return;
    const dx = e.clientX - pan.x;
    const dy = e.clientY - pan.y;
    if (!pan.moved) {
      if (Math.hypot(dx, dy) < PAN_SLOP) return;
      pan.moved = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setPanning(true);
    }
    e.currentTarget.scrollLeft = pan.left - dx;
    e.currentTarget.scrollTop = pan.top - dy;
  };
  const endPan = (e: PointerEvent<HTMLDivElement>) => {
    if (panRef.current?.id !== e.pointerId) return;
    pannedRef.current = panRef.current.moved;
    panRef.current = null;
    setPanning(false);
  };
  const onClickCapture = (e: { stopPropagation: () => void; preventDefault: () => void }) => {
    if (!pannedRef.current) return;
    pannedRef.current = false;
    e.stopPropagation();
    e.preventDefault();
  };

  // Keep the step playing in view: scroll when its messages or their participants are out of sight.
  // Only when the step changes, so it never fights the reader's own zooming and panning.
  useEffect(() => {
    const box = scrollRef.current;
    const rows = layout.rows.filter((r) => r.frame === frame);
    if (!box || !innerRef.current || rows.length === 0) return;
    const z = zoomRef.current;
    const involved = layout.columns.filter((c) => rows.some((r) => r.message.from === c.id || r.message.to === c.id));
    const top = (SEQ.header + rows[0].y - 36) * z;
    const bottom = (SEQ.header + rows.at(-1)!.y + 20) * z;
    const origin = originX();
    const left = origin + (Math.min(...involved.map((c) => c.x - c.width / 2)) - 16) * z;
    const right = origin + (Math.max(...involved.map((c) => c.x + c.width / 2)) + 16) * z;
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const to: ScrollToOptions = { behavior: smooth ? 'smooth' : 'auto' };
    if (top < box.scrollTop + SEQ.header * z || bottom > box.scrollTop + box.clientHeight) to.top = Math.max(top - box.clientHeight * 0.3, 0);
    if (left < box.scrollLeft || right > box.scrollLeft + box.clientWidth) {
      // Wider than the pane: start at its left edge; else centre it.
      to.left = Math.max(right - left > box.clientWidth ? left : (left + right - box.clientWidth) / 2, 0);
    }
    if (to.top !== undefined || to.left !== undefined) box.scrollTo?.(to);
  }, [layout, frame]);

  const title = useCase.scenarios.length > 1 ? `${useCase.name} › ${scenario.name}` : useCase.name;
  const { width, height } = layout;
  const left = (depth: number) => 10 + depth * SEQ.sectionInset;
  const span = (depth: number) => width - 20 - 2 * depth * SEQ.sectionInset;

  return (
    <div className={`pc-seq-view ${className || 'relative h-full'}`}>
    <div
      ref={scrollRef}
      className="pc-seq"
      role="figure"
      aria-label={`Sequence diagram: ${title}`}
      data-panning={panning || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onClickCapture={onClickCapture}
    >
      <div ref={innerRef} className="pc-seq__inner" style={{ width, zoom: zoom === 1 ? undefined : zoom }}>
        <div className="pc-seq__heads" style={{ height: SEQ.header }}>
          {layout.columns.map((c) => (
            <div key={c.id} className="pc-seq__head" data-lit={lit.get(c.id)} style={{ left: c.x - c.width / 2, width: c.width }} title={c.node?.description}>
              {c.node && !c.node.implicit && <div className="pc-node__icon">{getTechStackIcon(c.node.techStack, c.node.type)}</div>}
              <div className="min-w-0">
                <div className="pc-node__name truncate">{c.name}</div>
                {c.tech && <div className="pc-node__tech truncate">{c.tech}</div>}
              </div>
            </div>
          ))}
        </div>

        <svg className="pc-seq__body" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          <defs>
            <Marker id={`${ids}-solid`} tone="ink" />
            <Marker id={`${ids}-open`} tone="ink" open />
            <Marker id={`${ids}-reply`} tone="muted" open />
            <Marker id={`${ids}-solid-lit`} tone="pink" />
            <Marker id={`${ids}-open-lit`} tone="pink" open />
            <Marker id={`${ids}-solid-fail`} tone="fail" />
            <Marker id={`${ids}-open-fail`} tone="fail" open />
          </defs>

          {layout.boxes.map((b, i) => (
            <BoxFrame key={i} box={b} x={left(b.depth)} w={span(b.depth)} />
          ))}
          {layout.columns.map((c) => (
            <line key={c.id} className="pc-seq__lifeline" data-lit={lit.get(c.id)} x1={c.x} y1={0} x2={c.x} y2={height} />
          ))}
          {layout.boxes.map((b, i) => b.kind === 'section' && <SectionTab key={i} name={b.name} x={left(b.depth)} y={b.top} />)}
          {layout.rows.map((row) => row.frame === frame && <rect key={`band${row.index}`} className="pc-seq__band" x={0} y={row.y - 30} width={width} height={42} />)}
          {layout.rows.map((row) => (
            <Message key={row.index} row={row} look={lookAt(row, frame)} ids={ids} name={name} onSelect={onSelectFrame} />
          ))}
          <Packets rows={layout.rows} frame={frame} />
          {layout.rows.length === 0 && (
            <text className="pc-seq__label" x={SEQ.margin} y={30}>
              No steps
            </text>
          )}
        </svg>
      </div>
    </div>
    <ZoomControls
      zoom={zoom}
      min={ZOOM.min}
      max={ZOOM.max}
      fitted={fit === 'all'}
      onZoomIn={() => zoomTo(zoom * ZOOM.step)}
      onZoomOut={() => zoomTo(zoom / ZOOM.step)}
      onFit={fitAll}
      onReset={() => zoomTo(1)}
    />
    </div>
  );
}

export default memo(SequenceView);

function Marker({ id, tone, open = false }: { id: string; tone: 'ink' | 'muted' | 'pink' | 'fail'; open?: boolean }) {
  const color = `rgb(var(--c-${tone}))`;
  return (
    <marker id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
      {open ? (
        <path d="M1,1 L9,5 L1,9" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M0,0 L10,5 L0,10 Z" fill={color} />
      )}
    </marker>
  );
}

function BoxFrame({ box, x, w }: { box: SeqBox; x: number; w: number }) {
  const h = box.bottom - box.top;
  if (box.kind === 'section') return <rect className="pc-seq__section" x={x} y={box.top} width={w} height={h} rx={4} />;
  return (
    <g className="pc-seq__par">
      <rect x={x} y={box.top} width={w} height={h} rx={4} />
      <path className="pc-seq__par-tab" d={`M${x},${box.top + 18} H${x + 30} L${x + 36},${box.top + 12} V${box.top}`} />
      <text x={x + 7} y={box.top + 13}>
        par
      </text>
      {box.dividers.map((y, i) => (
        <line key={i} className="pc-seq__par-and" x1={x} y1={y} x2={x + w} y2={y} />
      ))}
    </g>
  );
}

/** A section's name in a tab on its frame's corner, as in a UML frame; drawn over the lifelines. */
function SectionTab({ name, x, y }: { name: string; x: number; y: number }) {
  const w = Math.min(name.length, 48) * 7 + 24;
  const d = `M${x},${y + 4} Q${x},${y} ${x + 4},${y} H${x + w} V${y + 13} L${x + w - 7},${y + 20} H${x} Z`;
  return (
    <g className="pc-seq__tab">
      <path d={d} />
      <text x={x + 9} y={y + 14}>
        {name.length > 48 ? `${name.slice(0, 47)}…` : name}
      </text>
    </g>
  );
}

/**
 * The packets of the step playing, riding their arrows as the canvas's ride its
 * edges, on the playback clock. The only part of the view that re-renders on
 * every tick. A failed call stops short and is marked where it was cut off.
 */
function Packets({ rows, frame }: { rows: SeqMessageRow[]; frame: number }) {
  const progress = usePlaybackProgress();
  const windows = useMemo(() => packetWindows(rows, frame), [rows, frame]);
  return (
    <g className="pc-seq__packets">
      {rows.map((row) => {
        const window = windows.get(row.index);
        if (!window) return null;
        const points = arrowPoints(row);
        const m = row.message;
        if (m.failed) {
          // Over the arrow's own cross, just past where it stops.
          const last = points.at(-1)!;
          const cross = row.x1 === row.x2 ? last : { x: last.x + Math.sign(row.x2 - row.x1) * 7, y: last.y };
          if (progress >= FAIL_AT) return <CutOffMark key={row.index} at={cross} />;
          return <PacketMark key={row.index} at={pointAlong(points, progress / FAIL_AT)} progress={progress} />;
        }
        const [start, end] = window;
        if (progress < start || progress >= end) return null;
        return <PacketMark key={row.index} at={pointAlong(points, (progress - start) / (end - start))} progress={progress} error={m.error} />;
      })}
    </g>
  );
}

const ARROW_WORD =(m: SequenceMessage) => (m.kind === 'response' ? 'answers' : m.failed ? 'calls, and gets no answer from' : m.async ? 'sends to' : 'calls');

interface MessageProps {
  row: SeqMessageRow;
  look: SeqLook;
  ids: string;
  name: (id: string) => string;
  onSelect?: (frame: number) => void;
}

function Message({ row, look, ids, name, onSelect }: MessageProps) {
  const { message: m, x1, x2, y, label } = row;
  const lit = look === 'lit';
  const tone = m.error ? 'fail' : lit ? 'lit' : undefined;
  const open = m.kind === 'response' || m.async;
  const head = `url(#${ids}-${tone === 'fail' ? `${open ? 'open' : 'solid'}-fail` : tone === 'lit' ? `${open ? 'open' : 'solid'}-lit` : m.kind === 'response' ? 'reply' : open ? 'open' : 'solid'})`;
  const request = m.kind === 'request';
  const self = x1 === x2;
  const labelWidth = label.length * SEQ.charWidth + (request ? 24 : 0);
  const labelX = self ? x1 + 46 : (x1 + x2) / 2 - labelWidth / 2;
  const labelY = self ? y + 13 : y - 9;
  const status = m.kind === 'response' && m.status !== undefined && label.startsWith(String(m.status)) ? String(m.status) : undefined;
  const dir = Math.sign(x2 - x1);
  const points = arrowPoints(row);
  const end = points[1].x;
  const hitLeft = self ? x1 - 8 : Math.min(x1, x2) - 8;
  const hitRight = self ? Math.max(x1 + 52 + labelWidth, x1 + 48) : Math.max(x1, x2) + 8;
  const select = () => onSelect?.(row.frame);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    select();
  };

  return (
    <g
      className="pc-seq__msg"
      data-kind={m.failed ? 'failed' : m.kind}
      data-look={look}
      data-error={m.error || undefined}
      data-step={m.number}
      {...(onSelect ? { role: 'button', tabIndex: 0, onClick: select, onKeyDown, 'aria-current': lit ? 'step' : undefined } : {})}
      aria-label={`${request ? `Step ${m.number}: ` : ''}${name(m.from)} ${ARROW_WORD(m)} ${name(m.to)}${m.label ? `: ${m.label}` : ''}`}
    >
      <title>{m.label || (request ? `Step ${m.number}` : `Answer to step ${m.number}`)}</title>
      <rect className="pc-seq__hit" x={hitLeft} y={y - 30} width={hitRight - hitLeft} height={self ? 54 : 42} rx={4} />
      {self ? (
        <path className="pc-seq__line" d={`M${points.map((p) => `${p.x},${p.y}`).join(' L')}`} markerEnd={head} />
      ) : (
        <line className="pc-seq__line" x1={x1} y1={y} x2={end} y2={y} markerEnd={m.failed ? undefined : head} />
      )}
      {m.failed && !self && (
        <path className="pc-seq__cross" d={`M${end + dir * 7 - 5},${y - 5} l10,10 m0,-10 l-10,10`} />
      )}
      {request && (
        <g className="pc-seq__badge">
          <circle cx={labelX + 9} cy={labelY - 4} r={9} />
          <text x={labelX + 9} y={labelY - 0.5} textAnchor="middle">
            {m.number}
          </text>
        </g>
      )}
      {label && (
        <text className="pc-seq__label" x={labelX + (request ? 24 : 0)} y={labelY}>
          {status ? (
            <>
              <tspan fontWeight={700}>{status}</tspan>
              {label.slice(status.length)}
            </>
          ) : (
            label
          )}
        </text>
      )}
    </g>
  );
}
