import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, FlaskConical } from 'lucide-react';
import { confirm } from '../../design/dialogs';
import { field, outlineButton, primaryButton } from '../../components/Playground/ui';
import type { Engine } from '../../hld/engine';
import { formatFactor, formatNumber, hashText, parseNumber, seededRandom } from '../../learn/grade';
import Markdown from '../Markdown';
import type { Problem } from '../types';
import { useNow } from '../modes/useNow';
import { redactedStatement, type EstimateQuestion, type Interview } from '../modes/interviewFile';
import { CHECKLIST, remaining, type InterviewAction, type InterviewSession } from '../modes/session';
import { useCodePref, useRailFoldedPref, useSoundPref } from './prefs';
import Room, { ChecksSheet, type RoomTab } from './Room';
import { useClockCues, useCues, usePhaseCue, useWhiteboard } from './useRoom';

/**
 * An interview on your own in the room (P45, the free mode of P25): the same
 * whiteboard, clock and phases, without an interviewer. The rail shows the
 * phase: clarifying questions to pick from, estimates graded against a
 * range, the design's checks, then a self-review. All of it stays in this
 * browser (modes/store.ts).
 */

interface SoloRoomProps {
  problem: Problem;
  engine: Engine;
  phone: boolean;
  interview: Interview;
  session: InterviewSession;
  dispatch: (a: InterviewAction) => void;
  onExit: () => void;
}

export default function SoloRoom({ problem, engine, phone, interview, session, dispatch, onExit }: SoloRoomProps) {
  const board = useWhiteboard(problem, engine);
  const [soundOn, setSound] = useSoundPref();
  const play = useCues(soundOn);
  const [codeShown, setCode] = useCodePref();
  const [folded, setFolded] = useRailFoldedPref();
  const [tab, setTab] = useState<RoomTab>('chat');
  const running = session.runningSince !== undefined;
  const now = useNow(running);
  const left = remaining(session, now);
  const flash = useClockCues(left, running, play);
  const pulse = usePhaseCue(session.phase, play);
  const advance = () => dispatch({ type: 'advance', now: Date.now() });

  const check = () => {
    const result = board.check();
    if (result.blocked) return;
    play(result.solved ? 'pass' : 'fail');
    dispatch({ type: 'tests', passed: result.passed, total: result.results.length, solved: result.solved });
  };
  const finish = async () => {
    if (session.phase !== 'wrapup' && !(await confirm({ title: 'Finish the interview now?', body: 'The clock stops and you get your summary.', confirmLabel: 'Finish' }))) return;
    dispatch({ type: 'finish', now: Date.now() });
  };
  const exit = async () => {
    if (await confirm({ title: 'Leave the interview?', body: 'It is kept in this browser, the clock paused: open it again from Mock interview.', confirmLabel: 'Leave' })) {
      dispatch({ type: 'pause', now: Date.now() });
      onExit();
    }
  };

  const rail = (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3" role="region" aria-label="Interview on your own">
      {session.phase === 'clarify' ? (
        <Clarify problem={problem} interview={interview} session={session} dispatch={dispatch} onNext={advance} />
      ) : session.phase === 'estimate' ? (
        <Estimate statement={problem.statement} interview={interview} session={session} dispatch={dispatch} onNext={advance} />
      ) : session.phase === 'design' ? (
        <Design statement={problem.statement} session={session} onCheck={check} onNext={advance} />
      ) : (
        <WrapUp session={session} dispatch={dispatch} onNext={() => void finish()} />
      )}
    </div>
  );

  return (
    <Room
      problem={problem}
      board={board}
      phone={phone}
      phase={session.phase}
      pulse={pulse}
      clock={{ left, flash, paused: !running, onToggle: () => dispatch({ type: running ? 'pause' : 'resume', now: Date.now() }) }}
      sound={{ on: soundOn, onChange: setSound }}
      code={{ shown: codeShown, onChange: setCode }}
      onCheck={check}
      finish={{ label: 'Finish', loud: session.phase === 'wrapup', onClick: () => void finish() }}
      onExit={() => void exit()}
      rail={{ title: 'Interview', content: rail, folded, onFold: setFolded }}
      checks={board.run && <ChecksSheet run={board.run.result} stale={board.run.source !== board.source} onClose={board.closeRun} />}
      tab={tab}
      onTab={setTab}
    />
  );
}

function PhaseNote({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-sm border-bw-1 border-ink bg-pop-yellow/20 px-3 py-2 text-sm text-ink">
      <p className="font-bold">{title}</p>
      <div className="mt-0.5 space-y-1">{children}</div>
    </div>
  );
}

