import { useId, useState, type ReactNode } from 'react';
import { ArrowRight, ChevronDown, Layers, Loader2, Puzzle } from 'lucide-react';
import { eyebrow } from '../../components/Playground/ui';
import { Feature } from '../../components/Feature';
import UpgradeHint from '../../components/UpgradeHint';
import type { NextStep, NextStepKind } from '../../learn/nextSteps';
import NextSteps, { StepList } from '../hub/NextSteps';
import { stepHref } from '../hub/stepHref';
import type { RuleStepsProps } from '../hub/RuleSteps';
import { roadmapHref } from '../roadmap';
import { pickHref, pickTitle, type RoadmapPick } from './api';
import { useRoadmapNext } from './useRoadmapNext';

/**
 * The AI roadmap's picks (docs/design/paid-plans.md P9): the next 3 steps,
 * each a roadmap problem or a card topic's deck with the model's reason,
 * linking to it. On the roadmap (under "More" in "Also today") and under a
 * verdict. Without them (no Pro, no AI on the server, or no picks yet) the
 * roadmap shows the free rule-based steps there instead (hub/RuleSteps.tsx).
 */

/** What the rule-based steps need, as RuleSteps takes it. */
export type RuleStepsData = Omit<RuleStepsProps, 'render'>;

const KIND_LABEL = { problem: 'Problem', cards: 'Cards' } as const;
const KIND_ICON = { problem: Puzzle, cards: Layers } as const;

