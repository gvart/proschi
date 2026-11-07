import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Bot, CircleAlert, CircleCheck, CreditCard, Flag, Pause, Play, ShieldCheck, Sparkles, Timer, X } from 'lucide-react';
import Markdown from '../Markdown';
import { confirm } from '../../design/dialogs';
import { useNow } from './useNow';
import { formatFactor, formatNumber, hashText, parseNumber, seededRandom } from '../../learn/grade';
import { eyebrow, field, outlineButton, primaryButton, toolButton } from '../../components/Playground/ui';
import { redactedStatement, type EstimateQuestion, type Interview } from './interviewFile';
import { apiEnabled } from '../../services/api';
import { showsUpgrade, useFeature } from '../../components/featureState';
import UpgradeHint from '../../components/UpgradeHint';
import AiInterviewPanel from './ai/AiInterviewPanel';
import { giveConsent, hasConsent, listInterviews, loadActive, saveActive, startError, startInterview } from './ai/api';
import { billingEnabled, checkout, PRICES } from '../../services/billing';
import { formatCredits, formatRange, interviewEstimate, type Range } from '../../services/credits';
import { refreshCredits, useCredits, useEstimates } from '../../services/useCredits';
import {
  CHECKLIST,
  DEFAULT_DURATION,
  DURATIONS,
  PHASES,
  PHASE_SHARE,
  formatClock,
  remaining,
  summarize,
  type Duration,
  type InterviewAction,
  type InterviewSession,
  type InterviewSummary,
  type Phase,
} from './session';

