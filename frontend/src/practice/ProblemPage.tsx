import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, BookOpen, Code2, Compass, Eye, FlaskConical, GraduationCap, Lightbulb, MoreHorizontal, Network, RotateCcw, Timer } from 'lucide-react';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import type { Diagnostic, SourceLoc } from '../dsl';
import type { Engine } from '../hld/engine';
import CodeEditor, { type CodeEditorHandle } from '../components/Playground/CodeEditor';
import DiagramCanvas from '../components/Diagram/DiagramCanvas';
import { useDiagramLayout } from '../components/Diagram/useDiagramLayout';
import { UseCasePlayer } from '../components/UseCases/UseCasePlayback';
import AnalysisPanel from '../components/Analysis/AnalysisPanel';
import Markdown from './Markdown';
import LessonView from './LessonView';
import LessonHost from './LessonHost';
import TestPanel from './TestPanel';
import ReviewPanel from '../review/ReviewPanel';
import { practiceReviewInput } from '../review/practice';
import { CompanyBadge, DifficultyBadge, StatusIcon } from './Badges';
import { lessonRead, markLessonRead, sourceOf, statusOf, withRun, withSource, type Progress } from './progress';
import { PROBLEM_FILE, parseSolution, runTests, type DesignMetrics, type RunResult } from './workspace';
import { localDay } from '../learn/streak';
import { recordLocalSolve } from './activity';
import { recordRunStats } from './runStats';
import { notifyActivity } from './skills/activity';
import type { Problem } from './types';
import HelpMenu from '../onboarding/HelpMenu';
import { useIsPhone } from '../onboarding/layout';
import Menu, { MenuItem } from '../components/Playground/Menu';
import Header from '../design/Header';
import { startMode, type StartMode } from '../onboarding/seen';
import type { Account } from './useAccount';
import AccountMenu from './AccountMenu';
import CommunityStats from './CommunityStats';
import ProblemBoards from './ProblemBoards';
import { useProblemStats } from './useCommunity';
import { useZenMode } from '../components/Playground/useZenMode';
import { useKeyboardViewport } from '../components/Playground/useKeyboardViewport';
import { ZenButton, ZenCollapse, ZenStatus } from '../components/Playground/Zen';
import EditorZone from '../components/Playground/EditorZone';
import { eyebrow, field, iconButton, outlineButton, subBar, toolButton } from '../components/Playground/ui';
import { parseInterview } from './modes/interviewFile';
import { evaluateChecks, guidedReducer, parseGuided } from './modes/guidedFile';
import { interviewReducer, startSession, summarize, type InterviewAction, type InterviewSession } from './modes/session';
import { appendHistory, loadGuided, loadHistory, loadSession, saveGuided, saveSession, type GuidedState } from './modes/store';
import InterviewPanel, { InterviewClock } from './modes/InterviewPanel';
import GuidedPanel from './modes/GuidedPanel';
import { track } from '../services/metrics';
import './practiceLayout.css';

const PracticeTour = lazy(() => import('../onboarding/PracticeTour'));
// On phones, Help's items join Reset in one "More" menu (MoreMenu).
const HelpMenuItems = lazy(() => import('../onboarding/HelpMenuItems'));
const CheatSheet = lazy(() => import('../onboarding/CheatSheet'));
// Loaded on a problem's first solve, with the related cards.
const SolveCelebration = lazy(() => import('./SolveCelebration'));
// Loaded after a failed run, with the cards of the mistake it matches.
const MistakePanel = lazy(() => import('./MistakePanel'));

const PARSE_DELAY_MS = 150;
/** How long a run shows as running: the tests take milliseconds, and a run with no beat between click and verdict feels like nothing happened. */
const RUN_DELAY_MS = 450;

/** The lesson first, as a page of its own; then the workspace, with the lesson in a drawer. */
type Stage = 'lesson' | 'workspace';

/** The workspace's panes; phones show one at a time, as tabs. */
export type Pane = 'statement' | 'code' | 'diagram' | 'tests';