export function PickList({
  picks,
  problemTitle,
  href = pickHref,
}: {
  picks: RoadmapPick[];
  problemTitle: (id: string) => string | undefined;
  /** Where a pick leads: its roadmap step or card deck by default. */
  href?: (pick: RoadmapPick) => string;
}) {
  return (
    <ol className="space-y-2" data-testid="roadmap-picks">
      {picks.map((p, i) => {
        const Icon = KIND_ICON[p.kind];
        return (
          <li key={`${p.kind}:${p.id}`}>
            <a
              href={href(p)}
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

const textLink = 'font-semibold text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pop-blue rounded-sm';

/**
 * "Also today" on the roadmap, at the foot of its "Up next" card: the
 * rule-based steps, and under "More" the AI picks with the ai_roadmap feature
 * (else the way to Pro where paid plans are on). The steps leave out the
 * problems locked on the roadmap (`steps.exclude`) and a second offer of the
 * one "Up next" offers (`current`; a retry of it stays, with the mistake); a
 * pick still locked there (`locked`) leads to its lesson, which is open.
 */
export default function NextForYou({
  problemTitle,
  base = '../',
  steps,
  locked,
  current,
}: {
  problemTitle: (id: string) => string | undefined;
  base?: string;
  steps?: RuleStepsData;
  locked?: ReadonlySet<string>;
  current?: string;
}) {
  return (
    <Feature
      name="ai_roadmap"
      pro={<Picks problemTitle={problemTitle} steps={steps} locked={locked} current={current} />}
      hint={
        <UpgradeHint base={base} testId="next-for-you-upgrade" icon={false} className={`inline-flex items-center gap-1 ${textLink}`}>
          Upgrade to Pro
          <ArrowRight size={13} aria-hidden="true" />
        </UpgradeHint>
      }
      free={(hint) => (
        <RuleSection
          steps={steps}
          current={current}
          footer={
            hint && (
              <p className="mt-3 text-sm text-ink/80">
                After each mock interview, Pro picks your next 3 steps from the roadmap and the cards, with a reason for each. {hint}
              </p>
            )
          }
        />
      )}
    />
  );
}

/** The steps short enough for the "Also today" line: the day's chores, not problems to pick. */
const LINE_KINDS: ReadonlySet<NextStepKind> = new Set(['retry', 'review', 'challenge']);

const lineLabel = (s: NextStep) => (s.kind === 'challenge' ? 'Daily challenge' : s.kind === 'review' ? s.title.replace(/^Review /, '') : s.title);

/** One line of the day's chores as links, and "More" with every step and its reason; nothing when there is neither. */
function AlsoToday({ line, more }: { line: readonly NextStep[]; more: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (line.length === 0 && !more) return null;
  return (
    <section aria-labelledby={`${id}-h`} className="mt-4 border-t-bw-1 border-ink/25 pt-3" data-testid="next-for-you">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <h3 id={`${id}-h`} className={eyebrow}>
          {line.length > 0 ? 'Also today' : 'Next steps'}
        </h3>
        {line.map((s, i) => (
          <span key={s.key} className="inline-flex items-center gap-2">
            {i > 0 && (
              <span aria-hidden="true" className="text-muted">
                ·
              </span>
            )}
            <a href={stepHref(s)} data-kind={s.kind} title={s.reason} className={textLink}>
              {lineLabel(s)}
            </a>
          </span>
        ))}
        {more && (
          <button type="button" aria-expanded={open} aria-controls={`${id}-more`} onClick={() => setOpen((o) => !o)} className={`ml-auto inline-flex min-h-[32px] items-center gap-1 ${textLink}`}>
            {open ? 'Less' : 'More'}
            <span className="sr-only"> next steps</span>
            <ChevronDown size={14} aria-hidden="true" className={`transition-transform duration-d1 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>
      {more && (
        <div id={`${id}-more`} hidden={!open} className="mt-3">
          {more}
        </div>
      )}
    </section>
  );
}

/** The rule-based steps (loaded lazily: they bundle the deck): the line, and under "More" their list then `footer`. */
function RuleSection({ steps, current, footer }: { steps?: RuleStepsData; current?: string; footer?: ReactNode }) {
  const place = (all: readonly NextStep[]) => {
    const list = all.filter((s) => s.kind === 'retry' || s.problem === undefined || s.problem !== current);
    // "More" only when there is more than the line: then the whole list, with each step's reason.
    const full = list.length > 0 && (footer || list.some((s) => !LINE_KINDS.has(s.kind))) ? <StepList steps={list} /> : null;
    return (
      <AlsoToday
        line={list.filter((s) => LINE_KINDS.has(s.kind))}
        more={
          full || footer ? (
            <>
              {full}
              {footer}
            </>
          ) : null
        }
      />
    );
  };
  return steps ? <NextSteps {...steps} render={place} /> : place([]);
}

/** The picks themselves: shown only with the feature, so they are always asked for. Without picks, the rule-based steps alone. */
function Picks({ problemTitle, steps, locked, current }: { problemTitle: (id: string) => string | undefined; steps?: RuleStepsData; locked?: ReadonlySet<string>; current?: string }) {
  const picks = useRoadmapNext(true);
  // Not known yet, or no AI on the server: the rule-based steps.
  if (picks.status === 'loading' || picks.status === 'off') return <RuleSection steps={steps} current={current} />;
  const next = picks.status === 'ready' ? picks.next : null;
  if (picks.status === 'ready' && !next) {
    return (
      <RuleSection
        steps={steps}
        current={current}
        footer={picks.missed ? <NoNewPicks /> : <p className="mt-3 text-sm text-ink/80">After your next mock interview, your next 3 steps are picked for you here, each with the reason it was picked.</p>}
      />
    );
  }
  return (
    <RuleSection
      steps={steps}
      current={current}
      footer={
        <div className="mt-3">
          {picks.status === 'picking' ? (
            <Picking />
          ) : (
            next && (
              <>
                <p className="text-sm text-ink/80">
                  Picked {next.source === 'interview' ? 'after your last mock interview' : 'after your last in-depth review'}, from the roadmap and the cards.
                </p>
                {picks.status === 'ready' && picks.missed && <NoNewPicks />}
                <div className="mt-3">
                  <PickList picks={next.picks} problemTitle={problemTitle} href={(p) => (p.kind === 'problem' && locked?.has(p.id) ? `${roadmapHref(p.id)}/lesson` : pickHref(p))} />
                </div>
              </>
            )
          )}
        </div>
      }
    />
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
