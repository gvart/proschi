import { useState } from 'react';
import { formatNumber } from './format';

export interface Bar {
  /** A UTC day, YYYY-MM-DD. */
  day: string;
  value: number;
}

const HEIGHT = 120;
const GAP = 2;

const shortDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

/**
 * One series per day as bars (the title names it, so no legend), with the
 * hovered or focused bar's value above the plot and the same numbers as a
 * table under "Show numbers".
 */
export default function BarChart({ title, bars }: { title: string; bars: Bar[] }) {
  const [active, setActive] = useState<number>();
  const max = Math.max(1, ...bars.map((b) => b.value));
  const total = bars.reduce((sum, b) => sum + b.value, 0);
  const width = 100 / Math.max(1, bars.length);
  const shown = active !== undefined ? bars[active] : undefined;
  return (
    <figure className="adm-chart">
      <figcaption className="adm-chart__head">
        <span className="adm-chart__title">{title}</span>
        <span className="adm-chart__readout" aria-live="polite">
          {shown ? `${shortDay(shown.day)}: ${formatNumber(shown.value)}` : `${formatNumber(total)} in ${bars.length} days`}
        </span>
      </figcaption>
      <div className="adm-chart__plot" style={{ height: HEIGHT }} onMouseLeave={() => setActive(undefined)}>
        {bars.map((bar, i) => (
          <button
            key={bar.day}
            type="button"
            className={`adm-chart__slot${active === i ? ' is-active' : ''}`}
            style={{ left: `${i * width}%`, width: `${width}%` }}
            aria-label={`${shortDay(bar.day)}: ${formatNumber(bar.value)}`}
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(undefined)}
          >
            <span
              className="adm-chart__bar"
              style={{ height: bar.value ? `max(2px, ${(bar.value / max) * 100}%)` : 0, marginInline: GAP / 2 }}
            />
          </button>
        ))}
      </div>
      <div className="adm-chart__axis" aria-hidden="true">
        <span>{bars[0] && shortDay(bars[0].day)}</span>
        <span>max {formatNumber(max)}</span>
        <span>{bars.at(-1) && shortDay(bars.at(-1)!.day)}</span>
      </div>
      <details className="adm-chart__table">
        <summary>Show numbers</summary>
        <table className="adm-table">
          <thead>
            <tr>
              <th scope="col">Day (UTC)</th>
              <th scope="col" className="adm-num">
                {title}
              </th>
            </tr>
          </thead>
          <tbody>
            {[...bars].reverse().map((bar) => (
              <tr key={bar.day}>
                <td>{bar.day}</td>
                <td className="adm-num">{formatNumber(bar.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