const PANES: { id: Pane; label: string; icon: typeof BookOpen }[] = [
  { id: 'statement', label: 'Problem', icon: BookOpen },
  { id: 'code', label: 'Code', icon: Code2 },
  { id: 'diagram', label: 'Diagram', icon: Network },
  { id: 'tests', label: 'Tests', icon: FlaskConical },
];

/** The tests' bar (TestPanel's h-11) and the line above it: all that shows of the folded tests. */
const TESTS_BAR_PX = 46;

interface ProblemPageProps {
  problem: Problem;
  progress: Progress;
  onProgress: (update: (p: Progress) => Progress) => void;
  engine: Engine;
  account: Account;
  /** Where the back link goes; the problem list by default. */
  back?: { href: string; label: string };
  /** Shown under the header, e.g. the roadmap's banner. */
  banner?: ReactNode;
  /**
   * Open on the lesson (when the problem has one): `always` (practice/#/<id>/lesson),
   * or `unread` until "Start the challenge" was pressed once (practice/#/<id>, and from the roadmap).
   */
  openLesson?: 'always' | 'unread';
}

/** The stage a problem opens on. */
function initialStage(problem: Problem, openLesson: ProblemPageProps['openLesson']): Stage {
  if (problem.lesson === undefined || !openLesson) return 'workspace';
  return openLesson === 'always' || !lessonRead(problem.id) ? 'lesson' : 'workspace';
}

/**
 * A problem in two stages: its lesson as a page to read, then "Start the
 * challenge" opens the workspace (the statement, the editor and the diagram
 * side by side in resizable panes, the tests folded under them until the
 * first run). The lesson stays a click away, in a drawer. Tabs on phones.
 */
