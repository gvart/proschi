import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Flag, Pause, Play, Timer, X } from 'lucide-react';
import Markdown from '../Markdown';
import { useNow } from './useNow';
import { formatFactor, formatNumber, hashText, parseNumber, seededRandom } from '../../learn/grade';
import { eyebrow, field, outlineButton, primaryButton, toolButton } from '../../components/Playground/ui';
import { redactedStatement, type EstimateQuestion, type Interview } from './interviewFile';
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
}

/** Interview mode in the left column: the start screen, then one phase at a time. */
export default function InterviewPanel({ problemId, statement, interview, session, dispatch, onStart, onExit, onRestart, children }: InterviewPanelProps) {
  if (!session) return <StartScreen onStart={onStart} onCancel={onExit} />;
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

function StartScreen({ onStart, onCancel }: { onStart: (d: Duration) => void; onCancel: () => void }) {
  const [duration, setDuration] = useState<Duration>(DEFAULT_DURATION);
  return (
    <section aria-label="Interview mode" className="px-4 py-4 space-y-4">
      <h2 className="font-display text-lg font-bold text-ink">Interview mode</h2>
      <p className="text-sm text-ink">
        Practise the whole interview against the clock. The statement starts without its scale and constraints: ask clarifying questions to uncover them, estimate the load, design and run the tests, then review your
        design.
      </p>
      <fieldset>
        <legend className={eyebrow}>Time</legend>
        <div className="mt-1 flex gap-2" role="radiogroup" aria-label="Interview length">
          {DURATIONS.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={duration === d}
              onClick={() => setDuration(d)}
              className={`rounded border-bw-1 px-3 py-1.5 text-sm font-semibold ${duration === d ? 'border-ink bg-ink text-paper' : 'border-ink/40 text-ink hover:border-ink'}`}
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
      <p className="text-xs text-muted">Your time per phase, questions, estimates and the summary stay in this browser.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => onStart(duration)} className={primaryButton}>
          <Timer size={14} aria-hidden="true" />
          Start the interview
        </button>
        <button type="button" onClick={onCancel} className={toolButton}>
          Cancel
        </button>
      </div>
    </section>
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
          onClick={() => (finished || window.confirm('Leave interview mode? This interview is discarded.')) && onExit()}
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
            className={`flex-1 rounded border-bw-1 px-1.5 py-0.5 text-center ${!finished && i === index ? 'border-ink bg-pop-yellow text-on-accent' : i < index || finished ? 'border-ink/40 text-ink' : 'border-ink/20 text-muted'}`}
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
      <p className="rounded border-bw-1 border-ink bg-pop-yellow/25 px-3 py-2 text-sm text-ink">
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
              <li key={i} className="rounded border-bw-1 border-ink/40 bg-paper">
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
      <p className="rounded border-bw-1 border-ink bg-pop-yellow/25 px-3 py-2 text-sm text-ink">
        <strong>Phase 2: Estimate.</strong> Back-of-the-envelope numbers before the design. An answer within the accepted range counts; the worked answer follows.{' '}
        <a href="../docs/numbers/" target="_blank" rel="noopener" className="font-semibold underline underline-offset-2">
          Numbers to know
        </a>
      </p>
      <details className="rounded border-bw-1 border-ink bg-paper">
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
    <form onSubmit={check} className="rounded border-bw-1 border-ink/40 bg-paper px-3 py-2 space-y-2">
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
      <div className="rounded border-bw-1 border-ink bg-pop-yellow/25 px-3 py-2 text-sm text-ink space-y-2">
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
      <p className="rounded border-bw-1 border-ink bg-pop-yellow/25 px-3 py-2 text-sm text-ink">
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
