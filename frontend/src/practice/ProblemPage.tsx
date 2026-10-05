import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, BookOpen, Code2, Eye, FlaskConical, GraduationCap, Lightbulb, Network, RotateCcw } from 'lucide-react';
import type { Diagnostic, SourceLoc } from '../dsl';
import type { Engine } from '../hld/engine';
import CodeEditor, { type CodeEditorHandle } from '../components/Playground/CodeEditor';
import DiagramCanvas from '../components/Diagram/DiagramCanvas';
import { useDiagramLayout } from '../components/Diagram/useDiagramLayout';
import { UseCasePlayer } from '../components/UseCases/UseCasePlayback';
import AnalysisPanel from '../components/Analysis/AnalysisPanel';
import Markdown from './Markdown';
import LessonView from './LessonView';
import TestPanel from './TestPanel';
import ReviewPanel from '../review/ReviewPanel';
import { practiceReviewInput } from '../review/practice';
import { CompanyBadge, DifficultyBadge, StatusIcon } from './Badges';
import { lessonRead, markLessonRead, sourceOf, statusOf, withRun, withSource, type Progress } from './progress';
import { PROBLEM_FILE, parseSolution, runTests, type DesignMetrics, type RunResult } from './workspace';
import { localDay } from '../learn/streak';
import { recordLocalSolve } from './activity';
import type { Problem } from './types';
import HelpMenu from '../onboarding/HelpMenu';
import Header from '../design/Header';
import { startMode, type StartMode } from '../onboarding/seen';
import type { Account } from './useAccount';
import AccountMenu from './AccountMenu';
import CommunityStats from './CommunityStats';
import { useProblemStats } from './useCommunity';
import { useZenMode } from '../components/Playground/useZenMode';
import { ZenButton, ZenCollapse, ZenStatus } from '../components/Playground/Zen';
import EditorZone from '../components/Playground/EditorZone';
import { eyebrow, field, iconButton, subBar, toolButton } from '../components/Playground/ui';

const PracticeTour = lazy(() => import('../onboarding/PracticeTour'));
// Loaded on a problem's first solve, with the related cards.
const SolveCelebration = lazy(() => import('./SolveCelebration'));

const PARSE_DELAY_MS = 150;

type Pane = 'lesson' | 'statement' | 'code' | 'diagram' | 'tests';

const PANES: { id: Pane; label: string; icon: typeof BookOpen }[] = [
  { id: 'lesson', label: 'Lesson', icon: GraduationCap },
  { id: 'statement', label: 'Problem', icon: BookOpen },
  { id: 'code', label: 'Code', icon: Code2 },
  { id: 'diagram', label: 'Diagram', icon: Network },
  { id: 'tests', label: 'Tests', icon: FlaskConical },
];

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
   * or `unread` until "Start the challenge" was pressed once (from the roadmap).
   */
  openLesson?: 'always' | 'unread';
}

/** The pane a problem opens on. */
function initialPane(problem: Problem, openLesson: ProblemPageProps['openLesson']): Pane {
  if (problem.lesson === undefined || !openLesson) return 'statement';
  return openLesson === 'always' || !lessonRead(problem.id) ? 'lesson' : 'statement';
}

