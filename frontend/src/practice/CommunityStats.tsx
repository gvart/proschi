import { Users } from 'lucide-react';
import type { Distribution, ProblemStats } from '../services/api';
import { formatMs, formatUsd } from '../sim/format';

interface CommunityStatsProps {
  stats: ProblemStats;
  /** Signed out with sign-in on offer: invite to compare. */
  canSignIn: boolean;
}

const pct = (fraction: number) => `${Math.round(fraction * 100)}%`;

/** How others did on this problem, and, signed in after solving it, where your design falls among theirs. */
export default function CommunityStats({ stats, canSignIn }: CommunityStatsProps) {
  const { you } = stats;
  return (
    <div className="m-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-gray-700">
      <p className="flex items-center gap-2">
        <Users size={16} className="flex-shrink-0 text-gray-500" />
        <span>
          {stats.attempted === 0 ? (
            'Nobody has recorded a run of this problem yet.'
          ) : (
            <>
              Solved by {stats.solved} of {stats.attempted} who tried
              {stats.medianRunsToSolve !== null && <>, after a median of {formatRuns(stats.medianRunsToSolve)}</>}.
            </>
          )}
        </span>
      </p>
      {you && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Metric
            label="Your cheapest design"
            value={formatUsd(you.costUsd)}
            comparison={you.cheaperThan !== null ? `cheaper than ${pct(you.cheaperThan)} of other solvers` : undefined}
            distribution={stats.costUsd}
            mine={you.costUsd}
            format={formatUsd}
          />
          {you.p99Ms !== null && (
            <Metric
              label="Your fastest p99"
              value={formatMs(you.p99Ms)}
              comparison={you.fasterThan !== null ? `faster than ${pct(you.fasterThan)} of other solvers` : undefined}
              distribution={stats.p99Ms}
              mine={you.p99Ms}
              format={formatMs}
            />
          )}
        </div>
      )}
      {stats.you === undefined && canSignIn && <p className="mt-1 text-xs text-gray-500">Sign in to record your solves and compare your design’s cost and latency with other solvers.</p>}
    </div>
  );
}

function formatRuns(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return `${rounded} test run${rounded === 1 ? '' : 's'}`;
}

interface MetricProps {
  label: string;
  value: string;
  comparison?: string;
  distribution: Distribution | null;
  mine: number;
  format: (n: number) => string;
}

/** A value, how it compares, and a strip from the lowest to the highest solver's value with the middle half shaded and yours marked. */
function Metric({ label, value, comparison, distribution: d, mine, format }: MetricProps) {
  const span = d ? d.max - d.min : 0;
  const at = (v: number) => (span > 0 ? `${Math.min(100, Math.max(0, ((v - d!.min) / span) * 100))}%` : '50%');
  return (
    <div className="rounded border border-gray-200 bg-white px-2.5 py-2">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="font-medium text-gray-900">{value}</p>
      {comparison && <p className="text-xs text-gray-600">{comparison}</p>}
      {d && d.count > 1 && (
        <div className="mt-2" aria-hidden>
          <div className="relative h-2 rounded-full bg-gray-100">
            <div className="absolute inset-y-0 rounded-full bg-blue-100" style={{ left: at(d.p25), right: `calc(100% - ${at(d.p75)})` }} />
            <div className="absolute -top-0.5 h-3 w-0.5 bg-gray-400" style={{ left: at(d.median) }} />
            <div className="absolute -top-1 h-4 w-1.5 -translate-x-1/2 rounded-sm bg-blue-600" style={{ left: at(mine) }} />
          </div>
          <div className="mt-0.5 flex justify-between text-[11px] text-gray-400">
            <span>{format(d.min)}</span>
            <span>median {format(d.median)}</span>
            <span>{format(d.max)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
