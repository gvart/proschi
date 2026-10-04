import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, Code2, Eye, FlaskConical, Lightbulb, Network, RotateCcw } from 'lucide-react';
import type { Diagnostic } from '../dsl';
import type { Engine } from '../hld/engine';
import CodeEditor, { type CodeEditorHandle } from '../components/Playground/CodeEditor';
import DiagramCanvas from '../components/Diagram/DiagramCanvas';
import { useDiagramLayout } from '../components/Diagram/useDiagramLayout';
import { UseCasePlayer } from '../components/UseCases/UseCasePlayback';
import Markdown from './Markdown';
import TestPanel from './TestPanel';
import { DifficultyBadge, StatusIcon } from './Badges';
import { sourceOf, statusOf, withRun, withSource, type Progress } from './progress';
import { PROBLEM_FILE, parseSolution, runTests, type RunResult } from './workspace';
import type { Problem } from './types';

const PARSE_DELAY_MS = 150;

type Pane = 'statement' | 'code' | 'diagram' | 'tests';

const PANES: { id: Pane; label: string; icon: typeof BookOpen }[] = [
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
}

/** LeetCode-like: the statement on the left, the editor and diagram in the middle, tests at the bottom. Tabs on phones. */
export default function ProblemPage({ problem, progress, onProgress, engine }: ProblemPageProps) {
  const [source, setSource] = useState(() => sourceOf(progress, problem));
  const [parsedSource, setParsedSource] = useState(source);
  const [run, setRun] = useState<{ result: RunResult; source: string }>();
  const [pane, setPane] = useState<Pane>('statement');
  const editorRef = useRef<CodeEditorHandle>(null);
  const status = statusOf(progress, problem.id);

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
  const { nodes, edges } = useDiagramLayout(diagram);

  const runNow = () => {
    // Run on what is in the editor right now, not the debounced parse.
    const result = runTests(parseSolution(problem, source), engine);
    setRun({ result, source });
    if (!result.blocked) onProgress((p) => withRun(p, problem, result.solved));
    setPane('tests');
  };

  const reset = () => {
    if (window.confirm('Replace your design with the starter code? Your current code is lost.')) setSource(problem.starter);
  };

  const selectDiagnostic = (d: Diagnostic) => {
    if (d.file !== undefined) return;
    setPane('code');
    editorRef.current?.goTo(d.line, d.col);
  };

  const show = (p: Pane) => `${pane === p ? 'flex' : 'hidden'} md:flex`;

  return (
    <div className="h-[100dvh] flex flex-col bg-gray-50">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 sm:px-4 py-2 bg-white border-b border-gray-200">
        <a href="#/" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-blue-700">
          <ArrowLeft size={16} />
          <span className="hidden sm:inline">Problems</span>
        </a>
        <h1 className="flex items-center gap-2 min-w-0 font-semibold text-gray-900">
          <StatusIcon status={status} />
          <span className="truncate">{problem.title}</span>
        </h1>
        <DifficultyBadge difficulty={problem.difficulty} />
        <button onClick={reset} className="ml-auto inline-flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded-md text-gray-700 hover:bg-gray-100" title="Start over from the starter code">
          <RotateCcw size={14} />
          <span className="hidden sm:inline">Reset</span>
        </button>
      </header>

      <div role="tablist" aria-label="View" className="md:hidden flex bg-white border-b border-gray-200">
        {PANES.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={pane === id}
            onClick={() => setPane(id)}
            className={`flex-1 inline-flex items-center justify-center gap-1 py-2.5 text-sm font-medium border-b-2 ${pane === id ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500'}`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 flex flex-col md:flex-row">
        <aside className={`${show('statement')} flex-1 md:flex-none min-h-0 md:w-[32%] md:max-w-[560px] flex-col overflow-y-auto border-gray-200 md:border-r bg-white`}>
          <Statement problem={problem} solved={status === 'solved'} onUseSolution={() => setSource(problem.solution)} />
        </aside>

        <div className={`${pane === 'statement' ? 'hidden' : 'flex'} md:flex flex-1 min-h-0 min-w-0 flex-col`}>
          <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
            <section className={`${show('code')} flex-1 min-h-0 min-w-0 flex-col bg-white lg:border-r border-gray-200`}>
              <div className="px-3 py-1.5 text-xs text-gray-500 border-b border-gray-100">
                solution.proschi · imports <code>{PROBLEM_FILE}</code>
              </div>
              <div className="flex-1 min-h-0">
                <CodeEditor ref={editorRef} value={source} onChange={setSource} diagnostics={rootDiagnostics} nodeIds={nodeIds} />
              </div>
            </section>
            <section className={`${show('diagram')} flex-1 min-h-0 min-w-0 flex-col border-t lg:border-t-0 border-gray-200`}>
              <DiagramPane diagram={diagram} nodes={nodes} edges={edges} fitKey={pane} />
            </section>
          </div>
          <section className={`${show('tests')} flex-1 md:flex-none min-h-0 md:h-[36%] flex-col border-t border-gray-200`}>
            <TestPanel run={run?.result} stale={!!run && run.source !== source} diagnostics={diagnostics} onRun={runNow} onSelectDiagnostic={selectDiagnostic} />
          </section>
        </div>
      </div>
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
      <Markdown source={problem.statement} />

      <details className="rounded-md border border-gray-200">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-gray-700">
          Given: <code>{PROBLEM_FILE}</code> <span className="font-normal text-gray-400">(read-only)</span>
        </summary>
        <pre className="overflow-x-auto border-t border-gray-200 bg-gray-50 p-3 font-mono text-xs">{problem.given}</pre>
      </details>

      {problem.hints.length > 0 && (
        <div className="space-y-2">
          {problem.hints.slice(0, hints).map((hint, i) => (
            <p key={i} className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <Lightbulb size={16} className="mt-0.5 flex-shrink-0" />
              <span>
                <strong>Hint {i + 1}.</strong> {hint}
              </span>
            </p>
          ))}
          {hints < problem.hints.length && (
            <button onClick={() => setHints((n) => n + 1)} className="inline-flex items-center gap-1.5 text-sm text-amber-800 hover:underline">
              <Lightbulb size={14} />
              {hints === 0 ? 'Show a hint' : 'Show another hint'} ({hints} / {problem.hints.length})
            </button>
          )}
        </div>
      )}

      <div>
        {showSolution ? (
          <div className="rounded-md border border-gray-200">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 text-sm font-medium text-gray-700">
              Reference solution
              <button
                onClick={() => window.confirm('Replace your code with the reference solution?') && onUseSolution()}
                className="ml-auto text-xs font-normal text-blue-700 hover:underline"
              >
                Load into the editor
              </button>
            </div>
            <pre className="overflow-x-auto bg-gray-50 p-3 font-mono text-xs">{problem.solution}</pre>
          </div>
        ) : (
          <button onClick={revealSolution} className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900">
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
}

/** The design as a diagram, or one scenario played step by step. */
function DiagramPane({ diagram, nodes, edges, fitKey }: DiagramPaneProps) {
  const [tab, setTab] = useState<'diagram' | 'playback'>('diagram');
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
      <div className="flex items-center gap-1 px-2 py-1.5 bg-white border-b border-gray-200">
        {(['diagram', 'playback'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            disabled={t === 'playback' && !current}
            className={`rounded-md px-2.5 py-1 text-sm capitalize disabled:opacity-40 ${tab === t ? 'bg-gray-100 font-medium text-gray-900' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            {t}
          </button>
        ))}
        {tab === 'playback' && current && (
          <select
            aria-label="Scenario"
            value={current.key}
            onChange={(e) => setSelected(e.target.value)}
            className="ml-auto min-w-0 max-w-[60%] text-sm border border-gray-300 rounded-md px-2 py-1 bg-white"
          >
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.useCase.scenarios.length > 1 ? `${o.useCase.name} › ${o.scenario.name}` : o.useCase.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="flex-1 min-h-0 relative">
        {tab === 'playback' && played ? (
          <UseCasePlayer key={played.id} useCase={played} nodes={nodes} edges={edges} onBack={() => setTab('diagram')} showHeader={false} />
        ) : (
          <DiagramCanvas nodes={nodes} edges={edges} fitKey={fitKey} />
        )}
        {nodes.length === 0 && tab === 'diagram' && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-gray-400 pointer-events-none">Your design appears here as you type.</p>
        )}
      </div>
    </div>
  );
}
