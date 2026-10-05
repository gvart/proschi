import { ArrowRight, Lock, LogIn, Map as MapIcon, PartyPopper } from 'lucide-react';
import { DifficultyBadge, StatusIcon } from './Badges';
import type { ProblemListing } from './listing';
import type { Progress } from './progress';
import { roadmapHref, roadmapState, type RoadmapAccess, type RoadmapStage, type RoadmapState } from './roadmap';
import { PROVIDER_LABEL } from './account';
import type { ProviderId } from '../services/api';
import { eyebrow, primaryButton, toolButton } from '../components/Playground/ui';

const titleOf = (problems: ProblemListing[], id: string) => problems.find((p) => p.id === id)?.title ?? id;

interface RoadmapProps {
  /** The roadmap with only existing problems (roadmapFor). */
  stages: RoadmapStage[];
  problems: ProblemListing[];
  progress: Progress;
  /** roadmapAccess: anyone sees the stages; starting them takes an account. */
  access: RoadmapAccess;
  /** The sign-in providers on offer, for `access: 'sign-in'`. */
  providers: ProviderId[];
  onSignIn: (provider: ProviderId) => void;
}

/** The interview prep roadmap: stages of problems, each unlocked once every problem before it is solved. */
export default function Roadmap({ stages, problems, progress, access, providers, onSignIn }: RoadmapProps) {
  const preview = access !== 'open';
  const state = roadmapState(stages, progress);
  const total = state.steps.length;
  const current = stages[state.currentStage];

  return (
    <main className="max-w-4xl mx-auto px-4 py-8 sm:py-14">
      <a href="#/" className={`-ml-2.5 ${toolButton}`}>
        All problems
      </a>
      <h1 className="mt-3 font-display text-[clamp(2rem,5vw,3rem)] font-extrabold leading-[1.05] tracking-[-0.02em] text-ink">Interview prep roadmap</h1>
      <p className="mt-3 max-w-2xl text-base text-ink/80">
        The problems in the order a system design interview builds on them, from foundations to large systems. Each one opens once you have solved
        every problem before it. The full list stays open if you want to skip ahead.
      </p>

      {preview ? (
        <SignInToStart access={access} providers={providers} onSignIn={onSignIn} total={total} stages={stages.length} />
      ) : (
        <section aria-label="Your progress" className="mt-6 rounded-brutal border-bw-2 border-ink bg-surface p-4 shadow-brutal-md">
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-semibold tabular-nums text-ink">
              {state.solved} of {total} solved
            </p>
            {current && (
              <p className="text-sm text-ink/80">
                <span className={eyebrow}>{state.next ? 'Current stage' : 'Last stage'}</span>{' '}
                <span className="font-semibold text-ink">
                  {state.currentStage + 1}. {current.title}
                </span>
              </p>
            )}
            {state.next ? (
              <a href={roadmapHref(state.next.id)} className={`sm:ml-auto ${primaryButton}`}>
                {state.solved === 0 ? 'Start' : 'Continue'}: {titleOf(problems, state.next.id)}
                <ArrowRight size={14} />
              </a>
            ) : (
              total > 0 && (
                <p className="sm:ml-auto inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
                  <PartyPopper size={16} /> Roadmap complete
                </p>
              )
            )}
          </div>
          <div
            role="progressbar"
            aria-label="Roadmap progress"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={state.solved}
            className="mt-3 h-3 overflow-hidden rounded-full border-bw-1 border-ink bg-paper"
          >
            <div className="h-full bg-pass transition-[width] duration-d2" style={{ width: `${total ? (state.solved / total) * 100 : 0}%` }} />
          </div>
        </section>
      )}

      <ol className="mt-8 space-y-8">
        {stages.map((stage, i) => (
          <StageSection
            key={stage.id}
            stage={stage}
            index={i}
            state={state}
            problems={problems}
            current={!preview && i === state.currentStage && !!state.next}
            preview={preview}
          />
        ))}
      </ol>
    </main>
  );
}

