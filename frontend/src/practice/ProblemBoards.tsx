import { useState } from 'react';
import { Trophy } from 'lucide-react';
import type { BoardMetric } from '../services/api';
import { formatMs, formatUsd } from '../sim/format';
import { useProblemBoard } from './useCommunity';

interface ProblemBoardsProps {
  problemId: string;
  signedIn: boolean;
  /** Changes refetch, e.g. after a run is recorded. */
  refresh: number;
}

const METRICS: { id: BoardMetric; label: string; format: (n: number) => string }[] = [
  { id: 'cost', label: 'Cheapest', format: formatUsd },
  { id: 'p99', label: 'Lowest p99', format: formatMs },
];

/**
 * The problem's leaderboards, under how others did (CommunityStats): the
 * cheapest passing design and the lowest worst-use-case p99, each solver's
 * best as the server measured it, the top 10 of those who opted in, and
 * your own rank signed in.
 */
export default function ProblemBoards({ problemId, signedIn, refresh }: ProblemBoardsProps) {
  const [metric, setMetric] = useState<BoardMetric>('cost');
  const answer = useProblemBoard(problemId, metric, signedIn, refresh);
  // The hook keeps the last answer while the other metric loads: show only this metric's.
  const board = answer?.metric === metric && answer.problem === problemId ? answer : undefined;
  const { label, format } = METRICS.find((m) => m.id === metric)!;
  if (!answer) return null;
  return (
    <section aria-labelledby="problem-board" className="m-3 rounded-md border border-ink/15 bg-paper px-3 py-2 text-ink/85">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="problem-board" className="flex items-center gap-2 font-semibold text-ink">
          <Trophy size={16} aria-hidden="true" className="text-amber-500 dark:text-amber-400" />
          Leaderboard
        </h3>
        <div role="group" aria-label="Rank by" className="inline-flex overflow-hidden rounded border border-ink/30 text-xs">
          {METRICS.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={m.id === metric}
              onClick={() => setMetric(m.id)}
              className={`min-h-[32px] px-2.5 font-semibold first:border-l-0 border-l border-ink/30 ${m.id === metric ? 'bg-ink text-paper' : 'bg-surface text-ink hover:bg-pop-yellow/30'}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      {!board ? (
        <p className="mt-2 text-xs text-muted">Loading…</p>
      ) : (
        <>
          {board.entries.length === 0 ? (
            <p className="mt-2 text-xs text-muted">Nobody here yet. Solve it, then choose “Show me on the leaderboard” in your account menu.</p>
          ) : (
            <ol aria-label={`${label} passing designs`} className="mt-2 divide-y divide-ink/10 rounded border border-ink/15 bg-surface">
              {board.entries.map((e) => (
                <li key={e.id}>
                  <a
                    href={`#/u/${encodeURIComponent(e.id)}`}
                    aria-label={`${e.displayName}: rank ${e.rank}, ${format(e.value)}. See their profile`}
                    className="flex items-center gap-3 px-2.5 py-1.5 hover:bg-pop-yellow/25 focus-visible:outline-none focus-visible:bg-pop-yellow/25"
                  >
                    <span className="w-5 text-right tabular-nums text-muted">{e.rank}</span>
                    <span className="min-w-0 flex-1 truncate text-ink">{e.displayName}</span>
                    <span className="tabular-nums text-ink/75">{format(e.value)}</span>
                  </a>
                </li>
              ))}
            </ol>
          )}
          {board.you && (
            <p data-testid="problem-board-you" className="mt-2 text-xs text-ink">
              You: rank {board.you.rank} of {board.you.players}, {format(board.you.value)}
            </p>
          )}
          {board.players > 0 && <p className="mt-1 text-[11px] text-muted">Each solver’s best passing design as the server measured it; ties go to whoever got there first.</p>}
        </>
      )}
    </section>
  );
}