export default function ProblemPage({ problem, progress, onProgress, engine, account, back = { href: '#/', label: 'Problems' }, banner, openLesson }: ProblemPageProps) {
  const [source, setSource] = useState(() => sourceOf(progress, problem));
  const [parsedSource, setParsedSource] = useState(source);
  const [run, setRun] = useState<{ result: RunResult; source: string }>();
  const hasLesson = problem.lesson !== undefined;
  const [stage, setStage] = useState<Stage>(() => initialStage(problem, openLesson));
  const [drawer, setDrawer] = useState(false);
  // A heading to bring into view once the drawer shows (openLessonAt).
  const [lessonTarget, setLessonTarget] = useState<string>();
  const phone = useIsPhone();
  // The pane shown on phones.
  const [pane, setPaneState] = useState<Pane>('statement');
  // Desktop: the tests are folded to their bar until the first run or until unfolded.
  const testsPanel = usePanelRef();
  const [testsOpen, setTestsOpen] = useState(false);
  // Bumped when a splitter is let go, so the diagram fits its new size.
  const [fitTick, setFitTick] = useState(0);
  const refit = useCallback(() => setFitTick((n) => n + 1), []);
  const openTests = useCallback(
    (size = '40%') => {
      const panel = testsPanel.current;
      if (panel?.isCollapsed()) panel.resize(size);
    },
    [testsPanel],
  );
  // Stable, so the tour's steps (which depend on it) are not rebuilt on every render.
  const setPane = useCallback(
    (p: Pane) => {
      setPaneState(p);
      if (p === 'tests') openTests();
    },
    [openTests],
  );
  const startChallenge = () => {
    markLessonRead(problem.id);
    setStage('workspace');
    setDrawer(false);
    // practice/#/<id>/lesson becomes the problem's own address, so a reload opens the challenge.
    if (/\/lesson$/.test(window.location.hash)) {
      try {
        window.history.replaceState(window.history.state, '', window.location.hash.replace(/\/lesson$/, ''));
      } catch {
        // Not allowed (sandboxed): the address keeps /lesson.
      }
    }
  };
  const editorRef = useRef<CodeEditorHandle>(null);
  const lessonScroll = useRef<HTMLDivElement>(null);
  /** Opens the lesson at a heading, e.g. from a mistake's link. */
  const openLessonAt = (id: string) => {
    setDrawer(true);
    setLessonTarget(id);
  };
  useEffect(() => {
    if (!drawer || !lessonTarget) return;
    lessonScroll.current?.querySelector(`[id="${CSS.escape(lessonTarget)}"]`)?.scrollIntoView({ block: 'start' });
    setLessonTarget(undefined);
  }, [drawer, lessonTarget]);
  const zen = useZenMode();
  const keyboard = useKeyboardViewport();
  const status = statusOf(progress, problem.id);
  // Someone who has worked on problems before is not a first-time visitor.
  const [tour, setTour] = useState<StartMode>(() => startMode('practice', { returning: Object.keys(progress).length > 0 }));
  const [tourRun, setTourRun] = useState(0);
  const [runs, setRuns] = useState(0);
  // Bumped once a run is recorded (or, signed out, made), to show and refresh how others did.
  const [statsRefresh, setStatsRefresh] = useState(0);
  const [serverNote, setServerNote] = useState<string>();
  // The first solve on this page of a problem not solved before: what it took, and the progress before it.
  const [firstSolve, setFirstSolve] = useState<{ runs: number; metrics?: DesignMetrics; before: Progress }>();
  const community = useProblemStats(statsRefresh > 0 ? problem.id : undefined, account.state.status === 'signed-in', statsRefresh);

  useEffect(() => track('problem_start', { once: 'session', key: `problem_start:${problem.id}` }), [problem.id]);

  // Interview and guided mode: opt-in, one at a time, remembered in this browser (modes/store.ts).
  const interview = useMemo(() => {
    if (problem.interview === undefined) return undefined;
    const read = parseInterview(problem.interview);
    return read.issues.length === 0 ? read.interview : undefined;
  }, [problem.interview]);
  const guidedSteps = useMemo(() => {
    if (problem.guided === undefined) return undefined;
    const read = parseGuided(problem.guided);
    return read.issues.length === 0 ? read.steps : undefined;
  }, [problem.guided]);
  const [session, setSession] = useState<InterviewSession | undefined>(() => (interview ? loadSession(problem.id) : undefined));
  const [interviewOn, setInterviewOn] = useState(() => session !== undefined);
  const [guidedState, setGuidedState] = useState<GuidedState>(() => (guidedSteps ? loadGuided(problem.id, guidedSteps.length) : { done: [], active: false }));
  const guidedOn = !!guidedSteps && guidedState.active && !interviewOn;
  const dispatchInterview = useCallback((a: InterviewAction) => setSession((s) => s && interviewReducer(s, a)), []);
  useEffect(() => {
    if (!interview) return;
    saveSession(session, problem.id);
    if (session?.finishedAt !== undefined && !loadHistory().some((h) => h.problem === session.problem && h.startedAt === session.startedAt)) {
      appendHistory(summarize(session, interview, session.finishedAt));
    }
  }, [session, interview, problem.id]);
  const updateGuided = useCallback(
    (update: (g: GuidedState) => GuidedState) =>
      setGuidedState((g) => {
        const next = update(g);
        saveGuided(problem.id, next);
        return next;
      }),
    [problem.id],
  );
  const openInterview = () => {
    updateGuided((g) => ({ ...g, active: false }));
    setInterviewOn(true);
    setPane('statement');
  };
  const exitInterview = () => {
    setSession(undefined);
    setInterviewOn(false);
  };
  const openGuided = () => {
    updateGuided((g) => ({ ...g, active: true }));
    setPane('statement');
  };

  // Re-parse and remember the source shortly after typing stops.
  useEffect(() => {
    const timer = setTimeout(() => {
      setParsedSource(source);
      onProgress((p) => withSource(p, problem, source));
    }, PARSE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [source, problem, onProgress]);

  const parsed = useMemo(() => parseSolution(problem, parsedSource), [problem, parsedSource]);
  const { diagram, diagnostics } = parsed;
  const rootDiagnostics = useMemo(() => diagnostics.filter((d) => d.file === undefined), [diagnostics]);
  const nodeIds = useMemo(() => diagram.nodes.map((n) => n.id), [diagram]);
  const { nodes, edges, settled } = useDiagramLayout(diagram);

  const [running, setRunning] = useState(false);
  const runTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(runTimer.current), []);
  const runNow = () => {
    if (running) return;
    setRunning(true);
    setPaneState('tests');
    runTimer.current = setTimeout(() => {
      setRunning(false);
      finishRun();
    }, RUN_DELAY_MS);
  };
  const finishRun = () => {
    // Run on what was in the editor at the click, not the debounced parse.
    const result = runTests(parseSolution(problem, source), engine);
    setRun({ result, source });
    setRuns((n) => n + 1);
    track('test_run');
    const day = localDay();
    if (result.solved && status !== 'solved' && !firstSolve) {
      // Signed in, the server counts the solve once it has verified it (backend/src/progress.ts).
      if (account.state.status !== 'signed-in') track('problem_solve', { once: 'browser', key: `problem_solve:${problem.id}` });
      // Without accounts the streak counts this browser's solves; signed in, the server keeps the day.
      if (account.state.status === 'off') recordLocalSolve(problem.id, day);
      setFirstSolve({ runs: runs + 1, metrics: result.metrics, before: progress });
    }
    if (!result.blocked) {
      if (interviewOn) dispatchInterview({ type: 'tests', passed: result.passed, total: result.results.length, solved: result.solved });
      onProgress((p) => withRun(p, problem, result.solved));
      // For a build without accounts' achievements; the reference solution runs once, on the first solve.
      recordRunStats(problem.id, result, () => runTests(parseSolution(problem, problem.solution), engine).metrics?.costUsd);
      void account.recordRun(problem.id, source, result.solved, day).then((record) => {
        const counted = record?.verdict?.solved ? record.progress.runsToSolve : undefined;
        if (counted !== undefined) setFirstSolve((f) => f && { ...f, runs: counted });
        setServerNote(
          result.solved && record?.verdict && !record.verdict.solved
            ? 'The server did not confirm this solve, so it is not in your stats. Reload the page to get the latest version and run the tests again.'
            : undefined,
        );
        setStatsRefresh((n) => n + 1);
        if (result.solved) notifyActivity();
      });
    }
    setPaneState('tests');
    // Taller while tests fail, so the failures and their fixes have room.
    openTests(result.solved ? '40%' : '50%');
  };

  const startTour = () => {
    setTourRun((n) => n + 1);
    setTour('tour');
  };

  const reset = () => {
    if (window.confirm('Replace your design with the starter code? Your current code is lost.')) setSource(problem.starter);
  };

  const goTo = (loc: SourceLoc | Diagnostic) => {
    if (loc.file !== undefined) return;
    setPane('code');
    editorRef.current?.goTo(loc.line, loc.col);
  };

  const toggleTests = () => {
    const panel = testsPanel.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.resize('40%');
    else panel.collapse();
  };

  const inLesson = hasLesson && stage === 'lesson';
  const lessonButton = (className: string) =>
    hasLesson && (
      <button type="button" onClick={() => setDrawer(true)} aria-haspopup="dialog" aria-expanded={drawer} className={className} title="Open the lesson beside your work">
        <GraduationCap size={15} aria-hidden="true" />
        Lesson
      </button>
    );

  const statement = (
    <div data-tour="statement" className="h-full overflow-y-auto bg-surface">
      {interviewOn && interview ? (
        <InterviewPanel
          problemId={problem.id}
          statement={problem.statement}
          interview={interview}
          session={session}
          dispatch={dispatchInterview}
          onStart={(duration) => setSession(startSession(problem.id, duration, Date.now()))}
          onExit={exitInterview}
          onRestart={() => setSession(undefined)}
        >
          <Statement problem={problem} solved={status === 'solved'} onUseSolution={() => setSource(problem.solution)} />
        </InterviewPanel>
      ) : (
        <>
          {guidedOn && guidedSteps && (
            <GuidedPanel
              steps={guidedSteps}
              progress={guidedState}
              onCheck={(step) =>
                evaluateChecks(guidedSteps[step]?.checks ?? [], parseSolution(problem, source).diagram, () => {
                  const r = runTests(parseSolution(problem, source), engine);
                  return r.blocked ? undefined : r.results;
                })
              }
              onPass={(step) => updateGuided((g) => ({ ...g, ...guidedReducer(g, { type: 'pass', step }, guidedSteps.length) }))}
              onSkip={(step) => updateGuided((g) => ({ ...g, ...guidedReducer(g, { type: 'skip', step }, guidedSteps.length) }))}
              onRestart={() => updateGuided((g) => ({ ...g, done: [] }))}
              onExit={() => updateGuided((g) => ({ ...g, active: false }))}
            />
          )}
          <Statement
            problem={problem}
            solved={status === 'solved'}
            onUseSolution={() => setSource(problem.solution)}
            modes={
              (interview || (guidedSteps && !guidedOn)) && (
                <div className="flex flex-wrap items-center gap-2" aria-label="Practice modes" role="group">
                  {interview && (
                    <button type="button" onClick={openInterview} className={outlineButton} title="Practise the interview: clarify, estimate, design and wrap up against the clock">
                      <Timer size={14} aria-hidden="true" />
                      Interview mode
                    </button>
                  )}
                  {guidedSteps && !guidedOn && (
                    <button type="button" onClick={openGuided} className={outlineButton} title="Build the design step by step, with a check after each step">
                      <Compass size={14} aria-hidden="true" />
                      Guided walkthrough
                    </button>
                  )}
                </div>
              )
            }
          />
        </>
      )}
    </div>
  );

  const editor = (
    <EditorZone data-tour="practice-code" className="h-full min-w-0 flex flex-col">
      <ZenCollapse zen={zen.zen}>
        <div className="px-3 py-1.5 text-xs font-mono text-muted border-b border-ink/15">
          solution.proschi <span className="font-sans">· imports</span> {PROBLEM_FILE}
        </div>
      </ZenCollapse>
      <div className="flex-1 min-h-0">
        <CodeEditor ref={editorRef} value={source} onChange={setSource} diagnostics={rootDiagnostics} nodeIds={nodeIds} />
      </div>
    </EditorZone>
  );

  const diagramPane = (
    <section aria-label="Diagram" className="h-full min-w-0 flex flex-col">
      <DiagramPane diagram={diagram} nodes={nodes} edges={edges} fitKey={`${pane}:${settled}:${fitTick}`} engine={engine} onSelect={goTo} zen={zen.zen} />
    </section>
  );

  const tests = (
    <section data-tour="tests" className="h-full flex flex-col">
      <TestPanel
        run={run?.result}
        stale={!!run && run.source !== source}
        diagnostics={diagnostics}
        onRun={runNow}
        running={running}
        onSelect={goTo}
        collapsed={!phone && !testsOpen}
        onToggle={phone ? undefined : toggleTests}
        review={<ReviewPanel source={source} input={() => practiceReviewInput(problem, source, engine)} onSelect={goTo} />}
        mistake={
          // Not for the untouched starter: it fails everything, so no one mistake describes it.
          run && !run.result.blocked && !run.result.solved && problem.wrong?.length && run.source.trim() !== problem.starter.trim() ? (
            <Suspense fallback={null}>
              <MistakePanel problem={problem} engine={engine} results={run.result.results} onLesson={openLessonAt} />
            </Suspense>
          ) : undefined
        }
        celebration={
          firstSolve && run?.result.solved ? (
            <Suspense fallback={null}>
              <SolveCelebration problem={problem} engine={engine} runs={firstSolve.runs} metrics={firstSolve.metrics} before={firstSolve.before} account={account} />
            </Suspense>
          ) : undefined
        }
        community={
          run && !run.result.blocked && (community || serverNote) ? (
            <>
              {serverNote && <p className="m-3 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-amber-800 dark:text-amber-200">{serverNote}</p>}
              {community && <CommunityStats stats={community} canSignIn={account.state.status === 'signed-out' && account.state.providers.length > 0} />}
              {community && (
                <ProblemBoards
                  problemId={problem.id}
                  signedIn={account.state.status === 'signed-in'}
                  refresh={statsRefresh}
                  // The first-solve card offers it itself: once per page.
                  onOptIn={account.state.status === 'signed-in' && !account.state.user.publicProfile && !firstSolve ? () => void account.update({ publicProfile: true }) : undefined}
                />
              )}
            </>
          ) : undefined
        }
      />
    </section>
  );

  return (
    <div
      className="h-[100dvh] flex flex-col bg-paper text-ink"
      style={keyboard.style}
      data-zen={zen.zen || undefined}
      data-keyboard={keyboard.open || undefined}
      data-stage={inLesson ? 'lesson' : 'workspace'}
    >
      <ZenCollapse zen={zen.zen}>
      <Header base="../" current="practice" compact>
        <a href={back.href} className={toolButton}>
          <ArrowLeft size={16} />
          <span className="hidden sm:inline">{back.label}</span>
        </a>
        <h1 className="flex items-center gap-2 min-w-0 font-display text-lg font-bold tracking-tight text-ink">
          <StatusIcon status={status} />
          <span className="truncate">{problem.title}</span>
        </h1>
        <DifficultyBadge difficulty={problem.difficulty} />
        {problem.company && (
          <span className="hidden sm:inline-flex">
            <CompanyBadge company={problem.company} />
          </span>
        )}
        {interviewOn && session && !inLesson && (
          <span className="ml-auto">
            <InterviewClock session={session} dispatch={dispatchInterview} />
          </span>
        )}
        {inLesson ? (
          <span className="ml-auto" />
        ) : (
          <>
            {/* From sm up the lesson, Reset and Help have their own buttons; on phones Reset and Help share "More", so the row does not wrap. */}
            <span className={`hidden sm:flex items-center gap-1 ${interviewOn && session ? '' : 'ml-auto'}`}>
              {lessonButton(outlineButton)}
              <button onClick={reset} className={toolButton} title="Start over from the starter code">
                <RotateCcw size={14} />
                Reset
              </button>
            </span>
            <MoreMenu className={`sm:hidden ${interviewOn && session ? '' : 'ml-auto'}`} onReset={reset} onTour={startTour} />
            <ZenButton zen={zen} className={iconButton} />
          </>
        )}
        <AccountMenu account={account} />
        <HelpMenu className="hidden sm:block" tourLabel="Take the practice tour" onTour={startTour} />
      </Header>
      {banner}

      {phone && !inLesson && (
        // The design system's tab look (widgets.css); plain buttons so each tab keeps its data-tour target.
        <div className="flex items-stretch bg-surface border-b-bw-1 border-ink">
          <div role="tablist" aria-label="View" className="ps-tabs ps-tabs--fill flex-1 min-w-0 !border-b-0">
            {PANES.map(({ id, label, icon: Icon }) => (
              <button key={id} role="tab" data-tour={`tab-${id}`} aria-selected={pane === id} onClick={() => setPane(id)} className="ps-tab !px-2">
                <Icon size={15} className="hidden min-[420px]:block" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
          {lessonButton('flex-none inline-flex items-center gap-1.5 px-3 text-sm font-semibold text-ink border-l-bw-1 border-ink hover:bg-pop-yellow/30')}
        </div>
      )}
      </ZenCollapse>

      {!inLesson &&
        (phone ? (
          <div className="flex-1 min-h-0 flex flex-col">
            {([['statement', statement], ['code', editor], ['diagram', diagramPane], ['tests', tests]] as const).map(([id, content]) => (
              <div key={id} className={pane === id ? 'flex-1 min-h-0' : 'hidden'}>
                {content}
              </div>
            ))}
          </div>
        ) : (
          <Group orientation="vertical" className="flex-1 min-h-0" onLayoutChanged={refit}>
            <Panel id="workspace" minSize="25%">
              <Group orientation="horizontal" className="h-full" onLayoutChanged={refit}>
                <Panel id="statement" defaultSize="30%" minSize="18%" maxSize="55%">
                  {statement}
                </Panel>
                <Separator className="ps-splitter w-[var(--bw-1)]" aria-label="Resize the problem and the editor" />
                <Panel id="code" defaultSize="36%" minSize="20%">
                  {editor}
                </Panel>
                <Separator className="ps-splitter w-[var(--bw-1)]" aria-label="Resize the editor and the diagram" />
                <Panel id="diagram" minSize="16%">
                  {diagramPane}
                </Panel>
              </Group>
            </Panel>
            <Separator className="ps-splitter h-[var(--bw-1)]" aria-label="Resize the tests" />
            <Panel
              id="tests"
              panelRef={testsPanel}
              collapsible
              collapsedSize={TESTS_BAR_PX}
              defaultSize={TESTS_BAR_PX}
              minSize="22%"
              maxSize="80%"
              onResize={(size) => setTestsOpen(size.inPixels > TESTS_BAR_PX + 1)}
            >
              {tests}
            </Panel>
          </Group>
        ))}

      {hasLesson && (
        <LessonHost mode={inLesson ? 'page' : drawer ? 'drawer' : 'closed'} onClose={() => setDrawer(false)} scrollRef={lessonScroll} title={problem.title}>
          <LessonView source={problem.lesson!} onStart={inLesson ? startChallenge : undefined} large={inLesson} onRead={() => markLessonRead(problem.id)} />
        </LessonHost>
      )}

      <ZenStatus zen={zen} />
      {tour === 'tour' && !inLesson && (
        <Suspense fallback={null}>
          <PracticeTour key={tourRun} setPane={setPane} runs={runs} runTests={runNow} onClose={() => setTour(null)} />
        </Suspense>
      )}
    </div>
  );
}

/** Phones only: Reset and Help's items in one menu. */
function MoreMenu({ className, onReset, onTour }: { className: string; onReset: () => void; onTour: () => void }) {
  const [sheet, setSheet] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={rootRef} className={className}>
      <Menu label="More" align="right" trigger={<MoreHorizontal size={18} />}>
        {(close) => (
          <>
            <MenuItem
              icon={<RotateCcw size={14} />}
              onSelect={() => {
                close();
                onReset();
              }}
            >
              Reset to the starter code
            </MenuItem>
            <div className="my-1 border-t border-ink/10" />
            <Suspense fallback={<p className="px-3 py-1.5 text-sm text-muted">Loading…</p>}>
              <HelpMenuItems
                tourLabel="Take the practice tour"
                onTour={() => {
                  close();
                  setSheet(false);
                  onTour();
                }}
                onCheatSheet={() => {
                  close();
                  setSheet(true);
                }}
              />
            </Suspense>
          </>
        )}
      </Menu>
      {sheet && (
        <Suspense fallback={null}>
          <CheatSheet
            onClose={() => {
              setSheet(false);
              rootRef.current?.querySelector<HTMLButtonElement>('button[aria-label="More"]')?.focus();
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

function Statement({ problem, solved, onUseSolution, modes }: { problem: Problem; solved: boolean; onUseSolution: () => void; /** The buttons that open interview or guided mode. */ modes?: ReactNode }) {
  const [hints, setHints] = useState(0);
  const [showSolution, setShowSolution] = useState(false);

  const revealSolution = () => {
    if (solved || window.confirm('Show the reference solution? Working it out yourself is where the learning happens.')) setShowSolution(true);
  };

  return (
    <div className="px-4 py-4 space-y-5">
      {modes}
      {/* The header shows it from sm up. */}
      {problem.company && (
        <p className="sm:hidden">
          <CompanyBadge company={problem.company} />
        </p>
      )}
      <Markdown source={problem.statement} />

      <details className="rounded border-bw-1 border-ink bg-paper">
        <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-ink">
          <span className={eyebrow}>Given</span> <code className="font-mono">{PROBLEM_FILE}</code> <span className="font-normal text-muted">(read-only)</span>
        </summary>
        <pre className="overflow-x-auto border-t-bw-1 border-ink bg-surface p-3 font-mono text-xs">{problem.given}</pre>
      </details>

      {problem.hints.length > 0 && (
        <div className="space-y-2">
          {problem.hints.slice(0, hints).map((hint, i) => (
            <p key={i} className="flex gap-2 rounded border-bw-1 border-ink bg-pop-yellow/25 px-3 py-2 text-sm text-ink shadow-brutal-sm">
              <Lightbulb size={16} className="mt-0.5 flex-shrink-0" />
              <span>
                <strong>Hint {i + 1}.</strong> {hint}
              </span>
            </p>
          ))}
          {hints < problem.hints.length && (
            <button onClick={() => setHints((n) => n + 1)} className={toolButton}>
              <Lightbulb size={14} />
              {hints === 0 ? 'Show a hint' : 'Show another hint'} ({hints} / {problem.hints.length})
            </button>
          )}
        </div>
      )}

      <div>
        {showSolution ? (
          <div className="rounded border-bw-1 border-ink bg-paper">
            <div className="flex items-center gap-2 px-3 py-2 border-b-bw-1 border-ink text-sm font-semibold text-ink">
              Reference solution
              <button
                onClick={() => window.confirm('Replace your code with the reference solution?') && onUseSolution()}
                className="ml-auto text-xs font-semibold text-pop-blue underline-offset-2 hover:underline"
              >
                Load into the editor
              </button>
            </div>
            <pre className="overflow-x-auto bg-surface p-3 font-mono text-xs">{problem.solution}</pre>
          </div>
        ) : (
          <button onClick={revealSolution} className={toolButton}>
            <Eye size={14} />
            Show reference solution
          </button>
        )}
      </div>
    </div>
  );
}

interface DiagramPaneProps {
  diagram: ReturnType<typeof parseSolution>['diagram'];
  nodes: ReturnType<typeof useDiagramLayout>['nodes'];
  edges: ReturnType<typeof useDiagramLayout>['edges'];
  fitKey: string;
  engine: Engine;
  onSelect: (loc: SourceLoc) => void;
  /** Zen mode folds the tab bar away. */
  zen: boolean;
}

/** The design as a diagram, one scenario played step by step, or its capacity analysis. */
function DiagramPane({ diagram, nodes, edges, fitKey, engine, onSelect, zen }: DiagramPaneProps) {
  const [tab, setTab] = useState<'diagram' | 'playback' | 'analysis'>('diagram');
  const analysis = useMemo(() => (tab === 'analysis' ? engine.analyze(diagram) : undefined), [tab, engine, diagram]);
  const options = useMemo(
    () => diagram.useCases.flatMap((u) => u.scenarios.filter((s) => s.steps.length > 0).map((s) => ({ key: `${u.id}/${s.id}`, useCase: u, scenario: s }))),
    [diagram],
  );
  const [selected, setSelected] = useState<string>();
  const current = options.find((o) => o.key === selected) ?? options[0];
  const played = useMemo(
    () => (current ? { id: current.key, name: current.useCase.name, steps: current.scenario.steps, condition: current.scenario.condition } : undefined),
    [current],
  );

  return (
    <div className="h-full w-full flex flex-col">
      <ZenCollapse zen={zen}>
      <div className={`flex items-center gap-1 px-2 py-1.5 ${subBar}`}>
        {(['diagram', 'playback', 'analysis'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            disabled={(t === 'playback' && !current) || (t === 'analysis' && !engine.available)}
            aria-pressed={tab === t}
            className={`rounded px-2.5 py-1 text-sm font-semibold capitalize border-bw-1 disabled:opacity-40 ${tab === t ? 'border-ink bg-ink text-paper' : 'border-transparent text-ink/75 hover:border-ink hover:text-ink'}`}
          >
            {t}
          </button>
        ))}
        {tab === 'playback' && current && (
          <select
            aria-label="Scenario"
            value={current.key}
            onChange={(e) => setSelected(e.target.value)}
            className={`ml-auto min-w-0 max-w-[60%] ${field} !py-1`}
          >
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.useCase.scenarios.length > 1 ? `${o.useCase.name} › ${o.scenario.name}` : o.useCase.name}
              </option>
            ))}
          </select>
        )}
      </div>
      </ZenCollapse>
      <div className="flex-1 min-h-0 relative">
        {tab === 'playback' && played ? (
          <UseCasePlayer key={played.id} useCase={played} nodes={nodes} edges={edges} onBack={() => setTab('diagram')} showHeader={false} />
        ) : tab === 'analysis' && analysis ? (
          <AnalysisPanel diagram={diagram} analysis={analysis} onSelect={onSelect} />
        ) : (
          <DiagramCanvas nodes={nodes} edges={edges} fitKey={fitKey} />
        )}
        {nodes.length === 0 && tab === 'diagram' && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-muted pointer-events-none">Your design appears here as you type.</p>
        )}
      </div>
    </div>
  );
}
