import { useId, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { niceTicks } from './chartScale';
import { formatCompact, formatNumber, shortDay } from './format';

export interface Series {
  /** The series' key in each point's `values`. */
  id: string;
  label: string;
}

export interface Point {
  /** A UTC day, YYYY-MM-DD. */
  day: string;
  values: Record<string, number>;
}

export interface ChartProps {
  title: string;
  /** Bars for what happens per day (sign-ups, spend), a line for a level (active users, subscribers). */
  kind: 'bar' | 'line';
  /** One series for bars; up to four for lines (categorical slots 1–4, admin.css `--adm-series-*`). */
  series: Series[];
  points: Point[];
  format?: (n: number) => string;
  /** What the head shows when nothing is hovered: the range's total (bars) or the last day's value (lines). */
  summary?: 'total' | 'latest';
  /** Shown over the plot when every value is 0. */
  empty?: string;
  /** Loading again: the old render stays, dimmed. */
  refetching?: boolean;
  height?: number;
}

/** The direct labels' height: two that would overlap are pushed apart by this much. */
const LABEL_PX = 14;

/** End labels' tops (px), each at its line's last value, nudged apart so none overlap and none fall off the plot. */
function labelTops(ends: number[], height: number): number[] {
  const order = ends.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const tops = new Array<number>(ends.length);
  let last = -Infinity;
  for (const { y, i } of order) {
    const top = Math.max(y, last + LABEL_PX);
    tops[i] = top;
    last = top;
  }
  const overflow = Math.max(0, last - height);
  return tops.map((t) => t - overflow);
}

/**
 * Every chart in the admin panel: one series per day as bars, or up to four
 * as 2px lines, on one y-axis with three clean ticks and hairline grid, the
 * first, middle and last day under it. Hovering (or the arrow keys on the
 * focused plot) snaps a crosshair to a day and shows every series' value in a
 * tooltip; a legend names the series when there are two or more, and the
 * lines are also named at their ends. The same numbers are in a table under
 * "Show numbers", so no value needs the pointer. All zeros shows `empty`.
 */
export default function Chart({
  title,
  kind,
  series,
  points,
  format = formatNumber,
  summary = kind === 'bar' ? 'total' : 'latest',
  empty,
  refetching,
  height = 160,
}: ChartProps) {
  const [active, setActive] = useState<number>();
  const id = useId();
  const n = points.length;
  const all = points.flatMap((p) => series.map((s) => p.values[s.id] ?? 0));
  const max = Math.max(0, ...all);
  const ticks = niceTicks(max, all.every(Number.isInteger));
  const top = ticks[2];
  const tick = (v: number) => (top >= 10_000 ? formatCompact(v) : format(v));
  const y = (v: number) => height - (v / top) * height;
  // A day's centre as a share of the plot's width: bars sit in equal slots, line points run edge to edge.
  const x = (i: number) => (kind === 'bar' ? (i + 0.5) / Math.max(1, n) : n <= 1 ? 0.5 : i / (n - 1));
  const value = (p: Point | undefined, s: Series) => p?.values[s.id] ?? 0;
  const shown = active !== undefined ? points[active] : undefined;
  const headline = (s: Series) => (shown ? value(shown, s) : summary === 'total' ? points.reduce((t, p) => t + value(p, s), 0) : value(points.at(-1), s));
  const isEmpty = max === 0;
  const labelled = kind === 'line' && series.length > 1;
  const tops = labelled
    ? labelTops(
        series.map((s) => y(value(points.at(-1), s))),
        height,
      )
    : [];

  const pick = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const share = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    setActive(kind === 'bar' ? Math.min(n - 1, Math.floor(share * n)) : Math.round(share * (n - 1)));
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, Home: -n, End: n };
    if (!(e.key in moves) || !n) return;
    e.preventDefault();
    setActive((a) => Math.min(n - 1, Math.max(0, (a ?? (moves[e.key] > 0 ? -1 : n)) + moves[e.key])));
  };
  const tipSide = active === undefined ? '' : x(active) < 0.2 ? ' is-start' : x(active) > 0.8 ? ' is-end' : '';

  return (
    <figure className={`adm-chart${refetching ? ' adm-refetching' : ''}`} aria-labelledby={`${id}-title`}>
      <figcaption className="adm-chart__head">
        <span id={`${id}-title`} className="adm-chart__title">
          {title}
        </span>
        {series.length === 1 && (
          <span className="adm-chart__summary">
            <strong>{format(headline(series[0]))}</strong> {shown ? shortDay(shown.day) : summary === 'total' ? `in ${n} days` : 'now'}
          </span>
        )}
      </figcaption>
      {series.length > 1 && (
        <div className="adm-legend">
          <ul className="adm-legend__list" aria-label="Series">
            {series.map((s, i) => (
              <li key={s.id} className="adm-legend__item">
                <span className={`adm-legend__key adm-legend__key--${kind} adm-series-${i + 1}`} aria-hidden="true" />
                <span className="adm-legend__value">{format(headline(s))}</span>
                <span className="adm-muted">{s.label}</span>
              </li>
            ))}
          </ul>
          <span className="adm-legend__when adm-muted">{shown ? shortDay(shown.day) : summary === 'total' ? `in ${n} days` : 'now'}</span>
        </div>
      )}
      <div className={`adm-plot${labelled ? ' adm-plot--labelled' : ''}`}>
        <div className="adm-plot__ticks" style={{ height }} aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} style={{ top: y(t) }}>
              {tick(t)}
            </span>
          ))}
        </div>
        <div className="adm-plot__area" style={{ height }}>
          {ticks.map((t) => (
            <span key={t} className={`adm-plot__grid${t === 0 ? ' is-base' : ''}`} style={{ top: y(t) }} aria-hidden="true" />
          ))}
          {kind === 'bar' ? (
            <div className="adm-bars adm-series-1" aria-hidden="true">
              {points.map((p, i) => (
                <span key={p.day} className={`adm-bars__slot${active === i ? ' is-active' : ''}`}>
                  <span className="adm-bars__bar" style={{ height: value(p, series[0]) ? `max(2px, ${(value(p, series[0]) / top) * 100}%)` : 0 }} />
                </span>
              ))}
            </div>
          ) : (
            <svg className="adm-lines" viewBox={`0 0 1000 ${height}`} preserveAspectRatio="none" aria-hidden="true">
              {series.map((s, i) => (
                <polyline
                  key={s.id}
                  className={`adm-lines__line adm-series-${i + 1}`}
                  points={points.map((p, j) => `${x(j) * 1000},${y(value(p, s))}`).join(' ')}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
          )}
          {shown && active !== undefined && (
            <>
              {kind === 'line' && (
                <>
                  <span className="adm-plot__crosshair" style={{ left: `${x(active) * 100}%` }} aria-hidden="true" />
                  {series.map((s, i) => (
                    <span
                      key={s.id}
                      className={`adm-plot__dot adm-series-${i + 1}`}
                      style={{ left: `${x(active) * 100}%`, top: y(value(shown, s)) }}
                      aria-hidden="true"
                    />
                  ))}
                </>
              )}
              <div className={`adm-tip${tipSide}`} style={{ left: `${x(active) * 100}%` }} aria-hidden="true">
                <span className="adm-tip__day">{shortDay(shown.day)}</span>
                {series.map((s, i) => (
                  <span key={s.id} className="adm-tip__row">
                    {series.length > 1 && <span className={`adm-legend__key adm-legend__key--line adm-series-${i + 1}`} />}
                    <strong>{format(value(shown, s))}</strong>
                    <span className="adm-muted">{s.label}</span>
                  </span>
                ))}
              </div>
            </>
          )}
          {isEmpty && empty && <p className="adm-plot__empty">{empty}</p>}
          <div
            className="adm-plot__hit"
            tabIndex={0}
            role="group"
            aria-label={`${title}: arrow keys read one day at a time`}
            onPointerMove={pick}
            onPointerDown={pick}
            onPointerLeave={() => setActive(undefined)}
            onKeyDown={key}
            onBlur={() => setActive(undefined)}
          />
        </div>
        {labelled && (
          <div className="adm-plot__labels" style={{ height }} aria-hidden="true">
            {series.map((s, i) => (
              <span key={s.id} style={{ top: tops[i] }}>
                {s.label}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className={`adm-plot__axis${labelled ? ' adm-plot--labelled' : ''}`} aria-hidden="true">
        <span>{points[0] && shortDay(points[0].day)}</span>
        <span>{n > 2 && shortDay(points[Math.floor((n - 1) / 2)].day)}</span>
        <span>{points.at(-1) && shortDay(points.at(-1)!.day)}</span>
      </div>
      <details className="adm-chart__table">
        <summary>Show numbers</summary>
        <div className="adm-chart__scroll">
          <table className="adm-table adm-table--compact">
            <thead>
              <tr>
                <th scope="col">Day (UTC)</th>
                {series.map((s) => (
                  <th key={s.id} scope="col" className="adm-num">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((p) => (
                <tr key={p.day}>
                  <td>{p.day}</td>
                  {series.map((s) => (
                    <td key={s.id} className="adm-num">
                      {format(value(p, s))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <span className="adm-sr" aria-live="polite">
        {shown ? `${shortDay(shown.day)}: ${series.map((s) => `${s.label} ${format(value(shown, s))}`).join(', ')}` : ''}
      </span>
    </figure>
  );
}
