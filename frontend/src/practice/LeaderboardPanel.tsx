import { Trophy } from 'lucide-react';
import type { Leaderboard } from '../services/api';

/** Leaderboards show from this many entries: fewer read as an empty product, so a one-line invitation shows instead. */
export const BOARD_MIN_ENTRIES = 3;

/** The one subtle line shown in place of a leaderboard with too few entries. */
export function BoardInvite() {
  return (
    <p className="mt-6 flex items-center gap-1.5 text-sm text-muted">
      <Trophy size={14} aria-hidden="true" />
      <span>
        Be the first:{' '}
        <a href="#/me" className="underline underline-offset-2 hover:text-ink">
          opt in to the leaderboard
        </a>
      </span>
    </p>
  );
}

/** Users who opted in, by problems solved; each row opens their public profile (`#/u/<id>`). Below BOARD_MIN_ENTRIES, the invitation only. */
export default function LeaderboardPanel({ leaderboard }: { leaderboard: Leaderboard }) {
  if (leaderboard.entries.length < BOARD_MIN_ENTRIES) return <BoardInvite />;
  return (
    <section aria-labelledby="leaderboard" className="mt-8">
      <h2 id="leaderboard" className="flex items-center gap-2 text-lg font-semibold text-ink">
        <Trophy size={18} className="text-amber-500 dark:text-amber-400" />
        Leaderboard
      </h2>
      <ol className="mt-3 divide-y divide-ink/15 rounded-lg border border-ink/15 bg-surface text-sm">
        {leaderboard.entries.map((e) => (
          <li key={e.id}>
            <a
              href={`#/u/${encodeURIComponent(e.id)}`}
              aria-label={`${e.displayName}: rank ${e.rank}, ${e.solved} of ${leaderboard.problems} solved. See their profile`}
              className="flex items-center gap-3 px-4 py-2 hover:bg-pop-yellow/25 focus-visible:outline-none focus-visible:bg-pop-yellow/25"
            >
              <span className="w-6 text-right tabular-nums text-muted">{e.rank}</span>
              <span className="flex-1 min-w-0 truncate text-ink underline-offset-2 hover:underline">{e.displayName}</span>
              <span className="tabular-nums text-ink/75">
                {e.solved} / {leaderboard.problems}
              </span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
