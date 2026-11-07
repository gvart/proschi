import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Bot, Keyboard, Mic, Timer, User } from 'lucide-react';
import listings from 'virtual:practice-listings';
import { outlineButton, primaryButton, toolButton } from '../../components/Playground/ui';
import { apiEnabled } from '../../services/api';
import { showsUpgrade, useFeature } from '../../components/featureState';
import { billingEnabled } from '../../services/billing';
import { interviewEstimate } from '../../services/credits';
import { refreshCredits, useCredits, useEstimates } from '../../services/useCredits';
import { useToastClearance } from '../../design/toastClearance';
import { voiceSupported } from '../../voice/recognizer';
import type { Problem } from '../types';
import { DEFAULT_DURATION, DURATIONS, PHASES, PHASE_SHARE, startSession, type Duration } from '../modes/session';
import { loadSession, saveSession } from '../modes/store';
import { giveConsent, listInterviews, saveActive, startError, startInterview, type AiInterview } from '../modes/ai/api';
import { interviewPool, pickProblem } from './pick';
import { loadDone, loadLast, recordStart, saveDesign, useSoundPref, useTalkPref, type Kind } from './prefs';
import { currentStep, nextStep, prevStep, setupSteps, titleOf, type ProblemChoice, type StepId } from './setupSteps';
import { RadioGroup, StepDots, Tag } from './wizard';
import MicCheck from './MicCheck';
import ProblemPicker from './ProblemPicker';
import ProblemStep from './ProblemStep';
import SetupReview, { DeepVerdict, DeepVerdictHint, InterviewCost, type ReviewRow } from './SetupReview';
import './setup.css';

/**
 * Step 1 of the mock interview (docs/design/paid-plans.md P45), as a wizard
 * of one decision per screen, each with a default so Continue (or Enter)
 * runs straight through: who interviews you (the interviewer, or on your own
 * for free), the problem ("Surprise me" by default: a random one not done
 * yet, kept hidden until the room), the length, voice or text with a mic
 * check, then a review with what it costs, the consent line and Start.
 * Browser Back steps back through the screens before it leaves the page.
 */

interface SetupProps {
  /** `?problem=<id>`: the problem page's "Interview mode", or a deep link. */
  preselect?: string;
  /** `?with=mock` (or the older `?interview=mock` on a problem): the interviewer chosen. */
  prefer?: Kind;
  /** The interview has started on `problem`: open the room. */
  onStarted: (problem: string) => void;
}

/** The screen's question and the line under it. */
const QUESTIONS: Record<Exclude<StepId, 'review'>, [string, string]> = {
  who: ['Who interviews you?', 'Practise with an interviewer who talks back, or run the same room on your own.'],
  problem: ['Which problem?', 'In a real interview you don’t know the question in advance, so a surprise is the best practice.'],
  length: ['How long?', 'The clock splits the time across four phases, as an interviewer would.'],
  talk: ['How do you want to talk?', 'You can switch between voice and text in the room at any time.'],
};

const STEP_HEADING = 'setup-step-heading';

