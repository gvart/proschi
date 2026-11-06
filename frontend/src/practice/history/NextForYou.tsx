import { ArrowRight, Layers, Loader2, Puzzle, Sparkles } from 'lucide-react';
import { eyebrow } from '../../components/Playground/ui';
import { pricingHref } from '../../services/billing';
import type { AiRoadmapAccess } from '../roadmap';
import { pickHref, pickTitle, type RoadmapPick } from './api';
import { useRoadmapNext } from './useRoadmapNext';

/**
 * The AI roadmap's picks (docs/design/paid-plans.md P9): the next 3 steps,
 * each a roadmap problem or a card topic's deck with the model's reason,
 * linking to it. On the roadmap ("Next for you") and under a verdict.
 */

const KIND_LABEL = { problem: 'Problem', cards: 'Cards' } as const;
const KIND_ICON = { problem: Puzzle, cards: Layers } as const;

export function PickList({ picks, problemTitle }: { picks: RoadmapPick[]; problemTitle: (id: string) => string | undefined }) {
  return (
    <ol className="space-y-2" data-testid="roadmap-picks">
      {picks.map((p, i) => {
        const Icon = KIND_ICON[p.kind];
        return (
          <li key={`${p.kind}:${p.id}`}>
            <a
              href={pickHref(p)}
              className="group flex items-start gap-3 rounded-sm border-bw-1 border-ink bg-paper px-3 py-2.5 transition-colors duration-d1 hover:bg-pop-yellow/25 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pop-blue"
            >
              <span className="mt-0.5 font-display text-base font-extrabold tabular-nums text-ink" aria-hidden="true">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-semibold text-ink group-hover:underline">{pickTitle(p, problemTitle)}</span>
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-muted">
                    <Icon size={11} aria-hidden="true" />
                    {KIND_LABEL[p.kind]}
                  </span>
                </span>
                <span className="mt-0.5 block text-sm text-ink/80">{p.reason}</span>
              </span>
              <ArrowRight size={16} className="mt-1 shrink-0 text-ink" aria-hidden="true" />
            </a>
          </li>
        );
      })}
    </ol>
  );
}

const card = 'mt-6 rounded-brutal border-bw-2 border-ink bg-surface p-4 shadow-brutal-md';

/** "Next for you" on the roadmap: the picks for Pro, the way to Pro for other accounts with paid plans on; nothing otherwise, or without the AI (P10). */
export default function NextForYou({ access, problemTitle, base = '../' }: { access: AiRoadmapAccess; problemTitle: (id: string) => string | undefined; base?: string }) {
  const picks = useRoadmapNext(access === 'pro');

  if (access === 'hidden') return null;
  const heading = (
    <h2 id="next-for-you" className={`flex items-center gap-1.5 ${eyebrow}`}>
      <Sparkles size={13} aria-hidden="true" />
      Next for you
    </h2>
  );
  if (access === 'upgrade') {
    return (
      <section aria-labelledby="next-for-you" className={card} data-testid="next-for-you">
        {heading}
        <p className="mt-1 text-sm text-ink/80">After each AI interview, Pro picks your next 3 steps from the roadmap and the cards, with a reason for each.</p>
        <a
          href={pricingHref(base)}
          data-testid="next-for-you-upgrade"
          className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-ink underline decoration-pop-yellow decoration-2 underline-offset-2 hover:decoration-ink"
        >
          Upgrade to Pro
          <ArrowRight size={13} aria-hidden="true" />
        </a>
      </section>
    );
  }
  // Loading, or no AI on the server: the roadmap's own order stands.
  if (picks.status === 'off' || picks.status === 'loading') return null;
  const next = picks.status === 'ready' ? picks.next : null;
  return (
    <section aria-labelledby="next-for-you" className={card} data-testid="next-for-you">
      {heading}
      {picks.status === 'picking' ? (
        <Picking />
      ) : next ? (
        <>
          <p className="mt-1 text-sm text-ink/80">
            Picked {next.source === 'interview' ? 'after your last AI interview' : 'after your last AI review'}, from the roadmap and the cards.
          </p>
          {picks.status === 'ready' && picks.missed && <NoNewPicks />}
          <div className="mt-3">
            <PickList picks={next.picks} problemTitle={problemTitle} />
          </div>
        </>
      ) : picks.status === 'ready' && picks.missed ? (
        <NoNewPicks />
      ) : (
        <p className="mt-1 text-sm text-ink/80">After your next AI interview, your next 3 steps appear here, each with the reason it was picked.</p>
      )}
    </section>
  );
}

/** While the picks for a verdict that just ended are being made. */
export function Picking() {
  return (
    <p role="status" className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted" data-testid="picks-picking">
      <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
      Picking your next steps…
    </p>
  );
}

/** The wait for the newest verdict's picks ended without them: said quietly. */
export function NoNewPicks() {
  return (
    <p className="mt-1 text-sm text-muted" data-testid="picks-missed">
      No new picks this time. Try again later.
    </p>
  );
}