function StatementCard({ source, title, open }: { source: string; title: string; open?: boolean }) {
  return (
    <details className="rounded-sm border-bw-1 border-ink bg-surface" open={open}>
      <summary className="cursor-pointer px-3 py-2 text-sm font-bold text-ink">{title}</summary>
      <div className="border-t-bw-1 border-ink/30 px-3 py-2">
        <Markdown source={source} />
      </div>
    </details>
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

function Clarify({ problem, interview, session, dispatch, onNext }: { problem: Problem; interview: Interview; session: InterviewSession; dispatch: (a: InterviewAction) => void; onNext: () => void }) {
  const redacted = useMemo(() => redactedStatement(problem.statement), [problem.statement]);
  const order = useMemo(() => questionOrder(problem.id, interview.questions.length), [problem.id, interview.questions.length]);
  const asked = session.asked.map((i) => interview.questions[i]).filter(Boolean);
  return (
    <>
      <PhaseNote title="Clarify">
        <p>The scale and constraints are hidden. Pick the questions you would ask before designing; good ones get an answer.</p>
      </PhaseNote>
      <StatementCard source={redacted} title={`The problem: ${problem.title}`} open />
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
              <li key={i} className="rounded-sm border-bw-1 border-ink/40 bg-surface">
                {wasAsked ? (
                  <div className="space-y-1 px-3 py-2">
                    <p className="text-sm font-semibold text-ink">{q.question}</p>
                    <p className={`flex items-center gap-1 text-xs font-bold ${q.good ? 'text-green-700 dark:text-green-300' : 'text-amber-700 dark:text-amber-300'}`}>
                      {q.good ? <CircleCheck size={14} aria-hidden="true" /> : <CircleAlert size={14} aria-hidden="true" />}
                      {q.good ? 'Good question' : 'Weak question'}
                    </p>
                    <Markdown source={q.answer} />
                  </div>
                ) : (
                  <button type="button" onClick={() => dispatch({ type: 'ask', index: i })} className="w-full px-3 py-2 text-left text-sm text-ink hover:bg-pop-yellow/20">
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
      <PhaseNote title="Estimate">
        <p>
          Back-of-the-envelope numbers before the design. An answer within the accepted range counts; the worked answer follows.{' '}
          <a href="../docs/numbers/" target="_blank" rel="noopener" className="font-semibold underline underline-offset-2">
            Numbers to know
          </a>
        </p>
      </PhaseNote>
      <StatementCard source={statement} title="The full problem, scale and constraints included" />
      <ol className="space-y-3">
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
  return (
    <form onSubmit={check} className="space-y-2 rounded-sm border-bw-1 border-ink/40 bg-surface px-3 py-2">
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
          className={`w-32 ${field}`}
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
            {answer.correct ? `In range: the answer is ${shown}.` : `About ${formatFactor(answer.factor)}× too ${answer.direction === 'high' ? 'high' : 'low'}: the answer is ${shown}.`}
          </p>
          <p className="text-xs text-muted">
            Accepted: {formatNumber(estimate.low)} to {formatNumber(estimate.high)}.
          </p>
          <Markdown source={estimate.solution} />
        </div>
      )}
    </form>
  );
}

function Design({ statement, session, onCheck, onNext }: { statement: string; session: InterviewSession; onCheck: () => void; onNext: () => void }) {
  return (
    <>
      <PhaseNote title="Design">
        <p>Draw the design on the whiteboard: add components, connect them, and add each use case&rsquo;s steps under Flows. Check it against the problem&rsquo;s tests as often as you like; the clock keeps running.</p>
      </PhaseNote>
      <p className="text-sm text-ink">
        {session.tests ? (
          <>
            Last check: <strong>{session.tests.passed}</strong> of {session.tests.total} pass{session.tests.solved ? ', solved' : ''}.
          </>
        ) : (
          'Not checked yet.'
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onCheck} className={outlineButton}>
          <FlaskConical size={14} aria-hidden="true" />
          Check my design
        </button>
        <button type="button" onClick={onNext} className={primaryButton}>
          Wrap up
        </button>
      </div>
      <StatementCard source={statement} title="The full problem" />
    </>
  );
}

function WrapUp({ session, dispatch, onNext }: { session: InterviewSession; dispatch: (a: InterviewAction) => void; onNext: () => void }) {
  return (
    <>
      <PhaseNote title="Wrap-up">
        <p>Interviews end with a review of your own design. Tick what you could explain out loud.</p>
      </PhaseNote>
      <ul className="space-y-2">
        {CHECKLIST.map((c) => (
          <li key={c.id}>
            <label className="flex items-start gap-2 text-sm text-ink">
              <input type="checkbox" className="mt-1 accent-ink" checked={session.checked.includes(c.id)} onChange={(e) => dispatch({ type: 'check', id: c.id, checked: e.target.checked })} />
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
