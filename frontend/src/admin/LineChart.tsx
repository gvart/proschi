import { useState } from 'react';
import { formatNumber } from './format';

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

const HEIGHT = 140;
/** The direct labels' height: two that would overlap are pushed apart by this much. */
const LABEL_PX = 14;

const shortDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** The end labels' heights (px from the top), each at its line's last value, nudged apart so none overlap. */
function labelTops(ends: number[]): number[] {
  const order = ends.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const tops = new Array<number>(ends.length);
  let last = -Infinity;
  for (const { y, i } of order) {
    const top = Math.max(y, last + LABEL_PX);
    tops[i] = top;
    last = top;
  }
  // Pushed past the bottom: shift the whole run back up.
  const overflow = Math.max(0, last - HEIGHT);
  return tops.map((t) => t - overflow);
}

/**
 * Up to four series per day as 2px lines on one axis (categorical slots
 * 1–4, admin.css `--adm-series-*`, validated for light and dark), a legend,
 * each line's name at its end, a crosshair that snaps to the hovered or
 * focused day with every series' value in the readout, and the same numbers
 * as a table under "Show numbers".
 */
export default function LineChart({ title, series, points }: { title: string; series: Series[]; points: Point[] }) {
  const [active, setActive] = useState<number>();
  const max = Math.max(1, ...points.flatMap((p) => series.map((s) => p.values[s.id] ?? 0)));
  const n = points.length;
  // x as a share of the plot's width: the first day at 0, the last at 1.
  const x = (i: number) => (n <= 1 ? 0.5 : i / (n - 1));
  const y = (v: number) => HEIGHT - (v / max) * HEIGHT;
  const shown = active !== undefined ? points[active] : undefined;
  const tops = labelTops(series.map((s) => y(points.at(-1)?.values[s.id] ?? 0)));
  const total = (id: string) => points.reduce((sum, p) => sum + (p.values[id] ?? 0), 0);

  return (
    <figure className="adm-chart adm-chart--lines">
      <figcaption className="adm-chart__head">
        <span className="adm-chart__title">{title}</span>
        <span className="adm-chart__readout" aria-live="polite">
          {shown ? shortDay(shown.day) : `${n} days`}
        </span>
      </figcaption>
      <ul className="adm-legend" aria-label="Series">
        {series.map((s, i) => (
          <li key={s.id} className="adm-legend__item">
            <span className={`adm-legend__key adm-series-${i + 1}`} aria-hidden="true" />
            <span className="adm-legend__value">{formatNumber(shown ? (shown.values[s.id] ?? 0) : total(s.id))}</span>
            <span className="adm-muted">{s.label}</span>
          </li>
        ))}
      </ul>
      <div className="adm-lines">
        <div className="adm-lines__plot" style={{ height: HEIGHT }} onMouseLeave={() => setActive(undefined)}>
          <svg className="adm-lines__svg" viewBox={`0 0 1000 ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
            <line className="adm-lines__grid" x1={0} x2={1000} y1={HEIGHT / 2} y2={HEIGHT / 2} vectorEffect="non-scaling-stroke" />
            {series.map((s, i) => (
              <polyline
                key={s.id}
                className={`adm-lines__line adm-series-${i + 1}`}
                points={points.map((p, j) => `${x(j) * 1000},${y(p.values[s.id] ?? 0)}`).join(' ')}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          {shown && active !== undefined && (
            <>
              <span className="adm-lines__crosshair" style={{ left: `${x(active) * 100}%` }} aria-hidden="true" />
              {series.map((s, i) => (
                <span
                  key={s.id}
                  className={`adm-lines__dot adm-series-${i + 1}`}
                  style={{ left: `${x(active) * 100}%`, top: y(shown.values[s.id] ?? 0) }}
                  aria-hidden="true"
                />
              ))}
            </>
          )}
          {points.map((p, i) => (
            <button
              key={p.day}
              type="button"
              className="adm-lines__slot"
              style={{ left: `${(x(i) - 0.5 / Math.max(1, n - 1)) * 100}%`, width: `${100 / Math.max(1, n - 1)}%` }}
              aria-label={`${shortDay(p.day)}: ${series.map((s) => `${s.label} ${formatNumber(p.values[s.id] ?? 0)}`).join(', ')}`}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(undefined)}
            />
          ))}
        </div>
        <div className="adm-lines__labels" style={{ height: HEIGHT }} aria-hidden="true">
          {series.map((s, i) => (
            <span key={s.id} className="adm-lines__label" style={{ top: tops[i] }}>
              {s.label}
            </span>
          ))}
        </div>
      </div>
      <div className="adm-chart__axis adm-lines__axis" aria-hidden="true">
        <span>{points[0] && shortDay(points[0].day)}</span>
        <span>max {formatNumber(max)}</span>
        <span>{points.at(-1) && shortDay(points.at(-1)!.day)}</span>
      </div>
      <details className="adm-chart__table">
        <summary>Show numbers</summary>
        <table className="adm-table">
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
                    {formatNumber(p.values[s.id] ?? 0)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
