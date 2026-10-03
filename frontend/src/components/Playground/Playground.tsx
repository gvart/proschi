import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useNodesInitialized,
  useReactFlow,
} from 'reactflow';
import type { Edge, EdgeChange, Node, NodeChange } from 'reactflow';
import 'reactflow/dist/style.css';
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  FilePlus,
  Image,
  LayoutGrid,
  Link,
  Play,
  Trash2,
  Upload,
  Code2,
  Pencil,
  Network,
} from 'lucide-react';
import { ecommerceExample, parse, type Diagnostic, type DiagramScenario, type DiagramUseCase } from '../../dsl';
import { layoutDiagram, toFlowEdges } from '../../dsl/layout';
import { loadJson, saveJson } from '../../services/storage';
import {
  BLANK_SOURCE,
  addDoc,
  addFile,
  currentDoc,
  fileNameOf,
  initialState,
  removeDoc,
  selectDoc,
  titleOf,
  updateCurrent,
  type DocumentState,
} from '../../playground/documents';
import { groupByEndpoint } from '../../playground/useCaseGroups';
import { filesResolver, importableFiles, usedImports } from '../../playground/imports';
import { decodeShareLink, encodeShareHash, shareUrl, type PlaybackTarget } from '../../playground/share';
import { addConnection, clearPositions, removeConnections, removeNode, renameNode, setNodePosition } from '../../dsl/edit';
import ComponentNode from '../Canvas/ComponentNode';
import GroupNode from '../Canvas/GroupNode';
import TextNode from '../Canvas/TextNode';
import { UseCasePlayer } from '../UseCases/UseCasePlayback';
import CodeEditor, { type CodeEditorHandle } from './CodeEditor';
import ExamplesGallery from './ExamplesGallery';
import Menu, { MenuItem } from './Menu';
import { downloadText, exportImage, fileNameFor } from './exportDiagram';

const DOCS_KEY = 'proschi.docs';
const LEGACY_SOURCE_KEY = 'proschi.playground.source';
const PARSE_DELAY_MS = 150;

const nodeTypes = {
  componentNode: ComponentNode,
  groupNode: GroupNode,
  textNode: TextNode,
};

function loadInitialState(): DocumentState {
  const link = decodeShareLink(window.location.hash);
  return initialState({
    stored: loadJson<DocumentState | null>(DOCS_KEY, null),
    legacySource: loadJson<string | null>(LEGACY_SOURCE_KEY, null),
    sharedSource: link?.source ?? null,
    sharedImports: link?.imports,
    fallbackSource: ecommerceExample,
  });
}

interface PlaygroundProps {
  onOpenBuilder: () => void;
}

