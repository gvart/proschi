import type { Day } from '../../learn/streak';
import { WEEKS, type Week } from './weekly';

/**
 * The progress page's "Last 12 weeks": cards reviewed and problems solved per
 * week (Monday to Sunday, this week last), as two small bar charts drawn in
 * SVG with the theme's colours. Each chart is one image with a summary for
 * screen readers, and the numbers are in a table that follows.
 */

/** "3 Nov", in the reader's language. */
const short = (day: Day) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

const W = 240;
const H = 64;
const GAP = 4;

/** `tone`: a theme colour's name (--c-<tone>). */
function Bars({ label, values, tone, from }: { label: string; values: number[]; tone: 'blue' | 'pass'; from: Day }) {
  const max = Math.max(1, ...values);
  const bar = (W - GAP * (values.length - 1)) / values.length;
  const total = values.reduce((n, v) => n + v, 0);
  const thisWeek = values[values.length - 1];
  return (
    <figure className="min-w-0">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-ink">{label}</span>
        <span className="text-xs tabular-nums text-muted">{total} in all</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-2 h-16 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label} per week, the last ${WEEKS} weeks: ${total} in all, ${thisWeek} this week.`}
      >
        <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} stroke="rgb(var(--c-ink) / 0.25)" strokeWidth={1} />
        {values.map((v, i) => {
          const h = v > 0 ? Math.max(3, (v / max) * (H - 4)) : 0;
          return <rect key={i} x={i * (bar + GAP)} y={H - 1 - h} width={bar} height={h} rx={1.5} fill={`rgb(var(--c-${tone}) / ${i === values.length - 1 ? 1 : 0.55})`} />;
        })}
      </svg>
      <p className="mt-1 flex justify-between text-[11px] tabular-nums text-muted" aria-hidden="true">
        <span>Week of {short(from)}</span>
        <span>This week</span>
      </p>
    </figure>
  );
}

export default function WeeklyActivity({ weeks }: { weeks: Week[] }) {
  return (
    <div data-testid="weekly-activity">
      <div className="grid gap-4">
        <Bars label="Cards reviewed" values={weeks.map((w) => w.reviews)} tone="blue" from={weeks[0].start} />
        <Bars label="Problems solved" values={weeks.map((w) => w.solves)} tone="pass" from={weeks[0].start} />
      </div>
      {/* In a box of its own: a table ignores sr-only's 1px width and would widen a phone's page. */}
      <div className="sr-only">
        <table>
          <caption>Cards reviewed and problems solved per week, oldest first</caption>
          <thead>
            <tr>
              <th scope="col">Week of</th>
              <th scope="col">Cards reviewed</th>
              <th scope="col">Problems solved</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.start}>
                <th scope="row">{short(w.start)}</th>
                <td>{w.reviews}</td>
                <td>{w.solves}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
