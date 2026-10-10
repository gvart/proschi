import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Layers, Map as MapIcon, PartyPopper, Trophy } from 'lucide-react';
import { api, type EmailPrefs } from '../services/api';
import problems from 'virtual:practice-listings';
import type { Topic } from '../learn/cards';
import type { Engine } from '../hld/engine';
import { formatMs, formatUsd } from '../sim/format';
import { eyebrow } from '../components/Playground/ui';
import ShareButton from '../components/ShareButton';
import { solveShareText } from '../learn/share';
import { Celebration } from './Streak';
import type { Progress } from './progress';
import { ROADMAP, roadmapFor, roadmapHref } from './roadmap';
import { compareToReference as compare, roadmapAfterSolve } from './solveSummary';
import type { Problem } from './types';
import type { Account } from './useAccount';
import EmailReminders from './profile/EmailReminders';
import { parseSolution, runTests, type DesignMetrics } from './workspace';

/** The roadmap's stages with the problems this build has. */
const stages = roadmapFor(ROADMAP, problems.map((p) => p.id));
const titleOf = (id: string) => problems.find((p) => p.id === id)?.title ?? id;

interface SolveCelebrationProps {
  problem: Problem;
  engine: Engine;
  /** Test runs it took (the server's count signed in, this visit's otherwise). */
  runs: number;
  metrics?: DesignMetrics;
  /** The progress before the solve. */
  before: Progress;
  /** Signed in, offers email reminders and the leaderboard here, the moment they matter. */
  account?: Account;
}

/**
 * A problem's first solve: what it took, the design's cost and p99 next to
 * the reference solution's, a roadmap stage completed, and where to go next
 * (the next roadmap problem, the cards that train for this one), and a
 * share button with the cost and p99 (learn/share.ts). Signed in, it also
 * offers email reminders and the leaderboard, unless the user has them.
 */
export default function SolveCelebration({ problem, engine, runs, metrics, before, account }: SolveCelebrationProps) {
  const reference = useMemo(() => runTests(parseSolution(problem, problem.solution), engine).metrics, [problem, engine]);
  const roadmap = useMemo(() => roadmapAfterSolve(stages, problem.id, before), [problem.id, before]);
  const completed = roadmap.completed !== undefined ? stages[roadmap.completed] : undefined;
  const topics = useRelatedTopics(problem.id);

  const rows: [string, string, string | undefined][] = [];
  if (metrics?.costUsd !== undefined) {
    rows.push(['Monthly cost', formatUsd(metrics.costUsd), reference?.costUsd !== undefined ? compare(metrics.costUsd, reference.costUsd, 'cheaper', 'pricier') : undefined]);
  }
  if (metrics?.p99Ms !== undefined) {
    rows.push(['Worst p99', formatMs(metrics.p99Ms), reference?.p99Ms !== undefined ? compare(metrics.p99Ms, reference.p99Ms, 'faster', 'slower') : undefined]);
  }

  return (
    <div className="m-3">
      <Celebration label="First solve" tone={completed ? 'bg-pop-yellow/30' : 'bg-pass/20'}>
        {completed ? (
          <>
            <p className={eyebrow}>
              Roadmap stage {roadmap.completed! + 1} of {stages.length}
            </p>
            <h2 className="mt-0.5 flex items-center gap-2 font-display text-lg font-bold text-ink">
              <Trophy size={18} aria-hidden="true" />
              Stage complete: {completed.title}
            </h2>
            <p className="mt-1 text-sm text-ink/80">You solved {problem.title}, the last problem of this stage.</p>
          </>
        ) : (
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink">
            <PartyPopper size={18} aria-hidden="true" />
            First solve: {problem.title}
          </h2>
        )}
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          <div>
            <dt className={eyebrow}>Test runs</dt>
            <dd className="font-display text-lg font-extrabold tabular-nums text-ink">{runs}</dd>
          </div>
          {rows.map(([label, value, versus]) => (
            <div key={label}>
              <dt className={eyebrow}>{label}</dt>
              <dd className="font-display text-lg font-extrabold tabular-nums text-ink">{value}</dd>
              {versus && <dd className="text-xs text-ink/75">{versus}</dd>}
            </div>
          ))}
        </dl>
        <div className="mt-3">
          <ShareButton
            label="Share your solve"
            text={solveShareText({ id: problem.id, title: problem.title, costUsd: metrics?.costUsd, referenceCostUsd: reference?.costUsd, p99Ms: metrics?.p99Ms })}
          />
        </div>
        <ul className="mt-3 flex flex-col gap-1.5 text-sm">
          {roadmap.next && (
            <li>
              <a href={roadmapHref(roadmap.next)} className="inline-flex items-center gap-1.5 font-semibold text-ink underline decoration-2 underline-offset-2 hover:decoration-pop-blue">
                <MapIcon size={14} aria-hidden="true" />
                Next on the roadmap: {titleOf(roadmap.next)}
                <ArrowRight size={14} aria-hidden="true" />
              </a>
            </li>
          )}
          {completed && !roadmap.next && (
            <li>
              <a href="#/roadmap" className="inline-flex items-center gap-1.5 font-semibold text-ink underline decoration-2 underline-offset-2 hover:decoration-pop-blue">
                <MapIcon size={14} aria-hidden="true" />
                Open the roadmap
              </a>
            </li>
          )}
          {topics.map(({ topic, count }) => (
            <li key={topic.id}>
              <a href={`#/review/${topic.id}`} className="inline-flex items-center gap-1.5 font-semibold text-ink underline decoration-2 underline-offset-2 hover:decoration-pop-blue">
                <Layers size={14} aria-hidden="true" />
                Review {count === 1 ? 'the card' : `${count} cards`} on {topic.title}
              </a>
            </li>
          ))}
        </ul>
        {account?.state.status === 'signed-in' && <StayOnTrack account={account} />}
      </Celebration>
    </div>
  );
}

