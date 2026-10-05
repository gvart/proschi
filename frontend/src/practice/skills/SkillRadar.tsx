import { useState } from 'react';
import { percent } from '../../learn/mastery';

export interface RadarPoint {
  id: string;
  label: string;
  /** 0 to 1. */
  value: number;
}

/** The chart's box in SVG units, wider than tall for the labels at the sides; it scales to the width it is given. */
const WIDTH = 460;
const HEIGHT = 360;
const CX = WIDTH / 2;
const CY = HEIGHT / 2;
/** The 100% ring; the rest of the box is for the labels. */
const RADIUS = 130;
const LABEL_RADIUS = RADIUS + 12;
const RINGS = [0.25, 0.5, 0.75, 1];

/** The point at `share` of the radius on axis `i` of `n`, the first straight up, clockwise. */
function at(i: number, n: number, share: number): [number, number] {
  const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
  return [CX + Math.cos(angle) * RADIUS * share, CY + Math.sin(angle) * RADIUS * share];
}

/** A label longer than a short word goes one word a line, so topic names stay inside the box. */
function lines(label: string): string[] {
  return label.length <= 10 ? [label] : label.split(' ');
}

/**
 * Topic mastery as a radar: one axis per topic, rings at 25% steps, the
 * learner's shape filled. Drawn in SVG with the theme's colours (no chart
 * library). The SVG is one image with a short summary for screen readers,
 * who get the full numbers from the table that follows it; hovering or
 * focusing a point shows its value.
 */
export default function SkillRadar({ points, summary }: { points: RadarPoint[]; summary: string }) {
  const [active, setActive] = useState<string | undefined>(undefined);
  const n = points.length;
  if (n < 3) return null;
  const shape = points.map((p, i) => at(i, n, Math.max(0.02, p.value)).join(',')).join(' ');
  const current = points.find((p) => p.id === active);

  return (
    <figure className="mx-auto w-full max-w-[32rem]">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full" role="img" aria-label={summary}>
        {RINGS.map((r) => (
          <polygon
            key={r}
            points={points.map((_, i) => at(i, n, r).join(',')).join(' ')}
            fill="none"
            stroke="rgb(var(--c-ink) / 0.14)"
            strokeWidth={r === 1 ? 1.5 : 1}
          />
        ))}
        {points.map((p, i) => {
          const [x, y] = at(i, n, 1);
          return <line key={p.id} x1={CX} y1={CY} x2={x} y2={y} stroke="rgb(var(--c-ink) / 0.14)" strokeWidth={1} />;
        })}
        <text x={CX + 3} y={CY - RADIUS * 0.5 - 3} fontSize={10} fill="rgb(var(--c-muted))" aria-hidden="true">
          50%
        </text>
        <polygon points={shape} fill="rgb(var(--c-blue) / 0.28)" stroke="rgb(var(--c-blue))" strokeWidth={2} strokeLinejoin="round" />
        {points.map((p, i) => {
          const [x, y] = at(i, n, Math.max(0.02, p.value));
          const on = p.id === active;
          return (
            <g key={p.id} onMouseEnter={() => setActive(p.id)} onMouseLeave={() => setActive(undefined)}>
              {/* A bigger, invisible target than the dot. */}
              <circle cx={x} cy={y} r={12} fill="transparent" />
              <circle cx={x} cy={y} r={on ? 6 : 4.5} fill="rgb(var(--c-blue))" stroke="rgb(var(--c-surface))" strokeWidth={2} />
            </g>
          );
        })}
        {points.map((p, i) => {
          const [x, y] = at(i, n, LABEL_RADIUS / RADIUS);
          const dx = x - CX;
          const anchor = Math.abs(dx) < 8 ? 'middle' : dx > 0 ? 'start' : 'end';
          const parts = lines(p.label);
          const above = y < CY - RADIUS * 0.9;
          const below = y > CY + RADIUS * 0.9;
          const y0 = above ? y - (parts.length - 1) * 14 : below ? y + 10 : y + 4 - ((parts.length - 1) * 14) / 2;
          return (
            <text
              key={p.id}
              x={x}
              y={y0}
              textAnchor={anchor}
              fontSize={13.5}
              fontWeight={p.id === active ? 700 : 600}
              fill="rgb(var(--c-ink))"
              aria-hidden="true"
              onMouseEnter={() => setActive(p.id)}
              onMouseLeave={() => setActive(undefined)}
            >
              {parts.map((line, j) => (
                <tspan key={j} x={x} dy={j ? 14 : 0}>
                  {line}
                </tspan>
              ))}
            </text>
          );
        })}
      </svg>
      <figcaption className="mt-1 min-h-[1.25rem] text-center text-sm tabular-nums text-ink/80" aria-hidden="true">
        {current ? (
          <>
            <span className="font-semibold text-ink">{current.label}</span>: {percent(current.value)}%
          </>
        ) : (
          'Hover a point to see its value.'
        )}
      </figcaption>
    </figure>
  );
}