/** The clock in the header: the phase and the time left, a button to pause or resume. Visible on every pane. */
export function InterviewClock({ session, dispatch }: { session: InterviewSession; dispatch: (a: InterviewAction) => void }) {
  const running = session.runningSince !== undefined;
  const now = useNow(running);
  const left = remaining(session, now);
  const phase = PHASES.find((p) => p.id === session.phase)!.label;
  if (session.finishedAt !== undefined) return null;
  return (
    <button
      type="button"
      onClick={() => dispatch({ type: running ? 'pause' : 'resume', now: Date.now() })}
      className={`${toolButton} font-mono tabular-nums ${left < 0 ? 'text-red-700 dark:text-red-300' : ''}`}
      aria-label={`${phase}, ${formatClock(left)} left. ${running ? 'Pause' : 'Resume'} the interview clock`}
      title={running ? 'Pause the clock' : 'Resume the clock'}
    >
      {running ? <Timer size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
      <span className="hidden sm:inline font-sans">{phase}</span>
      {formatClock(left)}
    </button>
  );
}

interface InterviewPanelProps {
  problemId: string;
  statement: string;
  interview: Interview;
  session?: InterviewSession;
  dispatch: (a: InterviewAction) => void;
  onStart: (duration: Duration) => void;
  /** Leaves interview mode (the session is dropped). */
  onExit: () => void;
  /** Starts over: back to the start screen. */
  onRestart: () => void;
  /** The full statement with hints and the reference solution, shown from the design phase on. */
  children: ReactNode;
  /** The editor's source now, for the AI interviewer's "Send my design". */
  getSource?: () => string;
  /** The start screen opens with the mock interview chosen, when it is on offer (practice/#/<id>?interview=mock). */
  preferAi?: boolean;
  /** Brings the interview into view (on phones, its tab). */
  onShow?: () => void;
}

/** Interview mode in the left column: the start screen, then one phase at a time, or the AI interviewer's chat. */
export default function InterviewPanel({ problemId, statement, interview, session, dispatch, onStart, onExit, onRestart, children, getSource, preferAi = false, onShow }: InterviewPanelProps) {
  // The AI interviewer is on offer with the ai_interview feature (signed in) when the server has it.
  const aiInterview = useFeature('ai_interview');
  const [aiId, setAiId] = useState(() => (apiEnabled ? loadActive(problemId) : undefined));
  const redacted = useMemo(() => redactedStatement(statement), [statement]);
  const setAi = (id: string | undefined) => {
    saveActive(problemId, id);
    setAiId(id);
  };
  if (aiId && getSource) {
    return (
      <AiInterviewPanel
        key={aiId}
        id={aiId}
        statement={redacted}
        getSource={getSource}
        onShow={onShow}
        onRestart={() => setAi(undefined)}
        onExit={() => {
          setAi(undefined);
          onExit();
        }}
      />
    );
  }
  if (!session) return <StartScreen problemId={problemId} onStart={onStart} onStartAi={setAi} onCancel={onExit} ai={aiInterview.ok && apiEnabled && !!getSource} preferAi={preferAi} />;
  const advance = () => dispatch({ type: 'advance', now: Date.now() });
  return (
    <section aria-label="Interview mode" className="flex flex-col">
      <PhaseBar session={session} dispatch={dispatch} onExit={onExit} />
      <div className="px-4 py-4 space-y-5">
        {session.finishedAt !== undefined ? (
          <Summary summary={summarize(session, interview, session.finishedAt ?? session.startedAt)} onRestart={onRestart} onExit={onExit} />
        ) : session.phase === 'clarify' ? (
          <Clarify problemId={problemId} statement={statement} interview={interview} session={session} dispatch={dispatch} onNext={advance} />
        ) : session.phase === 'estimate' ? (
          <Estimate statement={statement} interview={interview} session={session} dispatch={dispatch} onNext={advance} />
        ) : session.phase === 'design' ? (
          <Design session={session} onNext={advance}>
            {children}
          </Design>
        ) : (
          <WrapUp session={session} dispatch={dispatch} onNext={advance} />
        )}
      </div>
    </section>
  );
}

type Kind = 'scripted' | 'ai';

function StartScreen({
  problemId,
  onStart,
  onStartAi,
  onCancel,
  ai,
  preferAi,
}: {
  problemId: string;
  onStart: (d: Duration) => void;
  onStartAi: (id: string) => void;
  onCancel: () => void;
  ai: boolean;
  preferAi: boolean;
}) {
  const [duration, setDuration] = useState<Duration>(DEFAULT_DURATION);
  const [kind, setKind] = useState<Kind>(preferAi ? 'ai' : 'scripted');
  /** Whether the server has the interviewer; undefined until known. */
  const [available, setAvailable] = useState<boolean>();
  const { credits } = useCredits(ai);
  /** Deep (Max, P31): a stronger model writes the verdict; the server checks the plan again. */
  const deepFeature = useFeature('deep_mode');
  const [deepChoice, setDeep] = useState(false);
  const deep = deepFeature.ok && deepChoice;
  const estimates = useEstimates(ai);
  const estimate = interviewEstimate(estimates, duration, deep);
  /** A start the server refused for want of credits (402 no_credits). */
  const [short, setShort] = useState<{ needed: number; balance: number }>();
  const [consenting, setConsenting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<ReactNode>();
  useEffect(() => {
    if (!ai) return;
    let live = true;
    void listInterviews().then((r) => live && setAvailable(r !== undefined));
    return () => {
      live = false;
    };
  }, [ai]);
  const chosen: Kind = ai && available && credits ? kind : 'scripted';
  const balance = credits?.balance ?? 0;
  /** Not enough for the shortest likely interview of this length. */
  const notEnough = short !== undefined || (credits !== undefined && balance < estimate.min);

  /** An AI interview still open (409 active_session): resume it, or end it and start this one. */
  const [open, setOpen] = useState<{ id: string; problem: string }>();

  const startAi = async (replace = false) => {
    setStarting(true);
    setError(undefined);
    try {
      const { interview } = await startInterview(problemId, duration, replace, deep);
      refreshCredits();
      onStartAi(interview.id);
    } catch (e) {
      const why = startError(e);
      if (why.code === 'active_session') setOpen({ id: why.id, problem: why.problem });
      else if (why.code === 'no_credits') {
        setShort({ needed: why.needed, balance: why.balance });
        refreshCredits();
      } else setError(`The interview could not start (${why.message}). Try again in a moment.`);
      setConsenting(false);
    } finally {
      setStarting(false);
    }
  };
  const start = () => {
    if (chosen === 'scripted') return onStart(duration);
    if (!hasConsent()) return setConsenting(true);
    void startAi();
  };
  const resume = (session: { id: string; problem: string }) => {
    if (session.problem === problemId) return onStartAi(session.id);
    // On another problem: its page opens the interview (InterviewPanel reads the stored id).
    saveActive(session.problem, session.id);
    window.location.hash = `#/${session.problem}`;
  };

  if (open) {
    return (
      <section aria-label="Mock interview in progress" className="px-4 py-4 space-y-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink">
          <Bot size={18} aria-hidden="true" />
          You have a mock interview in progress
        </h2>
        <p className="text-sm text-ink">{open.problem === problemId ? 'It is on this problem.' : `It is on another problem (${open.problem}).`} You can have one mock interview at a time.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" autoFocus onClick={() => resume(open)} className={primaryButton}>
            Resume it
          </button>
          <button
            type="button"
            disabled={starting}
            onClick={() => {
              setOpen(undefined);
              void startAi(true);
            }}
            className={`${outlineButton} disabled:opacity-50`}
          >
            End it and start a new one
          </button>
        </div>
        <p className="text-xs text-ink">The credits the old interview used are not returned, and it gets no verdict.</p>
        <button type="button" onClick={() => setOpen(undefined)} className={toolButton}>
          Back
        </button>
      </section>
    );
  }

  if (consenting) {
    return (
      <section aria-label="Mock interview consent" className="px-4 py-4 space-y-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink">
          <ShieldCheck size={18} aria-hidden="true" />
          Before your first mock interview
        </h2>
        <p className="text-sm text-ink">Your interviewer is Claude, an AI model made by Anthropic. To run the interview, Proschi sends Anthropic:</p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink">
          <li>everything you type or dictate in the interview chat (your browser turns dictation into text first),</li>
          <li>the design in the editor each time you press “Send my design”, with its test results,</li>
          <li>the problem, the time and the phase.</li>
        </ul>
        <p className="text-sm text-ink">
          Nothing else about you or your account is sent. Proschi keeps the transcript for 90 days and the verdict for your history; both are in Download my data and are deleted with your account.{' '}
          <a href="../docs/privacy/" target="_blank" rel="noopener" className="font-semibold underline underline-offset-2">
            Privacy
          </a>
        </p>
        {error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={starting}
            onClick={() => {
              giveConsent();
              void startAi();
            }}
            className={`${primaryButton} disabled:opacity-50`}
          >
            <Bot size={14} aria-hidden="true" />
            {starting ? 'Starting…' : 'I agree, start the interview'}
          </button>
          <button type="button" onClick={() => setConsenting(false)} className={toolButton}>
            Back
          </button>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Interview mode" className="px-4 py-4 space-y-4">
      <h2 className="font-display text-lg font-bold text-ink">Interview mode</h2>
      <p className="text-sm text-ink">
        Practise the whole interview against the clock. The statement starts without its scale and constraints: ask clarifying questions to uncover them, estimate the load, design and run the tests, then review your
        design.
      </p>
      {ai && available && credits && (
        <fieldset>
          <legend className={eyebrow}>Interviewer</legend>
          <div className="mt-1 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Interviewer">
            <ModeChoice checked={chosen === 'scripted'} onSelect={() => setKind('scripted')} title="On your own (free)" icon={<Timer size={14} aria-hidden="true" />}>
              Pick questions from a list and check your estimates. Stays in this browser.
            </ModeChoice>
            <ModeChoice checked={chosen === 'ai'} onSelect={() => setKind('ai')} title="Mock interview" icon={<Bot size={14} aria-hidden="true" />}>
              A live interviewer that answers, follows up, coaches you and gives a verdict.
            </ModeChoice>
          </div>
        </fieldset>
      )}
      <fieldset>
        <legend className={eyebrow}>Time</legend>
        <div className="mt-1 flex gap-2" role="radiogroup" aria-label="Interview length">
          {DURATIONS.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={duration === d}
              onClick={() => {
                setDuration(d);
                setShort(undefined);
              }}
              className={`rounded-sm border-bw-1 px-3 py-1.5 text-sm font-semibold ${duration === d ? 'border-ink bg-ink text-paper' : 'border-ink/40 text-ink hover:border-ink'}`}
            >
              {d} min
            </button>
          ))}
        </div>
      </fieldset>
      <ol className="space-y-1 text-sm text-ink">
        {PHASES.map((p, i) => (
          <li key={p.id}>
            <strong>
              {i + 1}. {p.label}
            </strong>{' '}
            <span className="text-muted">about {Math.round(duration * PHASE_SHARE[p.id])} min</span>
          </li>
        ))}
      </ol>
      {chosen === 'ai' && deepFeature.ok && (
        <label data-testid="interview-deep" className={`flex cursor-pointer items-start gap-2.5 rounded-sm border-bw-1 px-3 py-2 text-sm text-ink ${deep ? 'border-ink bg-pop-lilac/25' : 'border-ink/30 hover:border-ink'}`}>
          <input
            type="checkbox"
            checked={deep}
            onChange={(e) => {
              setDeep(e.target.checked);
              setShort(undefined);
            }}
            className="mt-0.5 h-4 w-4 shrink-0 accent-ink"
          />
          <span>
            <span className="flex items-center gap-1.5 font-semibold">
              <Sparkles size={13} aria-hidden="true" />
              Deep verdict
            </span>
            <span className="mt-0.5 block text-xs text-ink/80">
              A stronger model takes longer over your verdict. The interview itself is the same; the verdict costs about {formatCredits(estimates.deepMultiplier)}× as much.
            </span>
          </span>
        </label>
      )}
      {chosen === 'ai' && !deepFeature.ok && showsUpgrade(deepFeature) && (
        <p data-testid="interview-deep-hint" className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
          Want a more thorough verdict? Deep verdicts come with Max.
          <UpgradeHint icon={false}>See Max</UpgradeHint>
        </p>
      )}
      {chosen === 'ai' && credits ? (
        <InterviewCost estimate={estimate} minutes={duration} balance={balance} short={short} notEnough={notEnough} />
      ) : (
        <p className="text-xs text-muted">Your time per phase, questions, estimates and the summary stay in this browser.</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={start} disabled={starting || (chosen === 'ai' && notEnough)} className={`${primaryButton} disabled:opacity-50`}>
          {chosen === 'ai' ? <Bot size={14} aria-hidden="true" /> : <Timer size={14} aria-hidden="true" />}
          {chosen === 'ai' ? (starting ? 'Starting…' : 'Start a mock interview') : 'Start the interview'}
        </button>
        <button type="button" onClick={onCancel} className={toolButton}>
          Cancel
        </button>
      </div>
    </section>
  );
}

function ModeChoice({ checked, onSelect, title, icon, children }: { checked: boolean; onSelect: () => void; title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={`rounded-sm border-bw-1 px-3 py-2 text-left text-sm ${checked ? 'border-ink bg-pop-yellow/30 shadow-brutal-sm' : 'border-ink/40 hover:border-ink'}`}
    >
      <span className="flex items-center gap-1.5 font-semibold text-ink">
        {icon}
        {title}
      </span>
      <span className="mt-0.5 block text-xs text-ink/80">{children}</span>
    </button>
  );
}

/** More interviews: Pro's monthly ones or a pack, for any plan (nothing without paid plans). */
/** What a mock interview of this length is likely to cost against the balance; without enough, the ways to get more. */
function InterviewCost({ estimate, minutes, balance, short, notEnough }: { estimate: Range; minutes: number; balance: number; short?: { needed: number; balance: number }; notEnough: boolean }) {
  const [buying, setBuying] = useState(false);
  const [failed, setFailed] = useState<string>();
  const have = formatCredits(short?.balance ?? balance, { floor: true });
  if (!notEnough) {
    return (
      <div data-testid="ai-credits" className="rounded-sm border-bw-1 border-ink/30 bg-paper px-3 py-2 text-sm text-ink">
        <p>
          <strong className="tabular-nums">{formatRange(estimate)} credits</strong> for {minutes} min; you have <strong className="tabular-nums">{have}</strong>.
        </p>
        <p className="mt-0.5 text-xs text-muted">
          You pay for what the interview uses
          {estimate.worst !== undefined && (
            <span data-testid="ai-credits-cap">, never more than {formatCredits(Math.min(estimate.worst, short?.balance ?? balance), { floor: true })} credits</span>
          )}
          . If you run out, the interviewer moves to the wrap-up and still gives you the verdict.
        </p>
      </div>
    );
  }
  const buy = () => {
    setBuying(true);
    setFailed(undefined);
    checkout('credits_1000').catch((e: unknown) => {
      setBuying(false);
      setFailed(e instanceof Error ? e.message : String(e));
    });
  };
  return (
    <div data-testid="ai-credits" data-enough="false" role="status" className="rounded-sm border-bw-1 border-ink bg-pop-yellow/15 px-3 py-2 text-sm text-ink">
      <p>
        You have <strong className="tabular-nums">{have} credits</strong>. A {minutes}-minute mock interview takes{' '}
        <strong className="tabular-nums">{short?.needed ? `at least ${formatCredits(short.needed)}` : formatRange(estimate)}</strong>.
      </p>
      <p className="mt-0.5 text-xs text-muted">Top-up credits never expire. A plan adds credits every month.</p>
      {failed && (
        <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-300">
          {failed}
        </p>
      )}
      {billingEnabled && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={buy} disabled={buying} className={`${primaryButton} disabled:opacity-50`}>
            <CreditCard size={14} aria-hidden="true" />
            {buying ? 'Opening…' : `Buy ${formatCredits(PRICES.topupCredits)} credits, €${PRICES.topup}`}
          </button>
          <UpgradeHint testId="ai-upgrade" className={outlineButton}>
            See plans
          </UpgradeHint>
        </div>
      )}
    </div>
  );
}

function PhaseBar({ session, dispatch, onExit }: { session: InterviewSession; dispatch: (a: InterviewAction) => void; onExit: () => void }) {
  const running = session.runningSince !== undefined;
  const now = useNow(running);
  const left = remaining(session, now);
  const finished = session.finishedAt !== undefined;
  const index = PHASES.findIndex((p) => p.id === session.phase);
  return (
    <div className="sticky top-0 z-10 border-b-bw-1 border-ink bg-surface px-3 py-2 space-y-2">
      <div className="flex items-center gap-2">
        <span className={eyebrow}>Interview</span>
        {!finished && (
          <span role="timer" aria-label="Time left" className={`font-mono text-base font-bold tabular-nums ${left < 0 ? 'text-red-700 dark:text-red-300' : 'text-ink'}`}>
            {formatClock(left)}
          </span>
        )}
        {!finished && left < 0 && <span className="text-xs font-semibold text-red-700 dark:text-red-300">over time</span>}
        {!finished && (
          <button type="button" onClick={() => dispatch({ type: running ? 'pause' : 'resume', now: Date.now() })} className={toolButton}>
            {running ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
            {running ? 'Pause' : 'Resume'}
          </button>
        )}
        <button
          type="button"
          onClick={async () => (finished || (await confirm({ title: 'Leave interview mode?', body: 'This interview is discarded.', confirmLabel: 'Leave', tone: 'danger' }))) && onExit()}
          className={`ml-auto ${toolButton}`}
          aria-label="Leave interview mode"
          title="Leave interview mode"
        >
          <X size={14} aria-hidden="true" />
          <span className="hidden sm:inline">Exit</span>
        </button>
      </div>
      <ol aria-label="Phases" className="flex gap-1 text-xs font-semibold">
        {PHASES.map((p, i) => (
          <li
            key={p.id}
            aria-current={!finished && i === index ? 'step' : undefined}
            className={`flex-1 rounded-sm border-bw-1 px-1.5 py-0.5 text-center ${!finished && i === index ? 'border-ink bg-pop-yellow text-on-accent' : i < index || finished ? 'border-ink/40 text-ink' : 'border-ink/20 text-muted'}`}
          >
            {i + 1}. {p.label}
          </li>
        ))}
      </ol>
      {!running && !finished && <p className="text-xs text-muted">Paused. The clock stops until you resume.</p>}
    </div>
  );
}

/** The questions in a fixed shuffled order per problem, so good ones are not all first. */
function questionOrder(problemId: string, count: number): number[] {
  const order = Array.from({ length: count }, (_, i) => i);
  const next = seededRandom(hashText(`interview#${problemId}`));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

function Clarify({ problemId, statement, interview, session, dispatch, onNext }: { problemId: string; statement: string; interview: Interview; session: InterviewSession; dispatch: (a: InterviewAction) => void; onNext: () => void }) {
  const redacted = useMemo(() => redactedStatement(statement), [statement]);
  const order = useMemo(() => questionOrder(problemId, interview.questions.length), [problemId, interview.questions.length]);
  const asked = session.asked.map((i) => interview.questions[i]).filter(Boolean);
  return (
    <>
      <p className="rounded-sm border-bw-1 border-ink bg-pop-yellow/25 px-3 py-2 text-sm text-ink">
        <strong>Phase 1: Clarify.</strong> The scale and constraints are hidden. Pick the questions you would ask the interviewer before designing; good ones get an answer.
      </p>
      <Markdown source={redacted} />
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-ink">
          Clarifying questions{' '}
          <span className="font-normal text-muted">
            ({asked.length} asked, {asked.filter((q) => q.good).length} good)
          </span>
        </h3>
        <ul className="space-y-2">
          {order.map((i) => {
            const q = interview.questions[i];
            const wasAsked = session.asked.includes(i);
            return (
              <li key={i} className="rounded-sm border-bw-1 border-ink/40 bg-paper">
                {wasAsked ? (
                  <div className="px-3 py-2 space-y-1">
                    <p className="text-sm font-semibold text-ink">{q.question}</p>
                    <p className={`flex items-center gap-1 text-xs font-bold ${q.good ? 'text-green-700 dark:text-green-300' : 'text-amber-700 dark:text-amber-300'}`}>
                      {q.good ? <CircleCheck size={14} aria-hidden="true" /> : <CircleAlert size={14} aria-hidden="true" />}
                      {q.good ? 'Good question' : 'Weak question'}
                    </p>
                    <Markdown source={q.answer} />
                  </div>
                ) : (
                  <button type="button" onClick={() => dispatch({ type: 'ask', index: i })} className="w-full px-3 py-2 text-left text-sm text-ink hover:bg-surface">
                    <span className="sr-only">Ask: </span>
                    {q.question}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <button type="button" onClick={onNext} className={primaryButton}>
        Reveal the rest
      </button>
    </>
  );
}

function Estimate({ statement, interview, session, dispatch, onNext }: { statement: string; interview: Interview; session: InterviewSession; dispatch: (a: InterviewAction) => void; onNext: () => void }) {
  return (
    <>
      <p className="rounded-sm border-bw-1 border-ink bg-pop-yellow/25 px-3 py-2 text-sm text-ink">
        <strong>Phase 2: Estimate.</strong> Back-of-the-envelope numbers before the design. An answer within the accepted range counts; the worked answer follows.{' '}
        <a href="../docs/numbers/" target="_blank" rel="noopener" className="font-semibold underline underline-offset-2">
          Numbers to know
        </a>
      </p>
      <details className="rounded-sm border-bw-1 border-ink bg-paper">
        <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-ink">The full statement, scale and constraints included</summary>
        <div className="border-t-bw-1 border-ink px-3 py-3">
          <Markdown source={statement} />
        </div>
      </details>
      <ol className="space-y-4">
        {interview.estimates.map((e, i) => (
          <li key={i}>
            <EstimateItem index={i} estimate={e} answer={session.estimates[i]} onAnswer={(value) => dispatch({ type: 'estimate', index: i, value, question: e })} />
          </li>
        ))}
      </ol>
      <button type="button" onClick={onNext} className={primaryButton}>
        Start designing
      </button>
    </>
  );
}

function EstimateItem({ index, estimate, answer, onAnswer }: { index: number; estimate: EstimateQuestion; answer?: InterviewSession['estimates'][number]; onAnswer: (value: number) => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const id = `interview-estimate-${index}`;
  const check = (e: FormEvent) => {
    e.preventDefault();
    const value = parseNumber(text);
    if (value === undefined || !(value > 0)) {
      setError('Enter a number above 0, for example 2300, 2,300, 2.3k or 1e6.');
      return;
    }
    setError(undefined);
    onAnswer(value);
  };
  const shown = `${formatNumber(estimate.answer)} ${estimate.unit}`;
  const range = `${formatNumber(estimate.low)} to ${formatNumber(estimate.high)}`;
  return (
    <form onSubmit={check} className="rounded-sm border-bw-1 border-ink/40 bg-paper px-3 py-2 space-y-2">
      <label htmlFor={id} className="block text-sm font-semibold text-ink">
        {estimate.question}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={id}
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={answer ? String(answer.value) : text}
          onChange={(e) => setText(e.target.value)}
          readOnly={answer !== undefined}
          aria-invalid={error ? true : undefined}
          placeholder="e.g. 2.3k"
          className={`w-36 ${field}`}
        />
        <span className="text-sm text-ink/80">{estimate.unit}</span>
        {!answer && (
          <button type="submit" className={outlineButton}>
            Check
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      {answer && (
        <div className="space-y-1">
          <p className={`flex items-center gap-1 text-sm font-bold ${answer.correct ? 'text-green-700 dark:text-green-300' : 'text-amber-700 dark:text-amber-300'}`}>
            {answer.correct ? <CircleCheck size={14} aria-hidden="true" /> : <CircleAlert size={14} aria-hidden="true" />}
            {answer.correct
              ? `In range: the answer is ${shown}.`
              : `About ${formatFactor(answer.factor)}× too ${answer.direction === 'high' ? 'high' : 'low'}: the answer is ${shown}.`}
          </p>
          <p className="text-xs text-muted">Accepted: {range}.</p>
          <Markdown source={estimate.solution} />
        </div>
      )}
    </form>
  );
}

function Design({ session, onNext, children }: { session: InterviewSession; onNext: () => void; children: ReactNode }) {
  return (
    <>
      <div className="rounded-sm border-bw-1 border-ink bg-pop-yellow/25 px-3 py-2 text-sm text-ink space-y-2">
        <p>
          <strong>Phase 3: Design.</strong> Write the design in the editor and run the tests; the clock keeps running. Wrap up when you are done or the time is nearly out.
        </p>
        <p className="text-xs">
          {session.tests ? (
            <>
              Last run: <strong>{session.tests.passed}</strong> of {session.tests.total} tests passed{session.tests.solved ? ', solved' : ''}.
            </>
          ) : (
            'No test run yet.'
          )}
        </p>
        <button type="button" onClick={onNext} className={outlineButton}>
          <Flag size={14} aria-hidden="true" />
          Wrap up
        </button>
      </div>
      {children}
    </>
  );
}

function WrapUp({ session, dispatch, onNext }: { session: InterviewSession; dispatch: (a: InterviewAction) => void; onNext: () => void }) {
  return (
    <>
      <p className="rounded-sm border-bw-1 border-ink bg-pop-yellow/25 px-3 py-2 text-sm text-ink">
        <strong>Phase 4: Wrap-up.</strong> Interviews end with a review of your own design. Tick what you could explain out loud.
      </p>
      <ul className="space-y-2">
        {CHECKLIST.map((c) => (
          <li key={c.id}>
            <label className="flex items-start gap-2 text-sm text-ink">
              <input type="checkbox" className="mt-1" checked={session.checked.includes(c.id)} onChange={(e) => dispatch({ type: 'check', id: c.id, checked: e.target.checked })} />
              {c.label}
            </label>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onNext} className={primaryButton}>
        Finish the interview
      </button>
    </>
  );
}

function Summary({ summary, onRestart, onExit }: { summary: InterviewSummary; onRestart: () => void; onExit: () => void }) {
  const { questions, estimates, tests, checklist } = summary;
  return (
    <section aria-label="Interview summary" className="space-y-4">
      <h2 className="font-display text-lg font-bold text-ink">Interview summary</h2>
      <table className="w-full text-sm">
        <caption className={`${eyebrow} text-left`}>Time per phase</caption>
        <tbody>
          {PHASES.map((p) => (
            <tr key={p.id} className="border-b border-ink/15">
              <th scope="row" className="py-1 text-left font-normal text-ink">
                {p.label}
              </th>
              <td className="py-1 text-right font-mono tabular-nums">{formatClock(summary.phases[p.id as Phase])}</td>
            </tr>
          ))}
          <tr>
            <th scope="row" className="py-1 text-left font-semibold text-ink">
              Total
            </th>
            <td className={`py-1 text-right font-mono font-semibold tabular-nums ${summary.overtime ? 'text-red-700 dark:text-red-300' : ''}`}>
              {formatClock(summary.totalMs)} / {summary.durationMin}:00
            </td>
          </tr>
        </tbody>
      </table>
      <ul className="space-y-1 text-sm text-ink">
        <li>
          <strong>Questions:</strong> {questions.asked} asked: {questions.good} good (of {questions.goodTotal}), {questions.weak} weak.
        </li>
        <li>
          <strong>Estimates:</strong> {estimates.correct} of {estimates.total} in range
          {estimates.answered < estimates.total ? `, ${estimates.total - estimates.answered} not answered` : ''}.
        </li>
        <li>
          <strong>Tests:</strong> {tests ? `${tests.passed} of ${tests.total} passed${tests.solved ? ', solved' : ''}` : 'not run'}.
        </li>
        <li>
          <strong>Self-review:</strong> {checklist.checked} of {checklist.total} ticked.
        </li>
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onRestart} className={outlineButton}>
          Start again
        </button>
        <button type="button" onClick={onExit} className={toolButton}>
          Leave interview mode
        </button>
      </div>
    </section>
  );
}