/** LeetCode-like: the statement on the left, the editor and diagram in the middle, tests at the bottom. Tabs on phones. */
export default function ProblemPage({ problem, progress, onProgress, engine, account, back = { href: '#/', label: 'Problems' }, banner, openLesson }: ProblemPageProps) {
  const [source, setSource] = useState(() => sourceOf(progress, problem));
  const [parsedSource, setParsedSource] = useState(source);
  const [run, setRun] = useState<{ result: RunResult; source: string }>();
  const [pane, setPaneState] = useState<Pane>(() => initialPane(problem, openLesson));
  // The left column on desktop: the lesson or the statement (on phones, `pane` alone decides).
  const [aside, setAside] = useState<'lesson' | 'statement'>(() => (pane === 'lesson' ? 'lesson' : 'statement'));
  // Stable, so the tour's steps (which depend on it) are not rebuilt on every render.
  const setPane = useCallback((p: Pane) => {
    setPaneState(p);
    if (p === 'lesson' || p === 'statement') setAside(p);
  }, []);
  const hasLesson = problem.lesson !== undefined;
  const panes = hasLesson ? PANES : PANES.filter((p) => p.id !== 'lesson');
  const startChallenge = () => {
    markLessonRead(problem.id);
    setPane('statement');
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
  const zen = useZenMode();
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

  const runNow = () => {
    // Run on what is in the editor right now, not the debounced parse.
    const result = runTests(parseSolution(problem, source), engine);
    setRun({ result, source });
    setRuns((n) => n + 1);
    const day = localDay();
    if (result.solved && status !== 'solved' && !firstSolve) {
      // Without accounts the streak counts this browser's solves; signed in, the server keeps the day.
      if (account.state.status === 'off') recordLocalSolve(problem.id, day);
      setFirstSolve({ runs: runs + 1, metrics: result.metrics, before: progress });
    }
    if (!result.blocked) {
      onProgress((p) => withRun(p, problem, result.solved));
      void account.recordRun(problem.id, source, result.solved, day).then((record) => {
        const counted = record?.verdict?.solved ? record.progress.runsToSolve : undefined;
        if (counted !== undefined) setFirstSolve((f) => f && { ...f, runs: counted });
        setServerNote(
          result.solved && record?.verdict && !record.verdict.solved
            ? 'The server did not confirm this solve, so it is not in your stats. Reload the page to get the latest version and run the tests again.'
            : undefined,
        );
        setStatsRefresh((n) => n + 1);
      });
    }
    setPane('tests');
  };

  const reset = () => {
    if (window.confirm('Replace your design with the starter code? Your current code is lost.')) setSource(problem.starter);
  };

  const goTo = (loc: SourceLoc | Diagnostic) => {
    if (loc.file !== undefined) return;
    setPane('code');
    editorRef.current?.goTo(loc.line, loc.col);
  };

  const show = (p: Pane) => `${pane === p ? 'flex' : 'hidden'} md:flex`;
  const asideShown = pane === 'lesson' || pane === 'statement';
  const lessonShown = hasLesson && aside === 'lesson';

  return (
    <div className="h-[100dvh] flex flex-col bg-paper text-ink" data-zen={zen.zen || undefined}>
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
        <button onClick={reset} className={`ml-auto ${toolButton}`} title="Start over from the starter code">
          <RotateCcw size={14} />
          <span className="hidden sm:inline">Reset</span>
        </button>
        <ZenButton zen={zen} className={iconButton} />
        <AccountMenu account={account} />
        <HelpMenu
          tourLabel="Take the practice tour"
          onTour={() => {
            setTourRun((n) => n + 1);
            setTour('tour');
          }}
        />
      </Header>
      {banner}

      {/* The design system's tab look (widgets.css); plain buttons so each tab keeps its data-tour target. */}
      <div role="tablist" aria-label="View" className="ps-tabs ps-tabs--fill md:hidden bg-surface">
        {panes.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            data-tour={`tab-${id}`}
            aria-selected={pane === id}
            onClick={() => setPane(id)}
            className={hasLesson ? 'ps-tab !px-2' : 'ps-tab'}
          >
            {/* Five tabs fit a phone only without their icons. */}
            <Icon size={15} className={hasLesson ? 'hidden min-[480px]:block' : undefined} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      </ZenCollapse>

      <div className="flex-1 min-h-0 flex flex-col md:flex-row">
        <aside
          data-tour="statement"
          className={`${asideShown ? 'flex' : 'hidden'} md:flex flex-1 md:flex-none min-h-0 min-w-0 ${lessonShown ? 'md:w-[44%] md:max-w-[760px]' : 'md:w-[32%] md:max-w-[560px]'} flex-col overflow-y-auto md:border-r-bw-2 border-ink bg-surface`}
        >
          {hasLesson && (
            <div role="tablist" aria-label="Lesson or problem" className="hidden md:flex sticky top-0 z-10 gap-1 border-b-bw-1 border-ink bg-surface px-3 py-1.5">
              {(['lesson', 'statement'] as const).map((id) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={aside === id}
                  onClick={() => setPane(id)}
                  className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-semibold border-bw-1 ${aside === id ? 'border-ink bg-ink text-paper' : 'border-transparent text-ink/75 hover:border-ink hover:text-ink'}`}
                >
                  {id === 'lesson' ? <GraduationCap size={15} /> : <BookOpen size={15} />}
                  {id === 'lesson' ? 'Lesson' : 'Problem'}
                </button>
              ))}
            </div>
          )}
          {/* Both stay mounted, so the hints already shown survive switching. */}
          {hasLesson && (
            <div className={`${lessonShown ? '' : 'hidden'} px-4 py-4`}>
              <LessonView source={problem.lesson!} onStart={startChallenge} />
            </div>
          )}
          <div className={lessonShown ? 'hidden' : undefined}>
            <Statement problem={problem} solved={status === 'solved'} onUseSolution={() => setSource(problem.solution)} />
          </div>
        </aside>

        <div className={`${asideShown ? 'hidden' : 'flex'} md:flex flex-1 min-h-0 min-w-0 flex-col`}>
          <div className={`${pane === 'tests' ? 'hidden' : 'flex'} md:flex flex-1 min-h-0 flex-col lg:flex-row`}>
            <EditorZone data-tour="practice-code" className={`${show('code')} flex-1 min-h-0 min-w-0 flex-col lg:border-r-bw-2`}>
              <ZenCollapse zen={zen.zen}>
                <div className="px-3 py-1.5 text-xs font-mono text-muted border-b border-ink/15">
                  solution.proschi <span className="font-sans">· imports</span> {PROBLEM_FILE}
                </div>
              </ZenCollapse>
              <div className="flex-1 min-h-0">
                <CodeEditor ref={editorRef} value={source} onChange={setSource} diagnostics={rootDiagnostics} nodeIds={nodeIds} />
              </div>
            </EditorZone>
            <section className={`${show('diagram')} flex-1 min-h-0 min-w-0 flex-col border-t-bw-2 lg:border-t-0 border-ink`}>
              <DiagramPane diagram={diagram} nodes={nodes} edges={edges} fitKey={`${pane}:${settled}`} engine={engine} onSelect={goTo} zen={zen.zen} />
            </section>
          </div>
          <section data-tour="tests" className={`${show('tests')} flex-1 md:flex-none min-h-0 md:h-[36%] flex-col md:border-t-bw-2 border-ink`}>
            <TestPanel
              run={run?.result}
              stale={!!run && run.source !== source}
              diagnostics={diagnostics}
              onRun={runNow}
              onSelect={goTo}
              review={<ReviewPanel source={source} input={() => practiceReviewInput(problem, source, engine)} onSelect={goTo} />}
              celebration={
                firstSolve && run?.result.solved ? (
                  <Suspense fallback={null}>
                    <SolveCelebration problem={problem} engine={engine} runs={firstSolve.runs} metrics={firstSolve.metrics} before={firstSolve.before} />
                  </Suspense>
                ) : undefined
              }
              community={
                run && !run.result.blocked && (community || serverNote) ? (
                  <>
                    {serverNote && <p className="m-3 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-amber-800 dark:text-amber-200">{serverNote}</p>}
                    {community && <CommunityStats stats={community} canSignIn={account.state.status === 'signed-out' && account.state.providers.length > 0} />}
                  </>
                ) : undefined
              }
            />
          </section>
        </div>
      </div>

      <ZenStatus zen={zen} />
      {tour === 'tour' && (
        <Suspense fallback={null}>
          <PracticeTour key={tourRun} setPane={setPane} runs={runs} runTests={runNow} onClose={() => setTour(null)} />
        </Suspense>
      )}
    </div>
  );
}

function Statement({ problem, solved, onUseSolution }: { problem: Problem; solved: boolean; onUseSolution: () => void }) {
  const [hints, setHints] = useState(0);
  const [showSolution, setShowSolution] = useState(false);

  const revealSolution = () => {
    if (solved || window.confirm('Show the reference solution? Working it out yourself is where the learning happens.')) setShowSolution(true);
  };

  return (
    <div className="px-4 py-4 space-y-5">
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
