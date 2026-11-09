import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Flag, FlaskConical, MessageCircleQuestion } from 'lucide-react';
import { confirm } from '../../design/dialogs';
import { outlineButton, primaryButton } from '../../components/Playground/ui';
import type { Engine } from '../../hld/engine';
import { hashText, seededRandom } from '../../learn/grade';
import Markdown from '../Markdown';
import type { Problem } from '../types';
import { useNow } from '../modes/useNow';
import { redactedStatement, type Interview } from '../modes/interviewFile';
import { CHECKLIST, PHASES, PHASE_SHARE, remaining, totalElapsed, type InterviewAction, type InterviewSession, type Phase } from '../modes/session';
import { useCodePref, useRailFoldedPref, useSoundPref } from './prefs';
import Room, { ChecksSheet, type RoomTab } from './Room';
import { Brief, EstimatesSummary, PinnedBrief, RequirementsCard, StageContext, StageHeading, StartClarifying, Worksheet } from './StageParts';
import { loadBriefRead, loadWorksheet, nextStage, questionRowId, saveBriefRead, saveWorksheet, stageLabel, type WorksheetRow } from './stages';
import { useClockCues, useCues, usePhaseCue, useStageNudge, useWhiteboard } from './useRoom';

/**
 * An interview on your own in the room (P45, the free mode of P25), a screen
 * per stage (P49): the brief typed out, then clarifying questions to pick
 * from as a conversation; the requirements learned and a worksheet whose
 * rows are the problem's estimates, checked against their range; the
 * whiteboard; and the self-review beside it. All of it stays in this browser
 * (modes/store.ts).
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

/** The phase the clock is in, by the suggested shares of the time. */
function clockPhase(session: InterviewSession, now: number): Phase {
  const elapsed = totalElapsed(session, now);
  let end = 0;
  return PHASES.find((p) => elapsed < (end += PHASE_SHARE[p.id] * session.durationMin * 60_000))?.id ?? 'wrapup';
}

