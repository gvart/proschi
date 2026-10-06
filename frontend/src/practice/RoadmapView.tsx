import { ArrowRight, BookOpen, Lock, LogIn, Map as MapIcon, PartyPopper } from 'lucide-react';
import { DifficultyBadge, StatusIcon } from './Badges';
import type { ProblemListing } from './listing';
import type { Progress } from './progress';
import { OPTIONAL_STEPS, roadmapHref, roadmapState, stepLock, unlockHint, type RoadmapAccess, type RoadmapStage, type RoadmapState, type StepLock } from './roadmap';
import { PROVIDER_LABEL } from './account';
import type { ProviderId } from '../services/api';
import { eyebrow, primaryButton } from '../components/Playground/ui';
import type { Guide } from './guide/guides';

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
  /** Reading minutes of each problem's lesson, by id (problems without one are absent). */
  lessons?: Record<string, number>;
  /** The article to read before the first problem, with its reading minutes. */
  guide?: Guide & { minutes?: number };
  /** A locked step the address asked for (`#/roadmap/<id>` or its lesson): the roadmap shows what unlocks it. */
  locked?: { id: string; lock: StepLock };
}

/** The interview prep roadmap, the hub's first tab: stages of problems, each unlocked once every problem before it is solved. */
export default function Roadmap({ stages, problems, progress, access, providers, onSignIn, lessons = {}, guide, locked }: RoadmapProps) {
  const preview = access !== 'open';
  const state = roadmapState(stages, progress);
  const total = state.steps.length;
  const current = stages[state.currentStage];

  return (
    <main className="max-w-4xl mx-auto px-4 pt-6 pb-8 sm:pb-14">
      <h1 className="mt-3 font-display text-[clamp(2rem,5vw,3rem)] font-extrabold leading-[1.05] tracking-[-0.02em] text-ink">Interview prep roadmap</h1>
      <p className="mt-3 max-w-2xl text-base text-ink/80">
        The problems in the order a system design interview builds on them, from foundations to large systems. Each one opens once you have solved
        every problem before it. The full list stays open if you want to skip ahead.
      </p>

      {locked && <LockedNotice title={titleOf(problems, locked.id)} lock={locked.lock} problems={problems} />}

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

      {guide && (
        <a
          href={`#/roadmap/${guide.id}`}
          className="group mt-8 flex items-start gap-3 rounded-brutal border-bw-2 border-ink bg-pop-lilac/20 p-4 shadow-brutal-md transition-[transform,box-shadow] duration-d1 hover:-translate-x-px hover:-translate-y-px hover:shadow-brutal-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pop-blue"
        >
          <BookOpen size={22} className="mt-0.5 flex-shrink-0 text-ink" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className={`block ${eyebrow}`}>
              Read first{guide.minutes ? ` · ${guide.minutes} min read` : ''}
            </span>
            <span className="mt-0.5 block font-display text-lg font-bold leading-tight text-ink group-hover:underline">{guide.title}</span>
            <span className="mt-1 block text-sm text-ink/80">{guide.summary}</span>
          </span>
          <ArrowRight size={18} className="mt-1 flex-shrink-0 text-ink" aria-hidden="true" />
        </a>
      )}

      <p className="mt-6 max-w-2xl text-sm text-ink/80">
        Each step is a lesson, then a challenge: read the concepts behind the problem, then design it and let the tests and the review check your
        understanding.
      </p>

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
            access={access}
            lessons={lessons}
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
  access,
  lessons,
}: {
  stage: RoadmapStage;
  index: number;
  state: RoadmapState;
  problems: ProblemListing[];
  current: boolean;
  /** Not started (signed out): every problem shows, none opens but the OPTIONAL_STEPS (the tutorial), nor do their lessons. */
  preview: boolean;
  access: RoadmapAccess;
  lessons: Record<string, number>;
}) {
  // A preview shows the problems without the viewer's progress.
  const steps = state.steps
    .filter((s) => s.stage === index)
    .map((s) => (preview ? { ...s, status: 'todo' as const, locked: !(access === 'sign-in' && OPTIONAL_STEPS.includes(s.id)) } : s));
  // The header counts the required problems: an optional step (the tutorial) keeps no stage from completing.
  const required = steps.filter((s) => !s.optional);
  const solved = required.filter((s) => s.status === 'solved').length;
  return (
    <li aria-label={`Stage ${index + 1}: ${stage.title}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-display text-xl font-bold text-ink">
          <span className="tabular-nums text-muted">{index + 1}.</span> {stage.title}
        </h2>
        <span className="text-xs tabular-nums text-muted">{preview ? `${required.length} problems` : `${solved} / ${required.length}`}</span>
        {current && <span className="rounded-full border-bw-1 border-ink bg-pop-yellow px-2 py-0.5 text-xs font-bold text-on-accent">You are here</span>}
      </div>
      <p className="mt-1 max-w-2xl text-sm text-ink/80">{stage.why}</p>
      <ul className="mt-3 divide-y-2 divide-ink overflow-hidden rounded-brutal border-bw-2 border-ink bg-surface shadow-brutal-md">
        {steps.map((step) => {
          const p = problems.find((q) => q.id === step.id);
          const title = p?.title ?? step.id;
          const minutes = lessons[step.id];
          const hint = step.locked ? unlockHint(stepLock(state, step.id, access), (id) => titleOf(problems, id)) : undefined;
          const content = (
            <>
              {step.locked ? <Lock size={16} className="flex-shrink-0 text-ink/40" aria-label="Locked" /> : <StatusIcon status={step.status} />}
              <span className="flex-1 min-w-0">
                <span className={`block font-display text-lg font-bold leading-tight ${step.locked ? 'text-ink/50' : 'text-ink'}`}>
                  {title}
                  {step.optional && <span className="ml-2 align-middle rounded-full border-bw-1 border-ink px-1.5 py-0.5 text-xs font-semibold text-muted">Optional</span>}
                </span>
                {minutes !== undefined && (
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
                    <BookOpen size={12} aria-hidden="true" />
                    <span>Lesson · Challenge</span>
                    <span className="tabular-nums">· {minutes} min read</span>
                  </span>
                )}
                {step.locked && !preview && state.blocker && <span className="block mt-0.5 text-xs text-muted">Solve {titleOf(problems, state.blocker.id)} first</span>}
              </span>
              {p && <DifficultyBadge difficulty={p.difficulty} />}
            </>
          );
          return (
            <li key={step.id}>
              {step.locked ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3.5 bg-paper/60">
                  <div aria-disabled="true" className="flex flex-1 min-w-[12rem] items-center gap-3 cursor-not-allowed">
                    {content}
                  </div>
                  {minutes !== undefined && (
                    // A step's lesson waits for its turn like its challenge (the problem list's lessons stay open).
                    <span
                      role="link"
                      aria-disabled="true"
                      aria-label={`Read the lesson: ${title}, locked`}
                      title={hint ? `Locked: ${hint}` : 'Locked'}
                      className="inline-flex cursor-not-allowed items-center gap-1.5 rounded border-bw-1 border-dashed border-ink/30 px-2.5 py-1 text-xs font-semibold text-ink/50"
                    >
                      <Lock size={12} aria-hidden="true" />
                      Read the lesson
                    </span>
                  )}
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

/** On a locked step's address: why the roadmap shows instead of the step, and what unlocks it. */
function LockedNotice({ title, lock, problems }: { title: string; lock: StepLock; problems: ProblemListing[] }) {
  // While the sign-in is checked, the step may well open: no alarm yet.
  if (lock.kind === 'checking' || lock.kind === 'open') return null;
  return (
    <p role="status" className="mt-6 flex items-start gap-2 rounded-brutal border-bw-2 border-ink bg-pop-yellow/30 p-3 text-sm text-ink shadow-brutal-sm">
      <Lock size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
      <span>
        <strong>{title}</strong> is locked on the roadmap, its lesson and challenge alike.{' '}
        {lock.kind === 'order' ? `Solve ${titleOf(problems, lock.next)} first to open it.` : 'Sign in to start the roadmap; it opens one problem at a time.'}
      </span>
    </p>
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