export default function Playground({ onOpenBuilder }: PlaygroundProps) {
  const [docState, setDocState] = useState(loadInitialState);
  const current = currentDoc(docState);
  const source = current.source;
  const rootPath = fileNameOf(current);
  const setSource = useCallback((next: string) => setDocState((s) => updateCurrent(s, next)), []);
  /** Applies a canvas edit to the current document's text. */
  const editSource = useCallback(
    (edit: (source: string) => string) => setDocState((s) => updateCurrent(s, edit(currentDoc(s).source))),
    [],
  );

  // A link may point at a use case step; open straight into playback there.
  const [linkPlayback] = useState(() => decodeShareLink(window.location.hash)?.playback);
  const [parsedSource, setParsedSource] = useState(source);
  const [selectedUseCaseId, setSelectedUseCaseId] = useState<string | undefined>(linkPlayback?.useCase);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | undefined>(linkPlayback?.scenario);
  const [playing, setPlaying] = useState(!!linkPlayback);
  const [initialStep, setInitialStep] = useState(linkPlayback ? linkPlayback.step - 1 : undefined);
  const [playStep, setPlayStep] = useState(0);
  const [showExamples, setShowExamples] = useState(false);
  // Phones show one pane at a time.
  const [mobilePane, setMobilePane] = useState<'code' | 'diagram'>('diagram');
  const [copied, setCopied] = useState(false);
  const editorRef = useRef<CodeEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Re-parse and save shortly after typing stops.
  useEffect(() => {
    const timer = setTimeout(() => {
      setParsedSource(source);
      saveJson(DOCS_KEY, docState);
    }, PARSE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [source, docState]);

  // Imports resolve against the other diagrams saved in this browser. Comparing them
  // by value keeps typing in the current diagram from re-parsing before the debounce.
  const importableKey = JSON.stringify(importableFiles(docState.docs, current));
  const parsed = useMemo(
    () => parse(parsedSource, { path: rootPath, resolve: filesResolver(JSON.parse(importableKey), rootPath) }),
    [parsedSource, rootPath, importableKey],
  );
  const { diagram, diagnostics } = parsed;
  const imports = useMemo(() => usedImports(parsed, JSON.parse(importableKey), rootPath), [parsed, importableKey, rootPath]);
  const importsKey = JSON.stringify(imports);
  const rootDiagnostics = useMemo(() => diagnostics.filter((d) => d.file === undefined), [diagnostics]);
  /** Nodes declared in imported files (id → file); canvas edits leave them alone. */
  const importedNodes = useMemo(() => new Map(diagram.nodes.flatMap((n) => (n.loc.file ? [[n.id, n.loc.file] as const] : []))), [diagram]);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  const nodeIds = useMemo(() => diagram.nodes.map((n) => n.id), [diagram]);
  const useCase = diagram.useCases.find((u) => u.id === selectedUseCaseId) ?? diagram.useCases[0];
  const scenario = useCase?.scenarios.find((s) => s.id === selectedScenarioId) ?? useCase?.scenarios[0];
  const hasScenarios = (useCase?.scenarios.length ?? 0) > 1;
  const playback: PlaybackTarget | undefined =
    playing && useCase ? { useCase: useCase.id, ...(hasScenarios && scenario ? { scenario: scenario.id } : {}), step: playStep + 1 } : undefined;
  const playbackKey = playback ? `${playback.useCase}/${playback.scenario ?? ''}#${playback.step}` : '';
  const useCaseGroups = useMemo(() => groupByEndpoint(diagram.useCases), [diagram]);
  // The player restarts when this changes, so each scenario starts at its first step.
  const playedUseCase = useMemo(
    () => (useCase && scenario ? { id: `${useCase.id}/${scenario.id}`, name: useCase.name, steps: scenario.steps } : undefined),
    [useCase, scenario],
  );

  // Keep the address bar a shareable link to the diagram, and to the current step while playing.
  useEffect(() => {
    const timer = setTimeout(() => {
      window.history.replaceState(null, '', encodeShareHash(source, playback, imports));
    }, PARSE_DELAY_MS);
    return () => clearTimeout(timer);
    // playbackKey and importsKey capture playback and imports by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, playbackKey, importsKey]);

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  // Edges are local state so selection works; keep it across re-parses.
  useEffect(() => {
    setEdges((previous) => {
      const selected = new Set(previous.filter((e) => e.selected).map((e) => e.id));
      return toFlowEdges(diagram).map((e) => (selected.has(e.id) ? { ...e, selected: true } : e));
    });
  }, [diagram]);

  useEffect(() => {
    let cancelled = false;
    layoutDiagram(diagram)
      .then((laidOut) => {
        if (cancelled) return;
        // Keep what the user had selected across re-layouts.
        setNodes((previous) => {
          const selected = new Set(previous.filter((n) => n.selected).map((n) => n.id));
          return laidOut.map((n) => (selected.has(n.id) ? { ...n, selected: true } : n));
        });
      })
      .catch((error) => console.error('Layout failed:', error));
    return () => {
      cancelled = true;
    };
  }, [diagram]);

  const stopPlaying = () => {
    setPlaying(false);
    setInitialStep(undefined);
  };

  const openDoc = (update: (s: DocumentState) => DocumentState) => {
    setDocState(update);
    stopPlaying();
    setSelectedUseCaseId(undefined);
    setSelectedScenarioId(undefined);
  };

  const deleteDoc = (id: string, title: string) => {
    if (window.confirm(`Delete "${title}"? This cannot be undone.`)) openDoc((s) => removeDoc(s, id));
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    openDoc((s) => addFile(s, text, file.name));
  };

  const copyShareLink = async () => {
    const url = shareUrl(source, window.location, playback, imports);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this link:', url);
    }
  };

  const deleteFromCanvas = (nodeIds: string[], edgeIds: string[]) => {
    const selectedEdges = diagram.edges.filter((e) => edgeIds.includes(e.id));
    const importedNode = nodeIds.find((id) => importedNodes.has(id));
    const importedEdge = selectedEdges.find((e) => e.loc.file);
    if (importedNode || importedEdge) {
      setNotice(`Declared in ${importedNode ? importedNodes.get(importedNode) : importedEdge!.loc.file}; delete it there.`);
      return;
    }
    // removeNode only sees this document's use cases.
    const usedElsewhere = diagram.useCases.find(
      (u) => u.loc.file && u.scenarios.some((sc) => sc.steps.some((s) => nodeIds.includes(s.fromServiceId) || nodeIds.includes(s.toServiceId))),
    );
    if (usedElsewhere) {
      setNotice(`Used in the use case "${usedElsewhere.name}" in ${usedElsewhere.loc.file}; remove those steps first.`);
      return;
    }
    // Edge ids count duplicates across every file; the text edit needs this document's own ids.
    const rootEdges = parse(source).diagram.edges;
    const rootIds = selectedEdges.flatMap((e) => rootEdges.filter((r) => r.loc.line === e.loc.line).map((r) => r.id));
    let next = removeConnections(source, rootIds);
    for (const id of nodeIds) {
      const result = removeNode(next, id);
      if (result.error !== undefined) {
        window.alert(result.error);
        return;
      }
      next = result.source;
    }
    setSource(next);
  };

  const startPlaying = () => {
    setPlaying(true);
    setMobilePane('diagram');
  };

  const pickScenario = (id: string) => {
    setSelectedScenarioId(id);
    setInitialStep(undefined);
    if (!playing) startPlaying();
  };

  const moveNodes = (moved: { id: string; position: { x: number; y: number } }[]) => {
    const own = moved.filter((n) => !importedNodes.has(n.id));
    if (own.length > 0) editSource((src) => own.reduce((acc, n) => setNodePosition(acc, n.id, n.position), src));
  };

  const renameFromCanvas = (id: string, name: string) => {
    const file = importedNodes.get(id);
    if (file) setNotice(`'${id}' is declared in ${file}; rename it there.`);
    else editSource((src) => renameNode(src, id, name));
  };

  const connectNodes = (from: string, to: string) => {
    // The connection may already exist in an imported file.
    if (diagram.edges.some((e) => e.source === from && e.target === to)) return;
    editSource((src) => addConnection(src, from, to));
  };

  /** A problem in an imported file opens that file, if it is saved in this browser. */
  const selectDiagnostic = (d: Diagnostic) => {
    if (d.file === undefined) {
      editorRef.current?.goTo(d.line, d.col);
      return;
    }
    const target = docState.docs.find((doc) => doc.id !== current.id && fileNameOf(doc) === d.file);
    if (target && !current.imports?.[d.file]) openDoc((s) => selectDoc(s, target.id));
  };

  const canPlay = !!scenario && scenario.steps.length > 0;
  const problemCount = diagnostics.length;
  const sortedDocs = [...docState.docs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <div className="h-[100dvh] flex flex-col bg-gray-50">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3 sm:px-4 py-2 bg-white border-b border-gray-200">
        <div className="flex items-center gap-1 min-w-0 flex-1 sm:flex-none">
          <a href="../" title="About Proschi" className="text-lg font-bold text-gray-900 mr-1 hover:text-blue-700">
            Proschi
          </a>

          <Menu
            label="Diagrams"
            trigger={
              <>
                <span className="max-w-[10rem] sm:max-w-[14rem] truncate">{titleOf(source)}</span>
                <ChevronDown size={14} />
              </>
            }
          >
            {(close) => (
              <>
                <div className="px-3 pt-1 pb-1.5 text-xs font-medium uppercase tracking-wide text-gray-400">Saved in this browser</div>
                <ul className="max-h-72 overflow-y-auto">
                  {sortedDocs.map((doc) => {
                    const title = titleOf(doc.source);
                    return (
                      <li key={doc.id} className="group flex items-center">
                        <button
                          role="menuitem"
                          onClick={() => {
                            openDoc((s) => selectDoc(s, doc.id));
                            close();
                          }}
                          className={`flex-1 min-w-0 px-3 py-1.5 text-left text-sm hover:bg-gray-100 ${doc.id === docState.currentId ? 'font-semibold text-blue-700' : 'text-gray-700'}`}
                        >
                          <span className="block truncate">{title}</span>
                          <span className="block truncate text-xs font-normal text-gray-400">
                            {fileNameOf(doc)} · {new Date(doc.updatedAt).toLocaleString()}
                          </span>
                        </button>
                        <button
                          aria-label={`Delete ${title}`}
                          onClick={() => deleteDoc(doc.id, title)}
                          className="mr-1 p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
                        >
                          <Trash2 size={14} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <div className="my-1 border-t border-gray-100" />
                <MenuItem
                  icon={<FilePlus size={14} />}
                  onSelect={() => {
                    openDoc((s) => addDoc(s, BLANK_SOURCE));
                    close();
                  }}
                >
                  New diagram
                </MenuItem>
                <MenuItem
                  icon={<Upload size={14} />}
                  onSelect={() => {
                    fileInputRef.current?.click();
                    close();
                  }}
                >
                  Open .proschi file…
                </MenuItem>
                <MenuItem
                  icon={<Download size={14} />}
                  onSelect={() => {
                    downloadText(source, rootPath);
                    close();
                  }}
                >
                  Download .proschi file
                </MenuItem>
                <div className="my-1 border-t border-gray-100" />
                <MenuItem
                  icon={<Network size={14} />}
                  onSelect={() => {
                    close();
                    onOpenBuilder();
                  }}
                >
                  Visual builder (classic)
                </MenuItem>
              </>
            )}
          </Menu>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".proschi,.txt,text/plain"
          className="hidden"
          onChange={(e) => {
            importFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />

        <div className="flex items-center gap-2 w-full sm:w-auto sm:ml-auto">
          <button
            onClick={() => setShowExamples(true)}
            aria-label="Examples"
            className="inline-flex items-center gap-1.5 text-sm px-2.5 py-2 sm:py-1.5 rounded-md text-gray-700 hover:bg-gray-100"
          >
            <BookOpen size={16} />
            <span className="hidden sm:inline">Examples</span>
          </button>

          <select
            aria-label="Use case"
            value={useCase?.id ?? ''}
            onChange={(e) => {
              setSelectedUseCaseId(e.target.value);
              setSelectedScenarioId(undefined);
              setInitialStep(undefined);
            }}
            disabled={diagram.useCases.length === 0}
            className="flex-1 min-w-0 sm:flex-none sm:max-w-[16rem] text-sm border border-gray-300 rounded-md px-2 py-2 sm:py-1.5 bg-white disabled:text-gray-400"
          >
            {diagram.useCases.length === 0 && <option value="">No use cases</option>}
            {useCaseGroups.map((group) =>
              group.label ? (
                <optgroup key={group.label} label={group.label}>
                  {group.useCases.map((u) => (
                    <UseCaseOption key={u.id} useCase={u} />
                  ))}
                </optgroup>
              ) : (
                group.useCases.map((u) => <UseCaseOption key={u.id} useCase={u} />)
              ),
            )}
          </select>

          {playing ? (
            <button
              onClick={stopPlaying}
              aria-label="Back to diagram"
              className="inline-flex items-center gap-1.5 text-sm px-3 py-2 sm:py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              <LayoutGrid size={16} />
              <span className="hidden sm:inline">Diagram</span>
            </button>
          ) : (
            <button
              onClick={startPlaying}
              disabled={!canPlay}
              aria-label="Play"
              title={canPlay ? 'Play this use case' : 'Add a usecase with steps to play it'}
              className="inline-flex items-center gap-1.5 text-sm px-3 py-2 sm:py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play size={16} />
              <span className="hidden sm:inline">Play</span>
            </button>
          )}

          <button
            onClick={copyShareLink}
            aria-label={copied ? 'Copied' : 'Share'}
            title={playing ? 'Copy a link to this step of the use case' : 'Copy a link that contains this diagram'}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-2 sm:py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            {copied ? <Check size={16} className="text-green-600" /> : <Link size={16} />}
            <span className="hidden sm:inline">{copied ? 'Copied' : 'Share'}</span>
          </button>
        </div>
      </header>

      <div role="tablist" aria-label="View" className="md:hidden flex bg-white border-b border-gray-200">
        {(['code', 'diagram'] as const).map((pane) => (
          <button
            key={pane}
            role="tab"
            aria-selected={mobilePane === pane}
            onClick={() => setMobilePane(pane)}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium border-b-2 ${mobilePane === pane ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500'}`}
          >
            {pane === 'code' ? <Code2 size={16} /> : <Network size={16} />}
            {pane === 'code' ? 'Code' : playing ? 'Playback' : 'Diagram'}
            {pane === 'code' && problemCount > 0 && (
              <span className="ml-0.5 rounded-full bg-amber-100 px-1.5 text-xs text-amber-800">{problemCount}</span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 flex flex-col md:flex-row">
        <section
          className={`${mobilePane === 'code' ? 'flex' : 'hidden'} md:flex flex-1 md:flex-none min-h-0 md:w-[42%] md:max-w-[720px] flex-col md:border-r border-gray-200 bg-white`}
        >
          <div className="flex-1 min-h-0">
            <CodeEditor ref={editorRef} value={source} onChange={setSource} diagnostics={rootDiagnostics} nodeIds={nodeIds} />
          </div>
          <DiagnosticsPanel diagnostics={diagnostics} onSelect={selectDiagnostic} />
        </section>

        <section className={`${mobilePane === 'diagram' ? 'flex' : 'hidden'} md:flex flex-col flex-1 min-h-0 min-w-0`}>
          {hasScenarios && useCase && scenario && (
            <ScenarioBar useCase={useCase} current={playing ? scenario.id : undefined} onPick={pickScenario} />
          )}
          <div className="flex-1 min-h-0 relative">
            {playing && playedUseCase ? (
              <UseCasePlayer
                useCase={playedUseCase}
                nodes={nodes}
                edges={edges}
                onBack={stopPlaying}
                initialStep={initialStep}
                onStepChange={setPlayStep}
                showHeader={false}
              />
            ) : (
              <ReactFlowProvider>
                <DiagramView
                  nodes={nodes}
                  edges={edges}
                  onNodesChange={setNodes}
                  onEdgesChange={setEdges}
                  title={diagram.title}
                  hasPinnedNodes={diagram.nodes.some((n) => n.position)}
                  importedNodes={importedNodes}
                  onMoveNodes={moveNodes}
                  onConnectNodes={connectNodes}
                  onRenameNode={renameFromCanvas}
                  onResetLayout={() => editSource(clearPositions)}
                  onDelete={deleteFromCanvas}
                  fitKey={mobilePane}
                  notice={notice}
                  onNotice={setNotice}
                />
              </ReactFlowProvider>
            )}
            {nodes.length === 0 && !playing && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="text-sm text-gray-400">
                  Start typing, e.g. <code className="px-1 bg-gray-100 rounded">api -&gt; db</code>
                </p>
              </div>
            )}
          </div>
        </section>
      </div>

      {showExamples && (
        <ExamplesGallery
          onClose={() => setShowExamples(false)}
          onPick={(example) => {
            openDoc((s) => addDoc(s, example.source));
            setShowExamples(false);
          }}
        />
      )}
    </div>
  );
}

function UseCaseOption({ useCase }: { useCase: DiagramUseCase }) {
  const count = useCase.scenarios.length;
  return (
    <option value={useCase.id}>
      {count > 1 ? `${useCase.name} · ${count} scenarios` : useCase.name}
    </option>
  );
}

interface ScenarioBarProps {
  useCase: DiagramUseCase;
  /** The scenario being played, if any. */
  current?: string;
  onPick: (id: string) => void;
}

/** One tab per scenario of the selected use case; picking one plays it. */
function ScenarioBar({ useCase, current, onPick }: ScenarioBarProps) {
  const activeRef = useRef<HTMLButtonElement>(null);
  // On narrow screens the bar scrolls sideways; keep the playing scenario in view.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [current]);

  return (
    <div
      role="tablist"
      aria-label={`Scenarios of ${useCase.name}`}
      className="flex items-center gap-1 px-2 py-1.5 bg-white border-b border-gray-200 overflow-x-auto"
    >
      <span className="hidden sm:inline px-1.5 text-xs font-medium uppercase tracking-wide text-gray-400 flex-shrink-0">Scenarios</span>
      {useCase.scenarios.map((s: DiagramScenario) => {
        const active = s.id === current;
        const error = s.outcome === 'error';
        const status = s.steps[0]?.failed ? 'failed' : s.steps[0]?.statusCode;
        return (
          <button
            key={s.id}
            ref={active ? activeRef : undefined}
            role="tab"
            aria-selected={active}
            onClick={() => onPick(s.id)}
            title={`Play “${s.name}”`}
            className={`flex-shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 sm:py-1 text-sm whitespace-nowrap ${
              active
                ? error
                  ? 'border-red-600 bg-red-50 text-red-800'
                  : 'border-blue-600 bg-blue-50 text-blue-800'
                : 'border-gray-200 text-gray-700 hover:bg-gray-50'
            }`}
          >
            <span aria-hidden="true" className={`h-2 w-2 rounded-full ${error ? 'bg-red-500' : 'bg-green-500'}`} />
            {s.name}
            {status !== undefined && <span className={`text-xs tabular-nums ${error ? 'text-red-600' : 'text-gray-400'}`}>{status}</span>}
            <span className="sr-only">{error ? '(error path)' : '(success path)'}</span>
          </button>
        );
      })}
    </div>
  );
}

interface DiagramViewProps {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: (update: (nodes: Node[]) => Node[]) => void;
  onEdgesChange: (update: (edges: Edge[]) => Edge[]) => void;
  title?: string;
  hasPinnedNodes: boolean;
  onMoveNodes: (moved: { id: string; position: { x: number; y: number } }[]) => void;
  onConnectNodes: (from: string, to: string) => void;
  onRenameNode: (id: string, name: string) => void;
  onResetLayout: () => void;
  onDelete: (nodeIds: string[], edgeIds: string[]) => void;
  /** Changes when the view becomes visible again, so it can re-fit. */
  fitKey: string;
  /** Nodes declared in imported files (id → file); they cannot be moved here. */
  importedNodes: Map<string, string>;
  /** A short message shown over the canvas, e.g. why an edit was refused. */
  notice: string | null;
  onNotice: (message: string) => void;
}

/** Renders the parsed diagram. Canvas edits are written back to the text, which stays the source of truth. */
function DiagramView({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  title,
  hasPinnedNodes,
  onMoveNodes,
  onConnectNodes,
  onRenameNode,
  onResetLayout,
  onDelete,
  fitKey,
  importedNodes,
  notice,
  onNotice,
}: DiagramViewProps) {
  const { fitView, getNodes } = useReactFlow();
  const [selection, setSelection] = useState<{ nodes: Node[]; edges: Edge[] }>({ nodes: [], edges: [] });
  const dragStartRef = useRef(new Map<string, { x: number; y: number }>());

  // React Flow re-sends the selection when this handler changes, so it must be stable
  // and must not store an equal selection again.
  const handleSelectionChange = useCallback(({ nodes: selectedNodes, edges: selectedEdges }: { nodes: Node[]; edges: Edge[] }) => {
    setSelection((current) => {
      const same =
        current.nodes.map((n) => n.id).join('|') === selectedNodes.map((n) => n.id).join('|') &&
        current.edges.map((e) => e.id).join('|') === selectedEdges.map((e) => e.id).join('|');
      return same ? current : { nodes: selectedNodes, edges: selectedEdges };
    });
  }, []);

  const promptRename = (node: Node) => {
    // Ask the parent straight away, which explains why a node from an imported file cannot be renamed.
    if (importedNodes.has(node.id)) return onRenameNode(node.id, '');
    const name = window.prompt('Display name', node.data?.name ?? node.id);
    if (name !== null) onRenameNode(node.id, name);
  };

  const deleteSelection = () => {
    if (selection.nodes.length === 0 && selection.edges.length === 0) return;
    onDelete(
      selection.nodes.map((n) => n.id),
      selection.edges.map((e) => e.id).filter((id) => !id.startsWith('step:')),
    );
  };
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  const handleExport = async (format: 'png' | 'svg') => {
    const viewport = wrapperRef.current?.querySelector<HTMLElement>('.react-flow__viewport');
    if (!viewport || nodes.length === 0) return;
    setExporting(true);
    try {
      await exportImage(format, getNodes(), viewport, fileNameFor(title, format));
    } catch (error) {
      console.error('Export failed:', error);
      window.alert('Sorry, the image could not be exported.');
    } finally {
      setExporting(false);
    }
  };
  const measured = useNodesInitialized();
  const structure = nodes.map((n) => n.id).join('|');

  // Re-fit once nodes are measured after being added or removed, not on every drag.
  useEffect(() => {
    if (!measured) return;
    const frame = requestAnimationFrame(() => {
      // A hidden pane (the other mobile tab) has no size; fitting it would produce NaN.
      if (!wrapperRef.current?.offsetWidth) return;
      fitView({ padding: 0.15, duration: 200 });
    });
    return () => cancelAnimationFrame(frame);
  }, [structure, measured, fitView, fitKey]);

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => onEdgesChange((current) => applyEdgeChanges(changes, current)),
    [onEdgesChange],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => onNodesChange((current) => applyNodeChanges(changes, current)),
    [onNodesChange],
  );

  return (
    <div
      ref={wrapperRef}
      className="h-full"
      onKeyDown={(e) => {
        const target = e.target as HTMLElement;
        if ((e.key === 'Delete' || e.key === 'Backspace') && !target.closest('input, textarea, [contenteditable]')) {
          e.preventDefault();
          deleteSelection();
        }
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onNodeDragStart={(_event, _node, dragged) => {
          dragStartRef.current = new Map(dragged.map((n) => [n.id, { ...n.position }]));
        }}
        onNodeDragStop={(_event, _node, dragged) => {
          // A click is a drag that never moved; only real moves are written to the text.
          const moved = dragged.filter((n) => {
            const start = dragStartRef.current.get(n.id);
            return !start || Math.abs(start.x - n.position.x) > 1 || Math.abs(start.y - n.position.y) > 1;
          });
          // Nodes from imported files snap back: their text is in another file.
          const locked = moved.filter((n) => importedNodes.has(n.id));
          if (locked.length > 0) {
            const back = new Map(locked.map((n) => [n.id, dragStartRef.current.get(n.id)]));
            onNodesChange((current) => current.map((n) => {
              const start = back.get(n.id);
              return start ? { ...n, position: start } : n;
            }));
            onNotice(`'${locked[0].id}' is declared in ${importedNodes.get(locked[0].id)}; move it there.`);
          }
          if (moved.length > locked.length) onMoveNodes(moved.map((n) => ({ id: n.id, position: n.position })));
        }}
        onConnect={(connection) => connection.source && connection.target && onConnectNodes(connection.source, connection.target)}
        onNodeDoubleClick={(_event, node) => promptRename(node)}
        onSelectionChange={handleSelectionChange}
        // Deleting goes through the text; React Flow's own delete would only hide the node until the next render.
        deleteKeyCode={null}
        zoomOnDoubleClick={false}
        fitView
        minZoom={0.1}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls showInteractive={false} />
        {(selection.nodes.length > 0 || selection.edges.length > 0) && (
          <Panel position="top-left" className="flex items-center gap-1 rounded-md border border-gray-200 bg-white p-1 shadow-sm">
            <span className="px-2 text-xs text-gray-500">
              {selection.nodes.length === 1 && selection.edges.length === 0
                ? (selection.nodes[0].data?.name ?? selection.nodes[0].id)
                : `${selection.nodes.length + selection.edges.length} selected`}
            </span>
            {selection.nodes.length === 1 && selection.edges.length === 0 && (
              <button
                onClick={() => promptRename(selection.nodes[0])}
                className="inline-flex items-center gap-1 rounded px-2.5 py-2 sm:py-1 text-sm text-gray-700 hover:bg-gray-100"
              >
                <Pencil size={14} />
                Rename
              </button>
            )}
            <button
              onClick={deleteSelection}
              className="inline-flex items-center gap-1 rounded px-2.5 py-2 sm:py-1 text-sm text-red-600 hover:bg-red-50"
            >
              <Trash2 size={14} />
              Delete
            </button>
          </Panel>
        )}
        {notice && (
          <Panel position="bottom-center" role="status" className="rounded-md bg-gray-900/90 px-3 py-1.5 text-xs text-white shadow">
            {notice}
          </Panel>
        )}
        {nodes.length > 0 && (
          <Panel position="bottom-right" className="hidden md:block text-xs text-gray-400 bg-white/80 rounded px-2 py-1">
            Drag to pin · double-click to rename · drag between dots to connect · Delete removes
          </Panel>
        )}
        {nodes.length > 0 && (
          <Panel position="top-right" className="flex items-center gap-1">
            {hasPinnedNodes && (
              <button
                onClick={onResetLayout}
                title="Remove every pos x,y and lay the diagram out automatically"
                className="inline-flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded-md text-gray-700 hover:bg-gray-100"
              >
                <LayoutGrid size={16} />
                Auto-layout
              </button>
            )}
            <Menu
              label="Export image"
              align="right"
              trigger={
                <>
                  <Image size={16} />
                  {exporting ? 'Exporting…' : 'Export'}
                </>
              }
            >
              {(close) => (
                <>
                  <MenuItem
                    onSelect={() => {
                      close();
                      handleExport('png');
                    }}
                  >
                    PNG image
                  </MenuItem>
                  <MenuItem
                    onSelect={() => {
                      close();
                      handleExport('svg');
                    }}
                  >
                    SVG image
                  </MenuItem>
                </>
              )}
            </Menu>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}

interface DiagnosticsPanelProps {
  diagnostics: Diagnostic[];
  onSelect: (diagnostic: Diagnostic) => void;
}

function DiagnosticsPanel({ diagnostics, onSelect }: DiagnosticsPanelProps) {
  if (diagnostics.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-green-700 border-t border-gray-200 bg-gray-50">
        <CheckCircle2 size={14} />
        No problems
      </div>
    );
  }

  return (
    <ul className="max-h-36 overflow-y-auto border-t border-gray-200 bg-gray-50 text-xs">
      {diagnostics.map((d, i) => (
        <li key={i}>
          <button onClick={() => onSelect(d)} className="w-full flex items-start gap-2 px-3 py-1.5 text-left hover:bg-gray-100">
            {d.severity === 'error' ? (
              <AlertCircle size={14} className="text-red-600 flex-shrink-0 mt-px" />
            ) : (
              <AlertTriangle size={14} className="text-amber-600 flex-shrink-0 mt-px" />
            )}
            <span className="text-gray-500 tabular-nums flex-shrink-0">
              {d.file ? `${d.file}:` : ''}
              {d.line}:{d.col}
            </span>
            <span className="text-gray-800">{d.message}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
