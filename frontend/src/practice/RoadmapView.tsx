import { useId, useState, type ReactNode } from 'react';
import { ArrowRight, BookCheck, BookOpen, Check, ChevronDown, Lock, LogIn, Map as MapIcon, PartyPopper } from 'lucide-react';
import { DifficultyBadge, StatusIcon } from './Badges';
import type { ProblemListing } from './listing';
import { statusOf, type Progress } from './progress';
import { OPTIONAL_STEPS, SIGNED_OUT_STAGES, roadmapHref, roadmapState, upNext, type RoadmapAccess, type RoadmapStage, type RoadmapState, type StepLock, type UpNext } from './roadmap';
import { PROVIDER_LABEL } from './account';
import type { ProviderId } from '../services/api';
import { eyebrow, outlineButton, primaryButton } from '../components/Playground/ui';
import type { Guide } from './guide/guides';

const titleOf = (problems: ProblemListing[], id: string) => problems.find((p) => p.id === id)?.title ?? id;

const textLink = 'font-semibold text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pop-blue rounded-sm';

interface RoadmapProps {
  /** The roadmap with only existing problems (roadmapFor). */
  stages: RoadmapStage[];
  problems: ProblemListing[];
  progress: Progress;
  /** roadmapAccess: anyone sees the stages and works through the first; the stages after it take an account. */
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
  /** The lessons and guides read (progress.ts lessonsRead). */
  read?: readonly string[];
  /** Beside the progress bar: the interview plan's link (plan/InterviewPlan.tsx), in a wrapping flex row. */
  planLink?: ReactNode;
  /** At the foot of "Up next": the day's other steps (history/NextForYou.tsx). */
  alsoToday?: ReactNode;
}

/** "Read", next to a lesson or guide that was read. */
function ReadChip() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border-bw-1 border-ink bg-pass/25 px-1.5 py-px text-[11px] font-bold text-ink">
      <BookCheck size={11} aria-hidden="true" />
      Read
    </span>
  );
}

/**
 * The interview prep roadmap, the hub's first tab: the progress in one line,
 * one "Up next" card with the one thing to do now, then the stages, the
 * current one open and the others one line each. Each problem opens once
 * every problem before it is solved; lessons are always open to read.
 */
export default function Roadmap({ stages, problems, progress, access, providers, onSignIn, lessons = {}, guide, locked, read = [], planLink, alsoToday }: RoadmapProps) {
  const checking = access === 'checking';
  const guest = access === 'sign-in';
  const readSet = new Set(read);
  const state = roadmapState(stages, progress);
  const total = state.steps.length;
  const up = upNext({ state, access, guideId: guide?.id, read, hasLesson: (id) => lessons[id] !== undefined });
  // The stage open by default: where the learner is, else the one holding the locked step the address asked for.
  const lockedStage = locked ? state.steps.find((s) => s.id === locked.id)?.stage : undefined;

  return (
    <main className="max-w-4xl mx-auto px-4 pt-6 pb-8 sm:pb-14">
      <h1 className="mt-3 font-display text-[clamp(2rem,5vw,3rem)] font-extrabold leading-[1.05] tracking-[-0.02em] text-ink">Interview prep roadmap</h1>

      <section aria-label="Your progress" className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {checking ? (
          <p className="font-semibold text-ink">
            {total} problems in {stages.length} stages
          </p>
        ) : (
          <>
            <p className="font-semibold tabular-nums text-ink">
              {state.solved} of {total} solved
            </p>
            <div
              role="progressbar"
              aria-label="Roadmap progress"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={state.solved}
              className="h-3 min-w-[6rem] flex-1 overflow-hidden rounded-full border-bw-1 border-ink bg-paper"
            >
              <div className="h-full bg-pass transition-[width] duration-d2" style={{ width: `${total ? (state.solved / total) * 100 : 0}%` }} />
            </div>
            <p className="tabular-nums text-ink/80">{state.next ? `Stage ${state.currentStage + 1} of ${stages.length}` : 'All stages done'}</p>
          </>
        )}
        {planLink}
      </section>

      {locked && <LockedNotice title={titleOf(problems, locked.id)} lock={locked.lock} problems={problems} />}

      <UpNextCard up={up} stages={stages} problems={problems} progress={progress} lessons={lessons} read={readSet} guide={guide} providers={providers} onSignIn={onSignIn} guest={guest}>
        {!checking && alsoToday}
      </UpNextCard>

      <h2 className="sr-only">Stages</h2>
      <ol className="mt-8 space-y-3">
        {stages.map((stage, i) => (
          <StageSection
            key={stage.id}
            stage={stage}
            previous={stages[i - 1]}
            index={i}
            state={state}
            problems={problems}
            current={!checking && !(guest && i >= SIGNED_OUT_STAGES) && i === state.currentStage && !!state.next}
            preview={checking || (guest && i >= SIGNED_OUT_STAGES)}
            defaultOpen={i === lockedStage}
            access={access}
            lessons={lessons}
            read={readSet}
            guide={i === 0 ? guide : undefined}
          />
        ))}
      </ol>
    </main>
  );
}