export default function SoloRoom({ problem, engine, phone, interview, session, dispatch, onExit }: SoloRoomProps) {
  const board = useWhiteboard(problem, engine);
  const [soundOn, setSound] = useSoundPref();
  const play = useCues(soundOn);
  const [codeShown, setCode] = useCodePref();
  const [folded, setFolded] = useRailFoldedPref();
  const [tab, setTab] = useState<RoomTab>('chat');
  const [viewing, setViewing] = useState<Phase>();
  const running = session.runningSince !== undefined;
  const now = useNow(running);
  const left = remaining(session, now);
  const flash = useClockCues(left, running, play);
  const stage = session.phase;
  const pulse = usePhaseCue(stage, play);
  const key = `${problem.id}.${session.startedAt}`;
  const [briefRead, setBriefRead] = useState(() => loadBriefRead(key));
  const [rows, setRowsState] = useState<WorksheetRow[]>(() => loadWorksheet(key) ?? interview.estimates.map((e, i) => ({ id: questionRowId(i), label: e.question, expression: '', unit: e.unit })));
  const setRows = useCallback(
    (next: WorksheetRow[]) => {
      setRowsState(next);
      saveWorksheet(key, next);
    },
    [key],
  );
  const advance = () => {
    setViewing(undefined);
    setTab('chat');
    dispatch({ type: 'advance', now: Date.now() });
  };
  useStageNudge(clockPhase(session, now), stage, running, advance, play);

  const check = () => {
    const result = board.check();
    if (result.blocked) return;
    play(result.solved ? 'pass' : 'fail');
    dispatch({ type: 'tests', passed: result.passed, total: result.results.length, solved: result.solved });
  };
  const finish = async () => {
    if (stage !== 'wrapup' && !(await confirm({ title: 'Finish the interview now?', body: 'The clock stops and you get your summary.', confirmLabel: 'Finish' }))) return;
    dispatch({ type: 'finish', now: Date.now() });
  };
  const exit = async () => {
    if (await confirm({ title: 'Leave the interview?', body: 'It is kept in this browser, the clock paused: open it again from Mock interview.', confirmLabel: 'Leave' })) {
      dispatch({ type: 'pause', now: Date.now() });
      onExit();
    }
  };

  const redacted = useMemo(() => redactedStatement(problem.statement), [problem.statement]);
  const asked = session.asked.map((i) => interview.questions[i]).filter(Boolean);
  const requirements: ReactNode[] = asked.filter((q) => q.good).map((q) => q.fact ?? q.question);
  const scoring = { questions: interview.estimates, answers: session.estimates, onCheck: (index: number, value: number) => dispatch({ type: 'estimate', index, value, question: interview.estimates[index] }) };
  const testsLine = session.tests ? (
    <>
      Last check: <strong>{session.tests.passed}</strong> of {session.tests.total} pass{session.tests.solved ? ', solved' : ''}.
    </>
  ) : (
    'Not checked yet.'
  );

  let screen: ReactNode;
  if (viewing) {
    screen = (
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="past-stage">
        <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-8 sm:px-6">
          <StageHeading stage={viewing} title={`${stageLabel(viewing)}, as it was`}>
            Read-only. Go back to {stageLabel(stage)} to carry on.
          </StageHeading>
          {viewing === 'clarify' && (
            <>
              <PinnedBrief title={problem.title} source={redacted} defaultOpen />
              <QuestionThread problem={problem} interview={interview} session={session} />
            </>
          )}
          {viewing === 'estimate' && (
            <>
              <RequirementsCard items={requirements} />
              <Worksheet rows={rows} readOnly scoring={{ ...scoring, onCheck: () => {} }} />
            </>
          )}
          {viewing === 'design' && (
            <>
              <EstimatesSummary rows={rows} questions={interview.estimates} />
              <p className="text-sm text-ink">{testsLine}</p>
            </>
          )}
        </div>
      </div>
    );
  } else if (stage === 'clarify') {
    screen = !briefRead ? (
      <div className="min-h-0 flex-1 overflow-y-auto bg-paper">
        <Brief
          title={problem.title}
          source={redacted}
          reveal
          footer={
            <StartClarifying
              note="The scale and the constraints aren't in the brief: pick the questions you'd ask."
              onStart={() => {
                setBriefRead(true);
                saveBriefRead(key);
              }}
            />
          }
        />
      </div>
    ) : (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl space-y-5 px-4 py-6">
          <StageHeading stage="clarify" title="Ask about the requirements">
            Pick the questions you would ask before designing. Good ones get an answer; weak ones say why.
          </StageHeading>
          <PinnedBrief title={problem.title} source={redacted} />
          <QuestionThread problem={problem} interview={interview} session={session} onAsk={(index) => dispatch({ type: 'ask', index })} />
        </div>
      </div>
    );
  } else if (stage === 'estimate') {
    screen = (
      <div className="min-h-0 flex-1 overflow-y-auto lg:flex lg:flex-col">
        <div className="mx-auto grid w-full max-w-6xl gap-5 px-4 py-6 sm:px-6 lg:min-h-[36rem] lg:flex-1 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
          <div className="space-y-4 lg:flex lg:min-h-0 lg:flex-col">
            <StageHeading stage="estimate" title="Back-of-the-envelope numbers">
              An answer within the accepted range counts; the worked answer follows.
            </StageHeading>
            {/* A long list scrolls, so the brief keeps most of the column. */}
            <div className="lg:max-h-[40%] lg:shrink-0 lg:overflow-y-auto">
              <RequirementsCard items={requirements} collapsible={phone} empty="No questions answered: estimate from the brief." />
            </div>
            <PinnedBrief title="Full brief, with scale" source={problem.statement} fill />
          </div>
          <Worksheet rows={rows} onChange={setRows} scoring={scoring} fill />
        </div>
      </div>
    );
  }

  const rail = (
    <div className="flex min-h-0 flex-1 flex-col" role="region" aria-label="Interview on your own">
      <StageContext requirements={requirements} rows={rows} questions={interview.estimates} />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {stage === 'design' ? (
          <>
            <PhaseNote title="Design">
              <p>Draw the design on the whiteboard: add components, connect them, and add each use case&rsquo;s steps under Flows. Check it against the problem&rsquo;s tests as often as you like; the clock keeps running.</p>
            </PhaseNote>
            <p className="text-sm text-ink">{testsLine}</p>
            <button type="button" onClick={check} className={outlineButton}>
              <FlaskConical size={14} aria-hidden="true" />
              Check my design
            </button>
            <PinnedBrief title="The full problem" source={problem.statement} />
          </>
        ) : (
          <>
            <PhaseNote title="Wrap-up">
              <p>Interviews end with a review of your own design. Tick what you could explain out loud; the diagram stays editable.</p>
            </PhaseNote>
            <ul className="space-y-2.5">
              {CHECKLIST.map((c) => (
                <li key={c.id}>
                  <label className="flex items-start gap-2 text-sm leading-relaxed text-ink">
                    <input type="checkbox" className="mt-1 accent-ink" checked={session.checked.includes(c.id)} onChange={(e) => dispatch({ type: 'check', id: c.id, checked: e.target.checked })} />
                    {c.label}
                  </label>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => void finish()} className={primaryButton}>
              <Flag size={14} aria-hidden="true" />
              Finish the interview
            </button>
          </>
        )}
      </div>
    </div>
  );

  const following = nextStage(stage);
  return (
    <Room
      problem={problem}
      board={board}
      phone={phone}
      phase={stage}
      viewing={viewing}
      onView={setViewing}
      next={following ? { label: `Next: ${stageLabel(following)}`, onClick: advance } : undefined}
      screen={screen}
      railWide={stage === 'wrapup'}
      pulse={pulse}
      clock={{ left, flash, paused: !running, onToggle: () => dispatch({ type: running ? 'pause' : 'resume', now: Date.now() }) }}
      sound={{ on: soundOn, onChange: setSound }}
      code={{ shown: codeShown, onChange: setCode }}
      onCheck={check}
      finish={{ label: 'Finish', loud: stage === 'wrapup', onClick: () => void finish() }}
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

/** Clarify on your own as a conversation: the questions asked with their answers, then the ones still to pick (none when read-only). */
function QuestionThread({ problem, interview, session, onAsk }: { problem: Problem; interview: Interview; session: InterviewSession; onAsk?: (index: number) => void }) {
  const order = useMemo(() => questionOrder(problem.id, interview.questions.length), [problem.id, interview.questions.length]);
  const asked = session.asked.map((i) => interview.questions[i]).filter(Boolean);
  const open = order.filter((i) => !session.asked.includes(i));
  return (
    <div className="space-y-4">
      {asked.length > 0 && (
        <ol aria-label="Questions asked" className="space-y-3">
          {session.asked.map((i) => {
            const q = interview.questions[i];
            if (!q) return null;
            return (
              <li key={i} className="space-y-1.5">
                <div className="ml-auto w-fit max-w-[88%] rounded-sm border-bw-1 border-ink bg-pop-yellow/25 px-3 py-2 text-sm text-ink">
                  <p className="mb-0.5 text-xs font-bold text-ink/70">You</p>
                  {q.question}
                </div>
                <div className="max-w-[92%] rounded-sm border-bw-1 border-ink/30 bg-surface px-3 py-2 text-sm text-ink">
                  <p className={`mb-1 flex items-center gap-1 text-xs font-bold ${q.good ? 'text-green-700 dark:text-green-300' : 'text-amber-700 dark:text-amber-300'}`}>
                    {q.good ? <CircleCheck size={13} aria-hidden="true" /> : <CircleAlert size={13} aria-hidden="true" />}
                    {q.good ? 'Good question' : 'Weak question'}
                  </p>
                  <Markdown source={q.answer} />
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {onAsk && (
        <section aria-labelledby="ask-title" className="rounded-sm border-bw-1 border-ink bg-surface shadow-brutal-sm">
          <div className="flex items-baseline gap-2 border-b border-ink/15 px-4 py-2.5">
            <MessageCircleQuestion size={15} aria-hidden="true" className="self-center" />
            <h3 id="ask-title" className="text-sm font-bold text-ink">
              Clarifying questions
            </h3>
            <span className="text-sm text-muted">
              ({asked.length} asked, {asked.filter((q) => q.good).length} good)
            </span>
          </div>
          {open.length ? (
            <ul className="divide-y divide-ink/10">
              {open.map((i) => (
                <li key={i}>
                  <button type="button" onClick={() => onAsk(i)} className="w-full px-4 py-2.5 text-left text-sm text-ink hover:bg-pop-yellow/20">
                    <span className="sr-only">Ask: </span>
                    {interview.questions[i].question}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-3 text-sm text-muted">Every question is asked. Move on to Estimate.</p>
          )}
        </section>
      )}
    </div>
  );
}