/** The topics of the cards whose `related:` names `problemId`, with how many; loaded with the deck, after the solve. */
function useRelatedTopics(problemId: string): { topic: Topic; count: number }[] {
  const [topics, setTopics] = useState<{ topic: Topic; count: number }[]>([]);
  useEffect(() => {
    let cancelled = false;
    import('virtual:practice-cards').then(
      ({ default: deck }) => {
        if (cancelled) return;
        const related = deck.cards.filter((c) => !c.retired && c.related.includes(problemId));
        setTopics(
          deck.topics.map((topic) => ({ topic, count: related.filter((c) => c.topic === topic.id).length })).filter((t) => t.count > 0),
        );
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [problemId]);
  return topics;
}

/**
 * Signed in: the leaderboard opt-in, unless already on it, and email
 * reminders (profile/EmailReminders.tsx), unless an address is set.
 */
function StayOnTrack({ account }: { account: Account }) {
  const user = account.state.status === 'signed-in' ? account.state.user : undefined;
  // Offered when the card first shows, and kept while the switch is used.
  const [offerBoard] = useState(() => user?.publicProfile === false);
  const [prefs, setPrefs] = useState<EmailPrefs>();
  useEffect(() => {
    let cancelled = false;
    api<EmailPrefs>('/api/me/email').then(
      (p) => !cancelled && setPrefs(p),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);
  // Asked once: an address set while this card shows keeps the form, with its confirmation notice.
  const [offerEmail, setOfferEmail] = useState(false);
  if (!offerEmail && prefs?.email === null) setOfferEmail(true);
  if (!user || (!offerBoard && !offerEmail)) return null;
  return (
    <div className="mt-4 border-t-bw-1 border-ink/30 pt-3 text-sm">
      {offerBoard && (
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            role="switch"
            checked={user.publicProfile}
            onChange={(e) => void account.update({ publicProfile: e.target.checked })}
            className="mt-0.5 h-5 w-5 flex-shrink-0 accent-ink"
          />
          <span className="font-semibold text-ink">Show me on the leaderboard, with a public profile</span>
        </label>
      )}
      {offerEmail && (
        <details className="mt-2">
          <summary className="cursor-pointer font-semibold text-ink">Keep your streak: remind me when cards are due</summary>
          <EmailReminders />
        </details>
      )}
    </div>
  );
}
