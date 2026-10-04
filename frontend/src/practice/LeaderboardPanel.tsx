import { Trophy } from 'lucide-react';
import type { Leaderboard } from '../services/api';

/** Users who opted in, by problems solved. */
export default function LeaderboardPanel({ leaderboard }: { leaderboard: Leaderboard }) {
  return (
    <section aria-labelledby="leaderboard" className="mt-8">
      <h2 id="leaderboard" className="flex items-center gap-2 text-lg font-semibold text-gray-900">
        <Trophy size={18} className="text-amber-500" />
        Leaderboard
      </h2>
      {leaderboard.entries.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">Nobody yet. Sign in, solve a problem and choose “Show me on the leaderboard” in your account menu.</p>
      ) : (
        <ol className="mt-3 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white text-sm">
          {leaderboard.entries.map((e) => (
            <li key={`${e.rank}-${e.displayName}-${e.lastSolvedAt}`} className="flex items-center gap-3 px-4 py-2">
              <span className="w-6 text-right tabular-nums text-gray-400">{e.rank}</span>
              <span className="flex-1 min-w-0 truncate text-gray-900">{e.displayName}</span>
              <span className="tabular-nums text-gray-600">
                {e.solved} / {leaderboard.problems}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