/** The one thing to do now (roadmap.ts upNext), with one primary button; the day's other steps at its foot. */
function UpNextCard({
  up,
  stages,
  problems,
  progress,
  lessons,
  read,
  guide,
  providers,
  onSignIn,
  guest,
  children,
}: {
  up: UpNext;
  stages: RoadmapStage[];
  problems: ProblemListing[];
  progress: Progress;
  lessons: Record<string, number>;
  read: ReadonlySet<string>;
  guide?: Guide & { minutes?: number };
  providers: ProviderId[];
  onSignIn: (provider: ProviderId) => void;
  guest: boolean;
  children?: ReactNode;
}) {
  const id = useId();
  const step = up.kind === 'lesson' || up.kind === 'challenge' ? up.next : undefined;
  const problem = step && problems.find((p) => p.id === step.id);
  const label =
    up.kind === 'guide' ? 'Up next · Read first' : step ? `Up next · Stage ${step.stage + 1}: ${stages[step.stage].title}` : up.kind === 'sign-in' ? `Up next · Stage ${up.next.stage + 1}` : 'Up next';
  const title = (text: string) => (
    <p className="mt-1 font-display text-xl font-bold leading-tight text-ink sm:text-2xl" data-testid="up-next-title">
      {text}
    </p>
  );
  const actions = (primary: ReactNode, secondary?: ReactNode) => (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
      {primary}
      {secondary}
    </div>
  );
  return (
    <section aria-labelledby={id} className="mt-6 rounded-brutal border-bw-2 border-ink bg-surface p-4 shadow-brutal-md sm:p-5" data-testid="up-next">
      <h2 id={id} className={eyebrow}>
        {label}
      </h2>

      {up.kind === 'checking' && (
        <p role="status" className="mt-2 text-sm text-muted">
          Checking your sign-in…
        </p>
      )}

      {up.kind === 'guide' && guide && (
        <>
          {title(guide.title)}
          <p className="mt-1 max-w-2xl text-sm text-ink/80">
            {guide.summary}
            {guide.minutes ? ` ${guide.minutes} min read.` : ''}
          </p>
          {actions(
            <a href={`#/roadmap/${guide.id}`} className={primaryButton}>
              Read the guide
              <ArrowRight size={14} aria-hidden="true" />
            </a>,
            up.next && (
              <a href={roadmapHref(up.next.id)} className={`text-sm ${textLink}`}>
                or skip to {titleOf(problems, up.next.id)}
              </a>
            ),
          )}
        </>
      )}

      {step && (
        <>
          {title(problem?.title ?? step.id)}
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink/80">
            {lessons[step.id] !== undefined && (
              <span className="inline-flex items-center gap-1">
                <BookOpen size={14} aria-hidden="true" />
                Lesson {lessons[step.id]} min
              </span>
            )}
            {lessons[step.id] !== undefined && read.has(step.id) && <ReadChip />}
            {problem && <DifficultyBadge difficulty={problem.difficulty} />}
            {step.optional && <span className="rounded-full border-bw-1 border-ink px-1.5 py-0.5 text-xs font-semibold text-muted">Optional</span>}
          </p>
          <p className="mt-2 max-w-2xl text-sm text-ink/80">
            {up.kind === 'lesson'
              ? 'Each step is a lesson, then a challenge: read the concepts behind the problem, then design it and let the tests check your understanding.'
              : 'Design it in the editor; the tests and the review check your understanding.'}
          </p>
          {up.kind === 'lesson'
            ? actions(
                <a href={`${roadmapHref(step.id)}/lesson`} className={primaryButton}>
                  Start the lesson
                  <ArrowRight size={14} aria-hidden="true" />
                </a>,
                <a href={roadmapHref(step.id)} className={`text-sm ${textLink}`}>
                  or skip to the challenge
                </a>,
              )
            : actions(
                <a href={roadmapHref(step.id)} className={primaryButton}>
                  {statusOf(progress, step.id) === 'attempted' ? 'Continue the challenge' : 'Start the challenge'}
                  <ArrowRight size={14} aria-hidden="true" />
                </a>,
              )}
        </>
      )}

      {up.kind === 'sign-in' && (
        <>
          {title(`Sign in to continue with ${stages[up.next.stage].title}`)}
          <p className="mt-1 max-w-2xl text-sm text-ink/80">
            Stage {SIGNED_OUT_STAGES === 1 ? '1' : `1 to ${SIGNED_OUT_STAGES}`} is done. The rest of the roadmap takes an account; the progress you made in this browser comes with you.
          </p>
          {providers.length > 0 ? (
            actions(
              providers.map((p, i) => (
                <button key={p} type="button" onClick={() => onSignIn(p)} className={i === 0 ? primaryButton : outlineButton}>
                  <LogIn size={14} aria-hidden="true" />
                  Sign in with {PROVIDER_LABEL[p]}
                </button>
              )),
            )
          ) : (
            <p className="mt-3 text-sm text-muted">Sign-in is not available right now; try again later.</p>
          )}
        </>
      )}

      {up.kind === 'done' && (
        <>
          <p className="mt-1 inline-flex items-center gap-2 font-display text-xl font-bold leading-tight text-ink sm:text-2xl" data-testid="up-next-title">
            <PartyPopper size={22} aria-hidden="true" />
            Roadmap complete
          </p>
          <p className="mt-1 max-w-2xl text-sm text-ink/80">Every problem is solved. Keep it fresh with the review cards and a mock interview.</p>
        </>
      )}

      {/* Signed out within the first stage: signing in is optional, so it stays a quiet line. */}
      {guest && up.kind !== 'sign-in' && up.kind !== 'checking' && <KeepProgress providers={providers} onSignIn={onSignIn} stages={stages.length} />}

      {children}
    </section>
  );
}

