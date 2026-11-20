import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, BookOpen, Code2, Compass, Eye, FlaskConical, GraduationCap, Lightbulb, Maximize2, MoreHorizontal, Network, PanelsTopLeft, Presentation, RotateCcw, Timer } from 'lucide-react';
import { confirm } from '../design/dialogs';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import type { Diagnostic, SourceLoc } from '../dsl';
import type { Engine } from '../hld/engine';
import CodeEditor, { type CodeEditorHandle } from '../components/Playground/CodeEditor';
import EditableCanvas from '../components/Diagram/EditableCanvas';
import ModeSwitch from '../components/Diagram/ModeSwitch';
import CodeDrawer from '../components/Diagram/CodeDrawer';
import { useEditorMode } from '../components/Diagram/editorMode';
import { useDiagramLayout } from '../components/Diagram/useDiagramLayout';
import { UseCasePlayer } from '../components/UseCases/UseCasePlayback';
import AnalysisPanel from '../components/Analysis/AnalysisPanel';
import Markdown from './Markdown';
import LessonView from './LessonView';
import LessonHost from './LessonHost';
import TestPanel from './TestPanel';
import ReviewPanel from '../review/ReviewPanel';
import { practiceReviewInput } from '../review/practice';
import { AssistedTag, CompanyBadge, DifficultyBadge, StatusIcon } from './Badges';
import { markLessonRead, sourceOf, statusOf, withAssisted, withReset, withRun, withSource, type Progress } from './progress';
import { billingEnabled } from '../services/billing';
import PartnerButton from '../partner/PartnerButton';
import { usePartnerShortcut } from '../partner/shortcut';
import PartnerDock from '../partner/PartnerDock';
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
import { eyebrow, iconButton, outlineButton, subBar, toolButton } from '../components/Playground/ui';
import { evaluateChecks, guidedReducer, parseGuided } from './modes/guidedFile';
import { loadGuided, saveGuided, type GuidedState } from './modes/store';
import GuidedPanel from './modes/GuidedPanel';
import { parseInterview } from './modes/interviewFile';
import { questionRowId } from './interview/stages';
import { setupHref } from './interview/links';
import { ChecksSheet } from './interview/Room';
import { EMPTY_NOTES, factsOf, goTo as reachStage, labelOf, loadNotes, nextOf, notesSaved, openingScreen, saveNotes, stageDone, type StageId, type StageNotes, type WorkStage } from './stages/flow';
import StageBar, { StageFoot, type StageNext } from './stages/StageBar';
import { ClarifyStage, EstimateStage, WrapupStage } from './stages/Screens';
import DesignGuide from './stages/DesignGuide';
import AskSelection, { AskTip } from './stages/AskSelection';
import { askTipDone, markAskTipDone, prepTurnOf } from './stages/coach';
import type { PrepTurn } from '../partner/prep';
import { quoteForPartner } from './stages/ask';
import { track } from '../services/metrics';
import './practiceLayout.css';
import { useFeedbackDiagram } from '../feedback/diagram';
import Select from '../design/Select';

const PracticeTour = lazy(() => import('../onboarding/PracticeTour'));
const PartnerPanel = lazy(() => import('../partner/PartnerPanel'));
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
   * Open on the lesson (when the problem has one): `always` (practice/#/<id>/lesson,
   * practice/#/roadmap/<id>/lesson); otherwise only on a first visit to the stages (P52).
   */
  openLesson?: 'always';
  /**
   * The staged flow (P50) is for Interview prep only (P51). Without it the
   * problem opens straight on the workspace, as it did before the stages:
   * no lesson gate, no stage bar, the lesson one click away in the header.
   */
  staged?: boolean;
}

/**
 * A problem worked through in stages (docs/design/paid-plans.md P50): its
 * lesson, then Clarify, Estimate, Design and Wrap-up, one calm screen each,
 * self-paced, with the stages' rail on top. Each asks for your own answer
 * before it shows the facts or the worked answer, and the notes are kept per
 * problem (stages/flow.ts). Design is a whiteboard, with the full editor (the
 * statement, the editor and the diagram side by side in resizable panes, the
 * tests folded under them; tabs on phones) one click away. The Interview
 * coach (P59) is there in every stage, and any text selected on a stage can
 * be asked about. The plain workspace keeps Design partner.
 */