export default function Setup({ preselect, prefer, onStarted }: SetupProps) {
  const aiFeature = useFeature('ai_interview');
  const ai = aiFeature.ok && apiEnabled;
  /** The server's sessions: whether it has the interviewer, the problems done, one still open. */
  const [server, setServer] = useState<{ interviews: AiInterview[] } | null>();
  useEffect(() => {
    if (!ai) return;
    let live = true;
    void listInterviews().then((r) => live && setServer(r ?? null));
    return () => {
      live = false;
    };
  }, [ai]);
  const { credits, error: creditsError } = useCredits(ai);
  const canMock = ai && !!server && !!credits;
  /** Still asking whether the interviewer is there. */
  const checking = ai && (server === undefined || (billingEnabled && !!server &&!credits && !creditsError));
  const [kindChoice, setKind] = useState<Kind>(prefer ?? 'mock');
  const kind: Kind = canMock ? kindChoice : 'solo';

  const known = preselect && listings.some((p) => p.id === preselect) ? preselect : undefined;
  const [last] = useState(loadLast);
  const [choice, setChoice] = useState<ProblemChoice>(known ? 'choose' : 'surprise');
  const [chosen, setChosen] = useState<string | undefined>(known);
  const [picking, setPicking] = useState(false);
  const [difficulty, setDifficulty] = useState<Problem['difficulty']>();
  const [topic, setTopic] = useState('');
  const pool = useMemo(() => interviewPool(listings, { difficulty, topic: topic || undefined }), [difficulty, topic]);
  const done = useMemo(() => [...new Set([...(server?.interviews.map((i) => i.problem) ?? []), ...loadDone()])], [server]);

  const [duration, setDuration] = useState<Duration>(last?.minutes ?? DEFAULT_DURATION);
  const [talkPref, setTalk] = useTalkPref();
  const voiceOk = useMemo(() => voiceSupported(true), []);
  const talk = talkPref === 'voice' && voiceOk ? 'voice' : 'text';
  const [soundOn, setSound] = useSoundPref();

  const deepFeature = useFeature('deep_mode');
  const [deepChoice, setDeep] = useState(false);
  const deep = deepFeature.ok && deepChoice;
  const estimates = useEstimates(ai);
  const estimate = interviewEstimate(estimates, duration, deep);
  const [short, setShort] = useState<{ needed: number; balance: number }>();
  const balance = credits?.balance ?? 0;
  const notEnough = kind === 'mock' && (short !== undefined || (credits !== undefined && balance < estimate.min));

  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  /** A start refused because a mock interview is open (409 active_session): resume it, or end it and start this one. */
  const [conflict, setConflict] = useState<{ id: string; problem: string; next: string }>();
  const open = server?.interviews.find((i) => i.status === 'active' || i.status === 'finishing');
  const soloOpen = useMemo(() => listings.map((p) => loadSession(p.id)).find((s) => s && s.finishedAt === undefined), []);

  // The wizard: the screens, the one shown, and whether it was opened from the review (Continue goes back there).
  const steps = setupSteps({ who: ai, kind: checking ? kindChoice : kind });
  const [at, setAt] = useState<StepId>('who');
  const [fromReview, setFromReview] = useState(false);
  const current = currentStep(steps, at);
  const index = steps.indexOf(current);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const go = (to: StepId, edit = false) => {
    moved.current = true;
    setAt(to);
    setFromReview(edit);
    setError(undefined);
    history.pushState({ ...(history.state as object | null), psSetup: to }, '');
  };
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      moved.current = true;
      setAt((e.state as { psSetup?: StepId } | null)?.psSetup ?? 'who');
      setFromReview(false);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  // A new screen: its question takes the focus, so a screen reader reads it and Enter continues.
  useEffect(() => {
    if (!moved.current) return;
    window.scrollTo({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, [current]);
  const bar = useToastClearance();

  const resume = (problem: string, id?: string) => {
    if (id) saveActive(problem, id);
    onStarted(problem);
  };

  const problemFor = (): string | undefined => {
    if (choice === 'choose') return chosen;
    if (choice === 'last') return last?.problem;
    return pickProblem(pool, done, Math.random, last?.problem);
  };

  const begin = (problem: string) => {
    saveDesign(problem, undefined);
    recordStart({ problem, kind, minutes: duration });
    onStarted(problem);
  };

  const startMock = async (problem: string, replace = false) => {
    setStarting(true);
    setError(undefined);
    try {
      giveConsent();
      const { interview } = await startInterview(problem, duration, replace, deep);
      refreshCredits();
      saveActive(problem, interview.id);
      begin(problem);
    } catch (e) {
      const why = startError(e);
      if (why.code === 'active_session') setConflict({ id: why.id, problem: why.problem, next: problem });
      else if (why.code === 'no_credits') {
        setShort({ needed: why.needed, balance: why.balance });
        refreshCredits();
      } else setError(`The interview could not start (${why.message}). Try again in a moment.`);
    } finally {
      setStarting(false);
    }
  };

  const start = () => {
    const problem = problemFor();
    if (!problem) return setError(choice === 'choose' ? 'Choose a problem first.' : 'No problem matches these filters; clear one of them.');
    if (kind === 'solo') {
      saveSession(startSession(problem, duration, Date.now()), problem);
      return begin(problem);
    }
    void startMock(problem);
  };

  const noProblem = current === 'problem' && choice === 'surprise' && pool.length === 0;
  const waiting = current === 'who' && checking && kindChoice === 'mock';
  const proceed = () => {
    if (current === 'review') return start();
    if (noProblem || waiting) return;
    if (current === 'problem' && choice === 'choose' && !chosen) return setPicking(true);
    go(fromReview ? 'review' : nextStep(steps, current));
  };
  /** Enter continues from the question or a chosen card; the review needs a click on Start. */
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || e.defaultPrevented || current === 'review' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement;
    if (t !== heading.current && t.getAttribute('role') !== 'radio') return;
    e.preventDefault();
    proceed();
  };

  const problemSummary = choice === 'surprise' ? 'A surprise, shown in the room' : choice === 'last' && last ? titleOf(last.problem) : chosen ? titleOf(chosen) : 'Not chosen yet';
  const rows: ReviewRow[] = [
    ...(ai ? [{ term: 'Interviewer', value: kind === 'mock' ? 'Mock interview' : 'On your own', step: 'who' as const, change: 'Change the interviewer' }] : []),
    { term: 'Problem', value: problemSummary, step: 'problem', change: 'Change the problem' },
    { term: 'Length', value: `${duration} min`, step: 'length', change: 'Change the length' },
    ...(kind === 'mock' ? [{ term: 'You talk by', value: talk === 'voice' ? 'Voice' : 'Text', step: 'talk' as const, change: 'Change how you talk' }] : []),
  ];

  const body: Record<StepId, () => ReactNode> = {
    who: () => (
      <RadioGroup
        label="Interviewer"
        className="grid gap-3 sm:grid-cols-2"
        value={checking ? kindChoice : kind}
        onChange={setKind}
        options={[
          {
            value: 'mock',
            title: 'Mock interview',
            icon: <Bot size={20} />,
            disabled: !checking && !canMock,
            description: checking ? 'Checking the interviewer…' : canMock ? 'A live interviewer who answers, follows up, coaches you and gives a verdict. Uses credits.' : 'The interviewer can’t be reached right now; on your own still works.',
          },
          { value: 'solo', title: 'On my own', icon: <User size={20} />, tag: <Tag>Free</Tag>, description: 'The same room and clock, no interviewer. Pick questions from a list and check your estimates.' },
        ]}
      />
    ),
    problem: () => (
      <ProblemStep
        choice={choice}
        onChoice={(c) => {
          setChoice(c);
          if (c === 'choose' && !chosen) setPicking(true);
        }}
        chosen={chosen}
        onPick={() => setPicking(true)}
        last={last?.problem}
        difficulty={difficulty}
        onDifficulty={setDifficulty}
        topic={topic}
        onTopic={setTopic}
        pool={pool}
        done={done}
      />
    ),
    length: () => (
      <div className="space-y-6">
        <RadioGroup
          label="Interview length"
          className="grid gap-3 sm:grid-cols-3"
          value={duration}
          onChange={(d) => {
            setDuration(d);
            setShort(undefined);
          }}
          options={DURATIONS.map((d) => ({
            value: d,
            title: `${d} min`,
            description: d === 30 ? 'Brisk: just the essentials.' : d === 45 ? 'Typical: most real interviews.' : 'Room for a deep dive.',
          }))}
        />
        <PhaseSplit minutes={duration} />
      </div>
    ),
    talk: () => (
      <div className="space-y-5">
        <RadioGroup
          label="How you talk"
          className="grid gap-3 sm:grid-cols-2"
          value={talk}
          onChange={setTalk}
          options={[
            { value: 'voice', title: 'Voice', icon: <Mic size={20} />, disabled: !voiceOk, description: voiceOk ? 'Speak your answers hands-free; the interviewer answers out loud.' : 'This browser cannot listen; use text.' },
            { value: 'text', title: 'Text', icon: <Keyboard size={20} />, description: 'Type your answers, as in a chat.' },
          ]}
        />
        {talk === 'voice' && (
          <div className="rounded-sm border-bw-1 border-ink/20 bg-paper/60 px-4 py-3">
            <MicCheck />
          </div>
        )}
      </div>
    ),
    review: () => (
      <SetupReview
        rows={rows}
        onEdit={(s) => go(s, true)}
        soundOn={soundOn}
        onSound={setSound}
        error={error}
        checking={checking}
        mock={
          kind === 'mock'
            ? {
                cost: credits && <InterviewCost estimate={estimate} minutes={duration} balance={balance} short={short} notEnough={notEnough} />,
                deep: deepFeature.ok ? (
                  <DeepVerdict
                    on={deep}
                    onChange={(on) => {
                      setDeep(on);
                      setShort(undefined);
                    }}
                    multiplier={estimates.deepMultiplier}
                  />
                ) : showsUpgrade(deepFeature) ? (
                  <DeepVerdictHint />
                ) : undefined,
              }
            : undefined
        }
      />
    ),
  };

  const [question, lead] =
    current === 'review'
      ? kind === 'mock'
        ? ['Ready to start?', 'Check your set-up. The interviewer joins as soon as you start.']
        : ['Ready when you are', 'Check your set-up. The clock starts as soon as you start.']
      : QUESTIONS[current];
  const back = prevStep(steps, current);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-28 pt-6 sm:pb-16 sm:pt-10">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h1 className="font-display text-xl font-extrabold tracking-tight text-ink sm:text-2xl">Mock interview</h1>
        <StepTrail />
      </div>

      {open && (
        <Banner icon={<Bot size={16} aria-hidden="true" />} testId="open-interview">
          <span className="flex-1">You have a mock interview in progress ({titleOf(open.problem)}).</span>
          <button type="button" onClick={() => resume(open.problem, open.id)} className={primaryButton}>
            Resume it
          </button>
        </Banner>
      )}
      {!open && soloOpen && (
        <Banner icon={<User size={16} aria-hidden="true" />} testId="open-solo">
          <span className="flex-1">You have an interview on your own in progress ({titleOf(soloOpen.problem)}).</span>
          <button type="button" onClick={() => resume(soloOpen.problem)} className={outlineButton}>
            Resume it
          </button>
        </Banner>
      )}

      {conflict ? (
        <section aria-label="Mock interview in progress" className="mt-6 space-y-3 rounded-brutal border-bw-2 border-ink bg-surface p-5 shadow-brutal-md sm:p-8">
          <h2 className="flex items-center gap-2 font-display text-2xl font-extrabold text-ink">
            <Bot size={22} aria-hidden="true" />
            You have a mock interview in progress
          </h2>
          <p className="text-base text-ink">It is on {titleOf(conflict.problem)}. You can have one mock interview at a time.</p>
          <div className="flex flex-wrap gap-2 pt-2">
            <button type="button" autoFocus onClick={() => resume(conflict.problem, conflict.id)} className={primaryButton}>
              Resume it
            </button>
            <button
              type="button"
              disabled={starting}
              onClick={() => {
                const next = conflict.next;
                setConflict(undefined);
                void startMock(next, true);
              }}
              className={`${outlineButton} disabled:opacity-50`}
            >
              End it and start a new one
            </button>
            <button type="button" onClick={() => setConflict(undefined)} className={toolButton}>
              Back
            </button>
          </div>
          <p className="text-xs text-muted">The credits the old interview used are not returned, and it gets no verdict.</p>
        </section>
      ) : apiEnabled && aiFeature.loading ? (
        <p className="mt-10 text-sm text-muted" role="status">
          Checking the interviewer…
        </p>
      ) : (
        <section aria-labelledby={STEP_HEADING} className="mt-6 sm:rounded-brutal sm:border-bw-2 sm:border-ink sm:bg-surface sm:shadow-brutal-md" onKeyDown={onKeyDown} data-testid="interview-setup" data-step={current}>
          <div key={current} className="ps-setup-step pt-2 sm:px-10 sm:pb-8 sm:pt-8">
            <StepDots at={index} of={steps.length} />
            <h2 id={STEP_HEADING} ref={heading} tabIndex={-1} className="mt-3 font-display text-3xl font-extrabold leading-tight tracking-tight text-ink outline-none sm:text-4xl">
              {question}
            </h2>
            <p className="mt-2 max-w-xl text-base text-ink/75">{lead}</p>
            <div className="mt-6 sm:mt-8">{body[current]()}</div>
            {noProblem && (
              <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-300">
                No problem matches these filters; clear one of them.
              </p>
            )}
          </div>
          <div
            ref={bar}
            className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t-bw-2 border-ink bg-paper px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:sticky sm:rounded-b-brutal sm:border-t-bw-1 sm:border-ink/15 sm:bg-surface sm:px-10 sm:py-4"
          >
            {back ? (
              <button type="button" onClick={() => go(back)} className={`${toolButton} !py-2.5`}>
                <ArrowLeft size={16} aria-hidden="true" />
                Back
              </button>
            ) : (
              <span />
            )}
            {current === 'review' ? (
              <button type="button" onClick={start} disabled={starting || notEnough || (kind === 'mock' && !credits)} className={`${primaryButton} !px-5 !py-2.5 text-base disabled:opacity-50`}>
                {kind === 'mock' ? <Bot size={17} aria-hidden="true" /> : <Timer size={17} aria-hidden="true" />}
                {starting ? 'Starting…' : kind === 'mock' ? 'Start the mock interview' : 'Start the interview'}
              </button>
            ) : (
              <span className="flex items-center gap-3">
                <span className="hidden text-xs text-muted sm:inline" aria-hidden="true">
                  or press Enter
                </span>
                <button type="button" onClick={proceed} disabled={noProblem || waiting} className={`${primaryButton} !px-5 !py-2.5 text-base disabled:opacity-50`}>
                  {waiting ? 'Checking…' : fromReview ? 'Back to review' : 'Continue'}
                  <ArrowRight size={17} aria-hidden="true" />
                </button>
              </span>
            )}
          </div>
        </section>
      )}
      {picking && (
        <ProblemPicker
          problems={listings}
          done={done}
          chosen={chosen}
          onPick={(id) => {
            setChosen(id);
            setChoice('choose');
            setPicking(false);
          }}
          onClose={() => {
            setPicking(false);
            if (!chosen) setChoice('surprise');
          }}
        />
      )}
    </main>
  );
}

/** How the length splits across the phases: a quiet bar under the length cards. */
function PhaseSplit({ minutes }: { minutes: number }) {
  return (
    <div>
      <p className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-muted">How {minutes} minutes split</p>
      <ol aria-label="Time per phase" className="flex overflow-hidden rounded-sm border-bw-1 border-ink/30">
        {PHASES.map((p, i) => (
          <li key={p.id} style={{ flexGrow: PHASE_SHARE[p.id] }} className={`min-w-0 basis-0 px-2 py-1.5 text-xs ${i > 0 ? 'border-l-bw-1 border-ink/30' : ''} ${i % 2 ? 'bg-paper/60' : 'bg-surface'}`}>
            <span className="block truncate font-semibold text-ink">{p.label}</span>
            <span className="block text-muted">{Math.round(minutes * PHASE_SHARE[p.id])} min</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Where the set-up sits in the three steps. */
export function StepTrail({ at = 0 }: { at?: 0 | 1 | 2 }) {
  return (
    <ol aria-label="Steps" className="flex items-center gap-2 text-xs font-semibold text-muted">
      {['Set up', 'Interview', 'Result'].map((label, i) => (
        <li key={label} aria-current={i === at ? 'step' : undefined} className="flex items-center gap-2">
          {i > 0 && <span aria-hidden="true" className="h-px w-6 bg-ink/25" />}
          <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full border-bw-1 font-mono text-[11px] ${i === at ? 'border-ink bg-pop-yellow text-on-accent' : i < at ? 'border-ink bg-ink text-paper' : 'border-ink/30'}`}>{i + 1}</span>
          <span className={i === at ? 'text-ink' : ''}>{label}</span>
        </li>
      ))}
    </ol>
  );
}

function Banner({ icon, testId, children }: { icon: ReactNode; testId: string; children: ReactNode }) {
  return (
    <div role="status" data-testid={testId} className="mt-5 flex flex-wrap items-center gap-3 rounded-sm border-bw-1 border-ink bg-pop-blue/15 px-3 py-2 text-sm text-ink">
      {icon}
      {children}
    </div>
  );
}