function StageSection({
  stage,
  index,
  state,
  problems,
  current,
  preview,
}: {
  stage: RoadmapStage;
  index: number;
  state: RoadmapState;
  problems: ProblemListing[];
  current: boolean;
  /** Not started (signed out): every problem shows, none opens. */
  preview: boolean;
}) {
  // A preview shows the problems without the viewer's progress.
  const steps = state.steps.filter((s) => s.stage === index).map((s) => (preview ? { ...s, status: 'todo' as const, locked: true } : s));
  const solved = steps.filter((s) => s.status === 'solved').length;
  return (
    <li aria-label={`Stage ${index + 1}: ${stage.title}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-display text-xl font-bold text-ink">
          <span className="tabular-nums text-muted">{index + 1}.</span> {stage.title}
        </h2>
        <span className="text-xs tabular-nums text-muted">{preview ? `${steps.length} problems` : `${solved} / ${steps.length}`}</span>
        {current && <span className="rounded-full border-bw-1 border-ink bg-pop-yellow px-2 py-0.5 text-xs font-bold text-on-accent">You are here</span>}
      </div>
      <p className="mt-1 max-w-2xl text-sm text-ink/80">{stage.why}</p>
      <ul className="mt-3 divide-y-2 divide-ink overflow-hidden rounded-brutal border-bw-2 border-ink bg-surface shadow-brutal-md">
        {steps.map((step) => {
          const p = problems.find((q) => q.id === step.id);
          const title = p?.title ?? step.id;
          const content = (
            <>
              {step.locked ? <Lock size={16} className="flex-shrink-0 text-ink/40" aria-label="Locked" /> : <StatusIcon status={step.status} />}
              <span className="flex-1 min-w-0">
                <span className={`block font-display text-lg font-bold leading-tight ${step.locked ? 'text-ink/50' : 'text-ink'}`}>{title}</span>
                {step.locked && !preview && state.next && <span className="block mt-0.5 text-xs text-muted">Solve {titleOf(problems, state.next.id)} first</span>}
              </span>
              {p && <DifficultyBadge difficulty={p.difficulty} />}
            </>
          );
          return (
            <li key={step.id}>
              {step.locked ? (
                <div aria-disabled="true" className="flex items-center gap-3 px-4 py-3.5 cursor-not-allowed bg-paper/60">
                  {content}
                </div>
              ) : (
                <a
                  href={roadmapHref(step.id)}
                  className="group flex items-center gap-3 px-4 py-3.5 transition-[background-color,box-shadow] duration-d1 hover:bg-pop-yellow/25 hover:shadow-[inset_6px_0_0_rgb(var(--c-ink))] focus-visible:outline-none focus-visible:bg-pop-yellow/25 focus-visible:shadow-[inset_6px_0_0_rgb(var(--c-blue))]"
                >
                  {content}
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </li>
  );
}

/** In place of the progress, signed out: what the roadmap holds and the sign-in buttons. */
function SignInToStart({
  access,
  providers,
  onSignIn,
  total,
  stages,
}: {
  access: RoadmapAccess;
  providers: ProviderId[];
  onSignIn: (provider: ProviderId) => void;
  total: number;
  stages: number;
}) {
  return (
    <section aria-label="Start the roadmap" className="mt-6 rounded-brutal border-bw-2 border-ink bg-surface p-4 shadow-brutal-md">
      <p className="font-semibold text-ink">
        {total} problems in {stages} stages
      </p>
      {access === 'checking' ? (
        <p role="status" className="mt-2 text-sm text-muted">
          Checking your sign-in…
        </p>
      ) : (
        <>
          <p className="mt-2 max-w-2xl text-sm text-ink/80">Sign in to start the roadmap. It opens one problem at a time and keeps your place in your account.</p>
          {providers.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {providers.map((p) => (
                <button key={p} type="button" onClick={() => onSignIn(p)} className={primaryButton}>
                  <LogIn size={14} />
                  Sign in with {PROVIDER_LABEL[p]} to start
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">Sign-in is not available right now; try again later.</p>
          )}
        </>
      )}
    </section>
  );
}

/** On a problem opened from the roadmap: its stage, and once it is solved, the next problem on the roadmap. */
export function RoadmapBanner({ id, stages, problems, progress }: { id: string; stages: RoadmapStage[]; problems: ProblemListing[]; progress: Progress }) {
  const state = roadmapState(stages, progress);
  const step = state.steps.find((s) => s.id === id);
  if (!step) return null;
  const stage = stages[step.stage];
  return (
    <div role="region" aria-label="Roadmap" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b-bw-1 border-ink bg-pop-lilac/25 px-3 py-1.5 text-sm text-ink">
      <a href="#/roadmap" className="inline-flex items-center gap-1.5 font-semibold underline-offset-2 hover:underline">
        <MapIcon size={14} />
        Roadmap
      </a>
      <span className="text-ink/80">
        Stage {step.stage + 1} of {stages.length}: {stage.title} · {state.steps.indexOf(step) + 1} of {state.steps.length}
      </span>
      {step.locked && state.next && <span className="text-muted">Locked on the roadmap: solve {titleOf(problems, state.next.id)} first</span>}
      {step.status === 'solved' &&
        (state.next ? (
          <a href={roadmapHref(state.next.id)} className={`sm:ml-auto ${primaryButton} !py-1`}>
            Next in roadmap: {titleOf(problems, state.next.id)}
            <ArrowRight size={14} />
          </a>
        ) : (
          <span className="sm:ml-auto inline-flex items-center gap-1.5 font-semibold">
            <PartyPopper size={14} /> Roadmap complete
          </span>
        ))}
    </div>
  );
}