export default function ProblemPage({ problem, progress, onProgress, engine, account, back = { href: '#/', label: 'Problems' }, banner, openLesson, staged = false }: ProblemPageProps) {
  const [source, setSource] = useState(() => sourceOf(progress, problem));
  useFeedbackDiagram(source);
  const [parsedSource, setParsedSource] = useState(source);
  const [run, setRun] = useState<{ result: RunResult; source: string }>();
  const hasLesson = problem.lesson !== undefined;
  // The notes of each stage, kept per problem; the screen opens where it was left (the lesson only on its own address).
  const [notes, setNotes] = useState<StageNotes>(() => loadNotes(problem.id));
  const [screen, setScreen] = useState<StageId>(() => (staged ? openingScreen(hasLesson, openLesson, loadNotes(problem.id), notesSaved(problem.id)) : 'design'));
  const updateNotes = useCallback(
    (update: (n: StageNotes) => StageNotes) =>
      setNotes((n) => {
        const next = update(n);
        saveNotes(problem.id, next);
        return next;
      }),
    [problem.id],
  );
  const interview = useMemo(() => (problem.interview !== undefined ? parseInterview(problem.interview).interview : undefined), [problem.interview]);
  /** Code or Visual, as in the editor: the code beside a view-only canvas, or the canvas alone with View code. */
  const [mode] = useEditorMode();
  const visual = mode === 'visual';
  /** Visual mode's View code, open at a line (a test or a problem picked); a new `n` selects it again. */
  const [codeView, setCodeView] = useState<{ at: { line: number; col: number; length: number; n: number } | null } | null>(null);
  const closeCodeView = useCallback(() => setCodeView(null), []);
  const [checksOpen, setChecksOpen] = useState(false);
  // Phones, on the Design stage: the guide, the whiteboard or the code.
  const [designTab, setDesignTab] = useState<'guide' | 'board' | 'code'>('board');
  // On a plain problem, `practice/#/<id>/lesson` opens the lesson beside the workspace.
  const [drawer, setDrawer] = useState(!staged && hasLesson && openLesson === 'always');
  // A heading to bring into view once the drawer shows (openLessonAt).
  const [lessonTarget, setLessonTarget] = useState<string>();
  const phone = useIsPhone();
  // The pane shown on phones; Visual mode has no code pane, so its canvas stands in.
  const [paneState, setPaneState] = useState<Pane>('statement');
  const pane = visual && paneState === 'code' ? 'diagram' : paneState;
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
  /** Opens a stage from the rail or a Next; leaving the lesson counts it as read. */
  const openStage = (next: StageId) => {
    setDrawer(false);
    setChecksOpen(false);
    if (next === 'lesson') {
      setScreen('lesson');
      return;
    }
    if (screen === 'lesson') {
      markLessonRead(problem.id);
      // practice/#/<id>/lesson becomes the problem's own address, so a reload opens the stages.
      if (/\/lesson$/.test(window.location.hash)) {
        try {
          window.history.replaceState(window.history.state, '', window.location.hash.replace(/\/lesson$/, ''));
        } catch {
          // Not allowed (sandboxed): the address keeps /lesson.
        }
      }
    }
    updateNotes((n) => reachStage(n, next));
    setScreen(next);
  };
  const setEditor = (editor: boolean) => updateNotes((n) => ({ ...n, editor }));
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

  // Guided mode: opt-in, remembered in this browser (modes/store.ts). The mock interview has its own room (practice/interview).
  const guidedSteps = useMemo(() => {
    if (problem.guided === undefined) return undefined;
    const read = parseGuided(problem.guided);
    return read.issues.length === 0 ? read.steps : undefined;
  }, [problem.guided]);
  const [guidedState, setGuidedState] = useState<GuidedState>(() => (guidedSteps ? loadGuided(problem.id, guidedSteps.length) : { done: [], active: false }));
  const guidedOn = !!guidedSteps && guidedState.active;
  // Design partner reads the editor's source when it is asked.
  const sourceNow = useRef(source);
  useEffect(() => {
    sourceNow.current = source;
  }, [source]);
  const getSource = useCallback(() => sourceNow.current, []);
  const updateGuided = useCallback(
    (update: (g: GuidedState) => GuidedState) =>
      setGuidedState((g) => {
        const next = update(g);
        saveGuided(problem.id, next);
        return next;
      }),
    [problem.id],
  );
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
  // The canvas's load overlay (EditableCanvas) can show once the design has traffic.
  const { nodes, edges, settled, busy: layoutBusy } = useDiagramLayout(diagram, { overlay: (diagram.traffic?.length ?? 0) > 0 });

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

  // The tour shows the full editor, so asking for it opens Design there.
  const startTour = () => {
    if (staged && (screen !== 'design' || !notes.editor)) {
      updateNotes((n) => ({ ...reachStage(n, 'design'), editor: true }));
      setScreen('design');
    }
    setTourRun((n) => n + 1);
    setTour('tour');
  };

  /**
   * Starts the problem over: what the learner wrote goes (the design, back to
   * the starter, also on the server; the stage notes; the guided steps; the
   * last run shown). The status, the assisted mark, XP, badges and the solve
   * history stay.
   */
  const reset = async () => {
    const keeps = status === 'solved' ? 'The problem stays solved and your XP stays.' : 'Your XP stays.';
    const goes = staged ? 'your design, your stage notes and the last test run' : 'your design and the last test run';
    if (!(await confirm({ title: 'Start this problem over?', body: `This removes ${goes}. ${keeps}`, confirmLabel: 'Start over', tone: 'danger' }))) return;
    setSource(problem.starter);
    onProgress((p) => withReset(p, problem.id));
    void account.clearSource(problem.id);
    updateNotes(() => EMPTY_NOTES);
    if (guidedSteps) updateGuided((g) => ({ ...g, done: [] }));
    setRun(undefined);
    setServerNote(undefined);
    setChecksOpen(false);
    if (staged) {
      setDrawer(false);
      setScreen(EMPTY_NOTES.stage);
    }
  };

  const goTo = (loc: SourceLoc | Diagnostic) => {
    if (loc.file !== undefined) return;
    // Visual mode shows it in View code.
    if (visual) return setCodeView((v) => ({ at: { line: loc.line, col: loc.col, length: loc.length, n: (v?.at?.n ?? 0) + 1 } }));
    setPane('code');
    editorRef.current?.goTo(loc.line, loc.col);
  };

  const toggleTests = () => {
    const panel = testsPanel.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.resize('40%');
    else panel.collapse();
  };

  // Design partner (src/partner): coaches on this problem (P29, P30); the interview room has none.
  // On the interview prep stages it is the Interview coach (P59), with its own conversation.
  const hasPartner = billingEnabled && account.state.status !== 'off';
  const [partnerOpen, setPartnerOpen] = useState(false);
  const togglePartner = useCallback(() => setPartnerOpen((o) => !o), []);
  const closePartner = useCallback(() => setPartnerOpen(false), []);
  const partnerContext = useMemo(() => ({ kind: staged ? ('prep' as const) : ('practice' as const), problemId: problem.id }), [staged, problem.id]);
  // The Interview coach gets the stage on screen and the notes with each turn (kept current below).
  const prepNow = useRef<PrepTurn>(undefined);
  const getPrep = useCallback(() => prepNow.current, []);
  const applyPartner = useCallback((next: string) => {
    if (editorRef.current) editorRef.current.replace(next);
    else setSource(next);
  }, []);
  const undoPartner = useCallback(() => editorRef.current?.undo() ?? false, []);
  const partnerDiagram = useCallback((s: string) => parseSolution(problem, s).diagram, [problem]);
  // Ctrl/Cmd+Z on the canvas: every canvas edit is one step of the code editor's history.
  const undoCanvas = useCallback(() => void editorRef.current?.undo(), []);
  const redoCanvas = useCallback(() => void editorRef.current?.redo(), []);
  const markAssisted = useCallback(() => onProgress((p) => withAssisted(p, problem.id)), [onProgress, problem.id]);

  // Select text on a stage, then "Ask Interview coach": the quote goes into the composer.
  const [partnerPrefill, setPartnerPrefill] = useState<{ id: number; text: string }>();
  // "Tip: select any text…" shows on the stages until it is used once or dismissed.
  const [askTip, setAskTip] = useState(() => !askTipDone());
  const doneAskTip = useCallback(() => {
    markAskTipDone();
    setAskTip(false);
  }, []);
  const askPartner = useCallback(
    (text: string) => {
      const quote = quoteForPartner(text);
      if (!quote) return;
      setPartnerPrefill((p) => ({ id: (p?.id ?? 0) + 1, text: quote }));
      setPartnerOpen(true);
      doneAskTip();
    },
    [doneAskTip],
  );

  const inLesson = hasLesson && screen === 'lesson';
  // Design in the full editor: the workspace as it always was.
  const editorView = screen === 'design' && (!staged || notes.editor);
  usePartnerShortcut(togglePartner, hasPartner);
  const lessonButton = (className: string, iconOnly = false) =>
    hasLesson && (
      <button type="button" onClick={() => setDrawer(true)} aria-haspopup="dialog" aria-expanded={drawer} className={className} title="Open the lesson beside your work">
        <GraduationCap size={15} aria-hidden="true" />
        <span className={iconOnly ? 'sr-only' : ''}>Lesson</span>
      </button>
    );

  const guidedPanel = guidedSteps && (
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
  );

  const statement = (
    <div data-tour="statement" className="h-full overflow-y-auto bg-surface">
      <>
          {guidedOn && guidedPanel}
          <Statement
            problem={problem}
            solved={status === 'solved'}
            onUseSolution={() => setSource(problem.solution)}
            modes={
              !staged &&
              (problem.interview !== undefined || (guidedSteps && !guidedOn)) && (
                <div className="flex flex-wrap items-center gap-2" aria-label="Practice modes" role="group">
                  {problem.interview !== undefined && (
                    <a href={setupHref(problem.id)} className={outlineButton} title="A mock interview on this problem: clarify, estimate, design and wrap up against the clock">
                      <Timer size={14} aria-hidden="true" />
                      Interview mode
                    </a>
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
        <CodeEditor ref={editorRef} value={source} onChange={setSource} diagnostics={rootDiagnostics} nodeIds={nodeIds} diagram={diagram} />
      </div>
    </EditorZone>
  );

  const codeDrawer = visual && codeView && (
    <CodeDrawer source={source} file="solution.proschi" diagnostics={rootDiagnostics} nodeIds={nodeIds} diagram={diagram} at={codeView.at} onClose={closeCodeView} />
  );
  const viewCodeButton = (iconOnly: boolean) =>
    visual && (
      <button
        type="button"
        aria-pressed={!!codeView}
        onClick={() => setCodeView(codeView ? null : { at: null })}
        className={`${toolButton} shrink-0 whitespace-nowrap aria-pressed:border-ink aria-pressed:bg-pop-yellow aria-pressed:text-on-accent`}
        title="The Proschi code behind the canvas, read-only"
      >
        <Eye size={15} aria-hidden="true" />
        <span className={iconOnly ? 'sr-only' : ''}>View code</span>
      </button>
    );

  const diagramPane = (
    <section aria-label="Diagram" className="relative h-full min-w-0 flex flex-col">
      <DiagramPane
        diagram={diagram}
        nodes={nodes}
        edges={edges}
        fitKey={`${pane}:${settled}:${fitTick}`}
        layoutBusy={layoutBusy}
        engine={engine}
        onSelect={goTo}
        zen={zen.zen}
        source={source}
        onChange={setSource}
        onUndo={undoCanvas}
        onRedo={redoCanvas}
        phone={phone}
        viewOnly={!visual}
      />
      {codeDrawer}
    </section>
  );

  const partnerDock = hasPartner && (
    <>
    {!phone && <PartnerButton open={partnerOpen} onToggle={togglePartner} coach={staged} />}
    <PartnerDock open={partnerOpen} phone={phone} onClose={closePartner} label={staged ? 'Interview coach' : 'Design partner'}>
      <Suspense fallback={null}>
        <PartnerPanel
          storeKey={`${staged ? 'prep' : 'practice'}:${problem.id}`}
          context={partnerContext}
          account={account}
          source={source}
          getSource={getSource}
          apply={applyPartner}
          undo={undoPartner}
          onClose={closePartner}
          onAssisted={markAssisted}
          diagramOf={partnerDiagram}
          prefill={partnerPrefill}
          view={mode}
          {...(staged ? { stage: screen, getPrep } : {})}
        />
      </Suspense>
    </PartnerDock>
    </>
  );

  /** The tests and the review: folded under the full editor's panes, or whole in the wrap-up (`inPage`). */
  const testPanel = (inPage: boolean) => (
    <section data-tour={inPage ? undefined : 'tests'} className="h-full flex flex-col">
      <TestPanel
        run={run?.result}
        stale={!!run && run.source !== source}
        diagnostics={diagnostics}
        onRun={runNow}
        running={running}
        onSelect={goTo}
        collapsed={!inPage && !phone && !testsOpen}
        onToggle={inPage || phone ? undefined : toggleTests}
        review={
          <ReviewPanel
            source={source}
            input={() => practiceReviewInput(problem, source, engine)}
            onSelect={goTo}
            onOpenPartner={hasPartner ? () => setPartnerOpen(true) : undefined}
            coach={staged}
          />
        }
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

  const solved = status === 'solved' || !!run?.result.solved;
  const questions = interview?.estimates ?? [];
  const rows = notes.rows ?? questions.map((e, i) => ({ id: questionRowId(i), label: e.question, expression: '', unit: e.unit }));
  useEffect(() => {
    prepNow.current = staged ? prepTurnOf(screen, notes, rows) : undefined;
  });
  const runDesign = () => {
    runNow();
    setChecksOpen(true);
  };

  // The stage's way on: from the lesson back to where you were, else the next stage.
  const work = screen === 'lesson' ? undefined : (screen as WorkStage);
  const following = work && nextOf(work);
  const next: StageNext | undefined =
    screen === 'lesson'
      ? { label: notes.reached === 'clarify' ? 'Next: Clarify' : `Continue: ${labelOf(notes.stage)}`, onClick: () => openStage(notes.stage), primary: true }
      : following
        ? { label: `Next: ${labelOf(following)}`, onClick: () => openStage(following), primary: stageDone(notes, work!, questions.length, solved) }
        : // The last stage: Finish goes back where the problem was opened from (the notes are saved as typed).
          { label: 'Finish', onClick: () => {
              window.location.hash = back.href;
            }, primary: true };

  // Focus moves to each new stage's heading (not on the first render).
  const main = useRef<HTMLDivElement>(null);
  const firstScreen = useRef(true);
  useEffect(() => {
    if (firstScreen.current) {
      firstScreen.current = false;
      return;
    }
    const frame = requestAnimationFrame(() => main.current?.querySelector<HTMLElement>('[data-stage-heading]')?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [screen, editorView]);

  const whiteboard = (
    <section aria-label="Whiteboard" className="relative h-full min-w-0">
      <EditableCanvas
        source={source}
        diagram={diagram}
        onChange={setSource}
        onUndo={undoCanvas}
        onRedo={redoCanvas}
        nodes={nodes}
        edges={edges}
        fitKey={`board:${designTab}:${settled}:${fitTick}:${mode}`}
        layoutBusy={layoutBusy}
        problemCapacity
        paletteKey="proschi.practice.palette"
        flows
        phone={phone}
        simulate={engine.available ? engine.analyze : undefined}
        viewOnly={!visual}
      />
      {codeDrawer}
      {checksOpen && run && (
        <ChecksSheet run={run.result} stale={run.source !== source} onClose={() => setChecksOpen(false)} />
      )}
    </section>
  );
  const guide = (
    <DesignGuide
      statement={problem.statement}
      facts={factsOf(interview)}
      rows={rows}
      questions={questions}
      hints={problem.hints}
      run={run?.result}
      running={running}
      onRun={runDesign}
      onWalkthrough={guidedSteps && !guidedOn ? openGuided : undefined}
      walkthrough={guidedSteps && guidedOn ? guidedPanel : undefined}
    />
  );
  const designShown = visual && designTab === 'code' ? 'board' : designTab;
  const designStage = phone ? (
    <>
      <div className="flex items-stretch border-b-bw-1 border-ink bg-surface">
        <div role="tablist" aria-label="Design" className="ps-tabs ps-tabs--fill flex min-w-0 flex-1 !border-b-0">
          {(
            [
              ['guide', 'Guide', BookOpen],
              ['board', 'Whiteboard', Presentation],
              ...(visual ? [] : ([['code', 'Code', Code2]] as const)),
            ] as const
          ).map(([id, label, Icon]) => (
            <button key={id} role="tab" aria-selected={designShown === id} onClick={() => setDesignTab(id)} className="ps-tab !px-2">
              <Icon size={15} className="hidden min-[420px]:block" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
        {/* The stage bar above has no room on a phone. */}
        <div className="flex flex-none items-center gap-1 border-l-bw-1 border-ink px-1.5">
          <ModeSwitch compact problems={rootDiagnostics.length} />
          {viewCodeButton(true)}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <div className={designShown === 'guide' ? 'h-full' : 'hidden'}>{guide}</div>
        <div className={designShown === 'board' ? 'h-full' : 'hidden'}>{whiteboard}</div>
        {/* Mounted in Visual too, hidden: the whiteboard's undo and redo are its history. */}
        <div className={designShown === 'code' ? 'h-full' : 'hidden'}>{editor}</div>
      </div>
    </>
  ) : (
    <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1">
        {/* Visual mode hides the code, still mounted: the whiteboard's undo and redo are its history. */}
        <Group orientation="horizontal" className="h-full [&>[data-mode-hidden]]:!hidden" onLayoutChanged={refit}>
          <Panel id="design-code" defaultSize="38%" minSize="22%" maxSize="60%" data-mode-hidden={visual || undefined}>
            {editor}
          </Panel>
          <Separator className="ps-splitter w-[var(--bw-1)]" aria-label="Resize the code and the whiteboard" data-mode-hidden={visual || undefined} />
          <Panel id="design-board" minSize="30%">
            {whiteboard}
          </Panel>
        </Group>
      </div>
      <div className="w-[340px] shrink-0 border-l-bw-1 border-ink xl:w-[380px]">{guide}</div>
    </div>
  );

  const workspace = phone ? (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* The code stays mounted in Visual mode, hidden: the canvas's undo and redo are its history. */}
      {([['statement', statement], ['code', editor], ['diagram', diagramPane], ['tests', testPanel(false)]] as const).map(([id, content]) => (
        <div key={id} className={pane === id ? 'flex-1 min-h-0' : 'hidden'}>
          {content}
        </div>
      ))}
    </div>
  ) : (
    <Group orientation="vertical" className="flex-1 min-h-0 min-w-0" onLayoutChanged={refit}>
      <Panel id="workspace" minSize="25%">
        {/* Visual mode hides the code, still mounted: the canvas's undo and redo are its history. */}
        <Group orientation="horizontal" className="h-full [&>[data-mode-hidden]]:!hidden" onLayoutChanged={refit}>
          <Panel id="statement" defaultSize="30%" minSize="18%" maxSize="55%">
            {statement}
          </Panel>
          <Separator className="ps-splitter w-[var(--bw-1)]" aria-label="Resize the problem and the editor" />
          <Panel id="code" defaultSize="36%" minSize="20%" data-mode-hidden={visual || undefined}>
            {editor}
          </Panel>
          <Separator className="ps-splitter w-[var(--bw-1)]" aria-label="Resize the editor and the diagram" data-mode-hidden={visual || undefined} />
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
        {testPanel(false)}
      </Panel>
    </Group>
  );

  let body: ReactNode = null;
  if (editorView) body = workspace;
  else if (screen === 'clarify') body = <ClarifyStage problem={problem} interview={interview} notes={notes} onNotes={updateNotes} onNext={() => openStage('estimate')} />;
  else if (screen === 'estimate') body = <EstimateStage problem={problem} interview={interview} notes={notes} onNotes={updateNotes} onNext={() => openStage('design')} phone={phone} />;
  else if (screen === 'design') body = designStage;
  else if (screen === 'wrapup') body = <WrapupStage problem={problem} progress={progress} solved={solved} notes={notes} onNotes={updateNotes} tests={testPanel(true)} finish={back} />;

  const zenOn = zen.zen && editorView;
  const designTools =
    screen === 'design' &&
    (editorView ? (
      <button type="button" onClick={() => setEditor(false)} className={`${toolButton} shrink-0`} title="Back to the whiteboard and the stage's guide">
        <Presentation size={15} aria-hidden="true" />
        <span className="max-sm:sr-only">Whiteboard</span>
      </button>
    ) : (
      <>
        {/* On phones the switch is in the Design tabs' bar. */}
        {!phone && (
          <>
            <ModeSwitch problems={rootDiagnostics.length} />
            {viewCodeButton(false)}
          </>
        )}
        <button type="button" aria-label="Open the full editor" onClick={() => setEditor(true)} className={`${toolButton} shrink-0`} title="The full editor: code, tests, scenario playback and the capacity analysis, side by side">
          <PanelsTopLeft size={15} aria-hidden="true" />
          <span className="max-sm:sr-only">Full editor</span>
        </button>
      </>
    ));

  return (
    <div
      className="h-[100dvh] flex flex-col bg-paper text-ink"
      style={keyboard.style}
      data-zen={zenOn || undefined}
      data-keyboard={keyboard.open || undefined}
      data-stage={staged ? screen : 'workspace'}
      data-view={editorView ? 'editor' : 'stages'}
    >
      <ZenCollapse zen={zenOn}>
      <Header base="../" current="practice" compact>
        <a href={back.href} className={toolButton} aria-label={back.label} title={back.label}>
          <ArrowLeft size={16} />
          <span className="hidden xl:inline">{back.label}</span>
        </a>
        <h1 className="flex items-center gap-2 min-w-0 max-sm:flex-1 max-sm:basis-0 font-display text-lg font-bold tracking-tight text-ink">
          <span className="flex max-sm:hidden"><StatusIcon status={status} /></span>
          <span className="truncate">{problem.title}</span>
          {progress[problem.id]?.assisted && <AssistedTag />}
        </h1>
        <DifficultyBadge difficulty={problem.difficulty} />
        {problem.company && (
          <span className="hidden sm:inline-flex">
            <CompanyBadge company={problem.company} />
          </span>
        )}
        {/* From sm up Reset and Help have their own buttons; on phones they share "More", so the row does not wrap. */}
        <span className={`hidden sm:flex items-center gap-1 ml-auto`}>
          {/* The full editor's switch; on the stages it is in the stage bar, on phones in the tab bar. */}
          {editorView && !phone && (
            <>
              <ModeSwitch problems={rootDiagnostics.length} />
              {viewCodeButton(false)}
            </>
          )}
          {!staged && lessonButton(outlineButton)}
          <button onClick={reset} className={toolButton} aria-label="Reset" title="Reset: start this problem over (your work goes; a solve and your XP stay)">
            <RotateCcw size={14} />
            <span className="hidden min-[1440px]:inline">Reset</span>
          </button>
        </span>
        <MoreMenu className={`sm:hidden ml-auto`} onReset={reset} onTour={startTour} onZen={editorView ? zen.toggle : undefined} />
        {editorView && <ZenButton zen={zen} className={`${iconButton} max-sm:hidden`} />}
        <AccountMenu account={account} />
        <HelpMenu className="hidden sm:block" tourLabel="Take the practice tour" onTour={startTour} />
      </Header>
      {banner}
      {staged && (
        <StageBar
          notes={notes}
          shown={screen}
          hasLesson={hasLesson}
          onOpen={openStage}
          next={next}
          tools={designTools}
          partner={phone && hasPartner && !editorView && <PartnerButton bar open={partnerOpen} onToggle={togglePartner} coach />}
          phone={phone}
        />
      )}
      {staged && hasPartner && askTip && !editorView && <AskTip onDismiss={doneAskTip} />}

      {phone && editorView && (
        // The design system's tab look (widgets.css); plain buttons so each tab keeps its data-tour target.
        <div className="flex items-stretch bg-surface border-b-bw-1 border-ink">
          <div role="tablist" aria-label="View" className="ps-tabs ps-tabs--fill flex-1 min-w-0 !border-b-0">
            {PANES.filter((p) => !visual || p.id !== 'code').map(({ id, label, icon }) => {
              const Icon = icon;
              return (
                <button key={id} role="tab" data-tour={`tab-${id}`} aria-selected={pane === id} onClick={() => setPane(id)} className="ps-tab !px-2">
                  <Icon size={15} className="hidden min-[420px]:block" aria-hidden="true" />
                  {label}
                </button>
              );
            })}
          </div>
          <div className="flex flex-none items-center gap-1 border-l-bw-1 border-ink px-1.5">
            <ModeSwitch compact problems={rootDiagnostics.length} />
            {viewCodeButton(true)}
          </div>
          {!staged && lessonButton('flex-none inline-flex items-center gap-1.5 px-3 text-sm font-semibold text-ink border-l-bw-1 border-ink hover:bg-pop-yellow/30', true)}
          {/* In the tab bar, not over the panes. */}
          {hasPartner && <PartnerButton bar open={partnerOpen} onToggle={togglePartner} coach={staged} />}
        </div>
      )}
      </ZenCollapse>

      <AskSelection enabled={hasPartner && staged} onAsk={askPartner} className="flex flex-1 min-h-0">
        <div ref={main} className="flex min-w-0 flex-1 flex-col">
          {body && (
            <div key={editorView ? 'editor' : screen} className={`flex min-h-0 flex-1 flex-col ${editorView ? '' : 'ps-stage-enter'}`}>
              {body}
            </div>
          )}
          {/* Outside the stage's own box, so the lesson stays mounted: hints shown and quick checks answered survive leaving it. */}
          {hasLesson && (
            <LessonHost mode={inLesson ? 'page' : drawer ? 'drawer' : 'closed'} onClose={() => setDrawer(false)} scrollRef={lessonScroll} title={problem.title}>
              <LessonView source={problem.lesson!} onStart={inLesson ? () => openStage(notes.stage) : undefined} startLabel={next?.label} startAtTop={false} large={inLesson} onRead={() => markLessonRead(problem.id)} />
            </LessonHost>
          )}
        </div>
        {!phone && partnerDock}
      </AskSelection>
      {phone && partnerDock}
      {staged && phone && next && !editorView && <StageFoot next={next} />}

      <ZenStatus zen={zen} />
      {tour === 'tour' && editorView && (
        <Suspense fallback={null}>
          <PracticeTour key={tourRun} setPane={setPane} runs={runs} runTests={runNow} onClose={() => setTour(null)} />
        </Suspense>
      )}
    </div>
  );
}

/** Phones only: Reset and Help's items in one menu. */
function MoreMenu({ className, onReset, onTour, onZen }: { className: string; onReset: () => void; onTour: () => void; onZen?: () => void }) {
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
              Start the problem over
            </MenuItem>
            {onZen && (
              <MenuItem
                icon={<Maximize2 size={14} />}
                onSelect={() => {
                  close();
                  onZen();
                }}
              >
                Zen mode
              </MenuItem>
            )}
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
                onFeedback={close}
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

function Statement({ problem, solved, onUseSolution, modes }: { problem: Problem; solved: boolean; onUseSolution: () => void; modes?: ReactNode }) {
  const [hints, setHints] = useState(0);
  const [showSolution, setShowSolution] = useState(false);

  const revealSolution = async () => {
    if (solved || (await confirm({ title: 'Show the reference solution?', body: 'Working it out yourself is where the learning happens.', confirmLabel: 'Show solution' }))) setShowSolution(true);
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

      <details className="rounded-sm border-bw-1 border-ink bg-paper">
        <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-ink">
          <span className={eyebrow}>Given</span> <code className="font-mono">{PROBLEM_FILE}</code> <span className="font-normal text-muted">(read-only)</span>
        </summary>
        <pre className="overflow-x-auto border-t-bw-1 border-ink bg-surface p-3 font-mono text-xs">{problem.given}</pre>
      </details>

      {problem.hints.length > 0 && (
        <div className="space-y-2">
          {problem.hints.slice(0, hints).map((hint, i) => (
            <p key={i} className="flex gap-2 rounded-sm border-bw-1 border-ink bg-pop-yellow/25 px-3 py-2 text-sm text-ink shadow-brutal-sm">
              <Lightbulb size={16} className="mt-0.5 shrink-0" />
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
          <div className="rounded-sm border-bw-1 border-ink bg-paper">
            <div className="flex items-center gap-2 px-3 py-2 border-b-bw-1 border-ink text-sm font-semibold text-ink">
              Reference solution
              <button
                onClick={async () => (await confirm({ title: 'Replace your code with the reference solution?', confirmLabel: 'Replace', tone: 'danger' })) && onUseSolution()}
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
  layoutBusy: boolean;
  engine: Engine;
  onSelect: (loc: SourceLoc) => void;
  /** Zen mode folds the tab bar away. */
  zen: boolean;
  /** The solution's text: the canvas edits it (EditableCanvas), leaving the problem's own nodes alone. */
  source: string;
  onChange: (next: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  phone: boolean;
  /** Code mode: the canvas only looks (EditableCanvas `viewOnly`). */
  viewOnly: boolean;
}

/** The design as a diagram, one scenario played step by step, or its capacity analysis. */
function DiagramPane({ diagram, nodes, edges, fitKey, layoutBusy, engine, onSelect, zen, source, onChange, onUndo, onRedo, phone, viewOnly }: DiagramPaneProps) {
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
            className={`rounded-sm px-2.5 py-1 text-sm font-semibold capitalize border-bw-1 disabled:opacity-40 ${tab === t ? 'border-ink bg-ink text-paper' : 'border-transparent text-ink/75 hover:border-ink hover:text-ink'}`}
          >
            {t}
          </button>
        ))}
        {tab === 'playback' && current && (
          <Select
            size="sm"
            aria-label="Scenario"
            value={current.key}
            onChange={setSelected}
            options={options.map((o) => ({ value: o.key, label: o.useCase.scenarios.length > 1 ? `${o.useCase.name} › ${o.scenario.name}` : o.useCase.name }))}
            className="ml-auto max-w-[60%]"
          />
        )}
      </div>
      </ZenCollapse>
      <div className="flex-1 min-h-0 relative">
        {tab === 'playback' && played ? (
          <UseCasePlayer key={played.id} useCase={played} nodes={nodes} edges={edges} onBack={() => setTab('diagram')} showHeader={false} />
        ) : tab === 'analysis' && analysis ? (
          <AnalysisPanel diagram={diagram} analysis={analysis} onSelect={onSelect} />
        ) : (
          <EditableCanvas
            source={source}
            diagram={diagram}
            onChange={onChange}
            onUndo={onUndo}
            onRedo={onRedo}
            nodes={nodes}
            edges={edges}
            fitKey={fitKey}
            layoutBusy={layoutBusy}
            problemCapacity
            paletteKey="proschi.practice.palette"
            flows
            phone={phone}
            simulate={engine.available ? engine.analyze : undefined}
            viewOnly={viewOnly}
          />
        )}
      </div>
    </div>
  );
}
