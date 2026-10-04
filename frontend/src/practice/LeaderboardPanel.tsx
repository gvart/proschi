import { Trophy } from 'lucide-react';
import type { Leaderboard } from '../services/api';

/** Users who opted in, by problems solved. */
export default function LeaderboardPanel({ leaderboard }: { leaderboard: Leaderboard }) {
  return (
    <section aria-labelledby="leaderboard" className="mt-8">
      <h2 id="leaderboard" className="flex items-center gap-2 text-lg font-semibold text-ink">
        <Trophy size={18} className="text-amber-500 dark:text-amber-400" />
        Leaderboard
      </h2>
      {leaderboard.entries.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Nobody yet. Sign in, solve a problem and choose “Show me on the leaderboard” in your account menu.</p>
      ) : (
        <ol className="mt-3 divide-y divide-ink/15 rounded-lg border border-ink/15 bg-surface text-sm">
          {leaderboard.entries.map((e) => (
            <li key={`${e.rank}-${e.displayName}-${e.lastSolvedAt}`} className="flex items-center gap-3 px-4 py-2">
              <span className="w-6 text-right tabular-nums text-muted">{e.rank}</span>
              <span className="flex-1 min-w-0 truncate text-ink">{e.displayName}</span>
              <span className="tabular-nums text-ink/75">
                {e.solved} / {leaderboard.problems}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
