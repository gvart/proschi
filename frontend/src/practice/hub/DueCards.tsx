import deck from 'virtual:practice-cards';
import { NEW_PER_DAY, overview } from '../../learn/review';
import type { Account } from '../useAccount';
import { useTodayCards } from './todayCards';

/** How many cards daily review has for today: those due and the new ones today's allowance still lets in. */
function useDueCount(account: Account): number | undefined {
  const today = useTodayCards(account);
  if (!today) return undefined;
  const { loaded, signedOut } = today;
  const stats = overview(deck.cards, loaded.states, deck.topics, { now: Math.floor(Date.now() / 1000), deck: signedOut ? 'sample' : undefined });
  return stats.due + Math.min(stats.new, Math.max(0, NEW_PER_DAY - loaded.today.new));
}

/** The cards for today, for the Review chip: "9 due", or "all done" when caught up; "…" while counting. */
export default function DueCards({ account }: { account: Account }) {
  const count = useDueCount(account);
  if (count === undefined) return <span className="text-muted">…</span>;
  return (
    <span data-testid="today-due" className="tabular-nums">
      {count === 0 ? 'all done' : `${count} due`}
    </span>
  );
}