/** Signed out, inside "Up next": the first stage is open, and signing in keeps the progress and opens the rest. */
function KeepProgress({ providers, onSignIn, stages }: { providers: ProviderId[]; onSignIn: (provider: ProviderId) => void; stages: number }) {
  return (
    <p className="mt-4 max-w-2xl text-sm text-ink/80" data-testid="keep-progress">
      Stage 1 is open without an account; your progress stays in this browser.{' '}
      {providers.length > 0 ? (
        <>
          {providers.map((p, i) => (
            <span key={p}>
              {i > 0 && ' or '}
              <button type="button" onClick={() => onSignIn(p)} className={`inline-flex items-center gap-1 ${textLink}`}>
                <LogIn size={13} aria-hidden="true" />
                Sign in with {PROVIDER_LABEL[p]}
              </button>
            </span>
          ))}{' '}
          (optional) to keep it on every device{stages > 1 ? ` and to continue with stages 2 to ${stages}` : ''}.
        </>
      ) : (
        'Sign-in is not available right now; try again later.'
      )}
    </p>
  );
}

function StageSection({
  stage,
  previous,
  index,
  state,
  problems,
  current,
  preview,
  defaultOpen,
  access,
  lessons,
  read,
  guide,
}: {
  stage: RoadmapStage;
  previous?: RoadmapStage;
  index: number;
  state: RoadmapState;
  problems: ProblemListing[];
  current: boolean;
  /** Not open to the viewer (while the sign-in is checked, or signed out past the first stage): every problem shows, none opens but, signed out, the OPTIONAL_STEPS (the tutorial), nor do their lessons. */
  preview: boolean;
  /** Open from the start besides the current stage (it holds the locked step the address asked for). */
  defaultOpen: boolean;
  access: RoadmapAccess;
  lessons: Record<string, number>;
  read: ReadonlySet<string>;
  /** The "Read first" guide, listed in the first stage. */
  guide?: Guide & { minutes?: number };
}) {
  const bodyId = useId();
  // Only the viewer's choice is kept: the default follows the stage (the sign-in check, a solve).
  const [toggled, setToggled] = useState<boolean>();
  const open = toggled ?? (current || defaultOpen);
  // A preview shows the problems without the viewer's progress.
  const steps = state.steps
    .filter((s) => s.stage === index)
    .map((s) => (preview ? { ...s, status: 'todo' as const, locked: !(access === 'sign-in' && OPTIONAL_STEPS.includes(s.id)) } : s));
  // The header counts the required problems: an optional step (the tutorial) keeps no stage from completing.
  const required = steps.filter((s) => !s.optional);
  const solved = required.filter((s) => s.status === 'solved').length;
  const done = !preview && !current && required.length > 0 && solved === required.length;
  const lockedSteps = steps.filter((s) => s.locked);
  const optional = steps.length - required.length;
  // Why the locked problems wait, said once for the stage.
  const lockNote =
    lockedSteps.length === 0 || access === 'checking'
      ? undefined
      : preview
        ? 'Sign in to open this stage. Its lessons are open to read now.'
        : current && state.blocker
          ? `The rest of this stage opens one by one: solve ${titleOf(problems, state.blocker.id)} first. Every lesson is open to read now.`
          : previous && lockedSteps.length === steps.length
            ? `Opens once you finish ${previous.title}. Its lessons are open to read now.`
            : state.blocker && `Solve ${titleOf(problems, state.blocker.id)} first to open the rest. The lessons are open to read now.`;
  const subline = done
    ? undefined
    : preview && access === 'sign-in'
      ? 'Unlocks when you sign in'
      : !current && previous && lockedSteps.length === steps.length && access !== 'checking'
        ? `Unlocks after ${previous.title}`
        : undefined;

  const status = (
    <>
      {current && <span className="rounded-full border-bw-1 border-ink bg-pop-yellow px-2 py-0.5 font-bold text-on-accent">You are here</span>}
      {done ? (
        <span className="inline-flex items-center gap-1 font-semibold text-ink">
          {solved}/{required.length}
          <Check size={14} aria-label="Done" />
        </span>
      ) : preview || (solved === 0 && !current) ? (
        <span className="inline-flex items-center gap-1">
          {required.length} problems{optional > 0 && ` + ${optional} optional`}
          {lockedSteps.length === steps.length && <Lock size={12} aria-label="Locked" />}
        </span>
      ) : (
        <span>
          {solved}/{required.length} solved{optional > 0 && ` + ${optional} optional`}
        </span>
      )}
    </>
  );

  return (
    <li aria-label={`Stage ${index + 1}: ${stage.title}`} className={`rounded-brutal border-bw-2 border-ink bg-surface ${current ? 'shadow-brutal-md' : 'shadow-brutal-sm'}`}>
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setToggled(!open)}
          className="flex min-h-[48px] w-full items-center gap-3 rounded-brutal px-4 py-3 text-left transition-colors duration-d1 hover:bg-pop-yellow/15 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pop-blue"
        >
          <span className="w-5 shrink-0 font-display text-lg font-extrabold tabular-nums text-muted" aria-hidden="true">
            {index + 1}
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block font-display text-lg font-bold leading-tight ${done || current ? 'text-ink' : 'text-ink/70'}`}>{stage.title}</span>
            {subline && <span className="mt-0.5 block text-xs text-muted">{subline}</span>}
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs tabular-nums text-muted sm:hidden">{status}</span>
          </span>
          {/* Beside the title from sm up; under it on a phone, so the title keeps its width. */}
          <span className="hidden shrink-0 items-center justify-end gap-x-2 text-xs tabular-nums text-muted sm:flex">{status}</span>
          <ChevronDown size={18} aria-hidden="true" className={`shrink-0 text-ink transition-transform duration-d1 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
        </button>
      </h3>
      <div id={bodyId} hidden={!open} className="border-t-bw-2 border-ink">
        <p className="px-4 pt-3 max-w-2xl text-sm text-ink/80">{stage.why}</p>
        {lockNote && (
          <p className="mx-4 mt-2 flex items-start gap-1.5 text-sm text-ink">
            <Lock size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{lockNote}</span>
          </p>
        )}
        <ul className="mt-3 divide-y-bw-1 divide-ink/20 border-t-bw-1 border-ink/20">
          {guide && (
            <li>
              <a
                href={`#/roadmap/${guide.id}`}
                className="group flex items-center gap-3 px-4 py-3 transition-colors duration-d1 hover:bg-pop-yellow/25 focus-visible:outline-hidden focus-visible:bg-pop-yellow/25"
              >
                <BookOpen size={16} className="shrink-0 text-ink" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold leading-tight text-ink group-hover:underline">{guide.title}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
                    Read first{guide.minutes ? ` · ${guide.minutes} min read` : ''}
                    {access !== 'checking' && read.has(guide.id) && <ReadChip />}
                  </span>
                </span>
              </a>
            </li>
          )}
          {steps.map((step) => {
            const p = problems.find((q) => q.id === step.id);
            const title = p?.title ?? step.id;
            const minutes = lessons[step.id];
            const lessonRead = !preview && read.has(step.id);
            if (step.locked) {
              return (
                <li key={step.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
                  <span aria-disabled="true" className="flex min-w-[10rem] flex-1 items-center gap-3">
                    <Lock size={14} className="shrink-0 text-ink/40" aria-label="Locked" />
                    <span className="min-w-0 flex-1 font-semibold leading-tight text-ink/60">
                      {title}
                      {step.optional && <span className="ml-2 align-middle rounded-full border-bw-1 border-ink px-1.5 py-0.5 text-xs font-semibold text-muted">Optional</span>}
                    </span>
                  </span>
                  {lessonRead && <ReadChip />}
                  {minutes !== undefined && (
                    // Reading is never gated: a locked step's lesson opens; only its challenge waits for its turn.
                    <a href={`${roadmapHref(step.id)}/lesson`} aria-label={`Read the lesson: ${title}`} className={`inline-flex items-center gap-1 text-xs ${textLink}`}>
                      <BookOpen size={12} aria-hidden="true" />
                      Read the lesson
                    </a>
                  )}
                  {p && <DifficultyBadge difficulty={p.difficulty} />}
                </li>
              );
            }
            return (
              <li key={step.id}>
                <a
                  href={roadmapHref(step.id)}
                  className="group flex items-center gap-3 px-4 py-3 transition-[background-color,box-shadow] duration-d1 hover:bg-pop-yellow/25 hover:shadow-[inset_6px_0_0_rgb(var(--c-ink))] focus-visible:outline-hidden focus-visible:bg-pop-yellow/25 focus-visible:shadow-[inset_6px_0_0_rgb(var(--c-blue))]"
                >
                  <StatusIcon status={step.status} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-lg font-bold leading-tight text-ink group-hover:underline">
                      {title}
                      {step.optional && <span className="ml-2 align-middle rounded-full border-bw-1 border-ink px-1.5 py-0.5 text-xs font-semibold text-muted">Optional</span>}
                    </span>
                    {minutes !== undefined && (
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
                        <BookOpen size={12} aria-hidden="true" />
                        <span className="tabular-nums">Lesson · {minutes} min read</span>
                        {lessonRead && <ReadChip />}
                      </span>
                    )}
                  </span>
                  {p && <DifficultyBadge difficulty={p.difficulty} />}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </li>
  );
}

/** On a locked step's address: why the roadmap shows instead of the step, and what unlocks it. */
function LockedNotice({ title, lock, problems }: { title: string; lock: StepLock; problems: ProblemListing[] }) {
  // While the sign-in is checked, the step may well open: no alarm yet.
  if (lock.kind === 'checking' || lock.kind === 'open') return null;
  return (
    <p role="status" className="mt-6 flex items-start gap-2 rounded-brutal border-bw-2 border-ink bg-pop-yellow/30 p-3 text-sm text-ink shadow-brutal-sm">
      <Lock size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>
        <strong>{title}</strong> is locked on the roadmap; its lesson is open to read.{' '}
        {lock.kind === 'order'
          ? `Solve ${titleOf(problems, lock.next)} first to open it.`
          : 'Sign in to continue past stage 1; the progress you made signed out comes with you.'}
      </span>
    </p>
  );
}

/** On a problem opened from the roadmap: its stage, and once it is solved, the next problem on the roadmap. */
export function RoadmapBanner({ id, stages, problems, progress }: { id: string; stages: RoadmapStage[]; problems: ProblemListing[]; progress: Progress }) {
  const state = roadmapState(stages, progress);
  const step = state.steps.find((s) => s.id === id);
  if (!step) return null;
  const stage = stages[step.stage];
  return (
    // One slim line over the workspace: the step's place on the roadmap, and the next step once solved.
    <div role="region" aria-label="Roadmap" className="flex min-h-8 items-center gap-x-3 border-b-bw-1 border-ink bg-pop-lilac/25 px-3 py-1 text-[13px] text-ink">
      <a href="#/roadmap" className="inline-flex flex-none items-center gap-1.5 font-semibold underline-offset-2 hover:underline">
        <MapIcon size={14} />
        Roadmap
      </a>
      <span className="min-w-0 truncate text-ink/80">
        Stage {step.stage + 1} of {stages.length}: {stage.title} · {state.steps.indexOf(step) + 1} of {state.steps.length}
      </span>
      {step.status === 'solved' &&
        (state.next ? (
          <a href={roadmapHref(state.next.id)} className={`ml-auto min-w-0 max-w-[65%] whitespace-nowrap ${primaryButton} !py-0.5`}>
            <span className="truncate">Next in roadmap: {titleOf(problems, state.next.id)}</span>
            <ArrowRight size={14} className="flex-none" />
          </a>
        ) : (
          <span className="ml-auto inline-flex flex-none items-center gap-1.5 font-semibold">
            <PartyPopper size={14} /> Roadmap complete
          </span>
        ))}
    </div>
  );
}
