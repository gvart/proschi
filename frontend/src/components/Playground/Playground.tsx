import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
} from 'reactflow';
import type { Edge, EdgeChange, Node, NodeChange } from 'reactflow';
import 'reactflow/dist/style.css';
import {
  AlignLeft,
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
  Plus,
  Gauge,
  Network,
  Archive,
  ArchiveRestore,
} from 'lucide-react';
import { examples, parse, type Diagnostic, type DiagramScenario, type DiagramUseCase, type SourceLoc } from '../../dsl';
import { toFlowEdges } from '../../dsl/layout';
import { useAutoLayout } from '../Diagram/useDiagramLayout';
import { FIT_VIEW_OPTIONS, useFitOnChange } from '../Diagram/useFitOnChange';
import { loadJson, saveJson } from '../../services/storage';
import { FIRST_RUN_SOURCE, exampleFromSearch, withoutExample } from '../../playground/exampleLink';
import {
  BLANK_SOURCE,
  addDoc,
  addFile,
  currentDoc,
  fileNameOf,
  initialState,
  isBlank,
  removeDoc,
  renameFile,
  selectDoc,
  titleOf,
  updateCurrent,
  type DocumentState,
} from '../../playground/documents';
import { groupByEndpoint } from '../../playground/useCaseGroups';
import { filesResolver, importableFiles, usedImports } from '../../playground/imports';
import { LONG_LINK_MESSAGE, decodeShareLink, encodeShareHash, isLongLink, readShareLink, shareUrl, type PlaybackTarget } from '../../playground/share';
import { applyMerge, backupFileName, buildBackup, mergeSummary, planMerge, readBackup } from '../../playground/backup';
import { loadProgress, mergeProgress, saveProgress } from '../../practice/progress';
import { addConnection, addNode, clearPositions, removeConnections, removeNode, renameNode, setNodePosition } from '../../dsl/edit';
import type { Diagram } from '../../dsl/types';
import Palette, { TECH_DRAG_TYPE } from '../Diagram/Palette';
import Inspector from '../Diagram/Inspector';
import FlowParticles from '../Overlay/FlowParticles';
import { analysisOverlay, type SimOverlay } from '../../sim/overlay';
import ComponentNode from '../Canvas/ComponentNode';
import GroupNode from '../Canvas/GroupNode';
import TextNode from '../Canvas/TextNode';
import PaneLoading from '../PaneLoading';
import ViewTabs, { type View } from '../Analysis/ViewTabs';
import { useSimulation } from '../Analysis/useSimulation';
import { editorReviewInput } from '../../review/editor';
import CodeEditor, { type CodeEditorHandle } from './CodeEditor';
import Menu, { MenuItem } from './Menu';
import { downloadBlob, downloadText, exportImage, fileNameFor } from './exportDiagram';
import { track } from '../../services/metrics';
import Banner, { type BannerMessage } from './Banner';
import { MermaidMenuItems, type MermaidSource } from './mermaidExport';
import { useZenMode } from './useZenMode';
import { useKeyboardViewport } from './useKeyboardViewport';
import { ZenButton, ZenCollapse, ZenStatus } from './Zen';
import EditorZone from './EditorZone';
import { eyebrow, field, iconButton, outlineButton, primaryButton, subBar, toolButton } from './ui';
import Tabs from '../../design/Tabs';
import HelpMenu from '../../onboarding/HelpMenu';
import Header from '../../design/Header';
import { markSeen, startMode, type StartMode } from '../../onboarding/seen';
import type { CoverBand } from '../../onboarding/Tour';
import type { FitInset } from '../Diagram/useFitOnChange';

// Panes that are not visible at start load on first use.
const UseCasePlayer = lazy(() => import('../UseCases/UseCasePlayback').then((m) => ({ default: m.UseCasePlayer })));
const HldView = lazy(() => import('../Hld/HldView'));
const AnalysisPanel = lazy(() => import('../Analysis/AnalysisPanel'));
const TestsPanel = lazy(() => import('../Analysis/TestsPanel'));
const ReviewPanel = lazy(() => import('../../review/ReviewPanel'));
const ExamplesGallery = lazy(() => import('./ExamplesGallery'));
// First-run help costs nothing until it is shown.
const EditorTour = lazy(() => import('../../onboarding/EditorTour'));
const TourHint = lazy(() => import('../../onboarding/TourHint'));
const StarterCard = lazy(() => import('../../onboarding/StarterCard'));

const DOCS_KEY = 'proschi.docs';
const LEGACY_SOURCE_KEY = 'proschi.playground.source';
const PARSE_DELAY_MS = 150;
const VIEW_LABEL: Record<View, string> = { diagram: 'Diagram', analysis: 'Analysis', tests: 'Tests', hld: 'HLD' };

const nodeTypes = {
  componentNode: ComponentNode,
  groupNode: GroupNode,
  textNode: TextNode,
};

function loadInitialState(): DocumentState {
  // A share link wins over `?example=`: once an example is edited, the address bar holds the edits.
  const link = decodeShareLink(window.location.hash);
  const example = link ? undefined : exampleFromSearch(window.location.search)?.example;
  return initialState({
    stored: loadJson<unknown>(DOCS_KEY, null),
    legacySource: loadJson<unknown>(LEGACY_SOURCE_KEY, null),
    sharedSource: link?.source ?? example?.source ?? null,
    sharedImports: link?.imports,
    fallbackSource: FIRST_RUN_SOURCE,
  });
}

/** Whether the page opened on a shared diagram or an example link (`?example=<id>`), which should be seen first. */
function isDeepLink(): boolean {
  return readShareLink(window.location.hash) !== null || exampleFromSearch(window.location.search) !== null;
}

/** Whether this browser has saved diagrams from an earlier visit. */
function isReturning(): boolean {
  return loadJson<unknown>(DOCS_KEY, null) !== null || loadJson<unknown>(LEGACY_SOURCE_KEY, null) !== null;
}

/** The tour on a first visit; only a hint over a shared diagram or example link. */
function initialTourMode(): StartMode {
  return startMode('editor', { deepLink: isDeepLink(), returning: isReturning() });
}

/** The pane a phone opens on: the code on a first visit, where it all starts; the diagram for a link or a returning visitor. */
function initialMobilePane(): 'code' | 'diagram' {
  return !isDeepLink() && !isReturning() ? 'code' : 'diagram';
}

export default function Playground() {
  const [docState, setDocState] = useState(loadInitialState);
  const current = currentDoc(docState);
  const source = current.source;
  const rootPath = fileNameOf(current);
  const setSource = useCallback((next: string) => setDocState((s) => updateCurrent(s, next)), []);
  /** The reader's own edit in the code pane (not a value set from outside, which the editor echoes back). */
  const typeSource = (next: string) => {
    if (next !== source) track('editor_first_edit', { once: 'browser' });
    setSource(next);
  };
  /** Applies a canvas edit to the current document's text. */
  const editSource = useCallback((edit: (source: string) => string) => {
    track('editor_first_edit', { once: 'browser' });
    setDocState((s) => updateCurrent(s, edit(currentDoc(s).source)));
  }, []);

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
  const [mobilePane, setMobilePane] = useState<'code' | 'diagram'>(initialMobilePane);
  const [view, setView] = useState<View>('diagram');
  const [copied, setCopied] = useState(false);
  const [tour, setTour] = useState<StartMode>(initialTourMode);
  /** Bumped by Help → Take the tour, so a replay starts at the first step. */
  const [tourRun, setTourRun] = useState(0);
  /** The screen band a phone tour card covers; the canvas fits the diagram around it. */
  const [tourCover, setTourCover] = useState<CoverBand | null>(null);
  const editorRef = useRef<CodeEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const zen = useZenMode();
  const keyboard = useKeyboardViewport();

  useEffect(() => track('editor_open', { once: 'session' }), []);

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
  const simulation = useSimulation(diagram);
  const imports = useMemo(() => usedImports(parsed, JSON.parse(importableKey), rootPath), [parsed, importableKey, rootPath]);
  const importsKey = JSON.stringify(imports);
  const rootDiagnostics = useMemo(() => diagnostics.filter((d) => d.file === undefined), [diagnostics]);
  /** Nodes declared in imported files (id → file); canvas edits leave them alone. */
  const importedNodes = useMemo(() => new Map(diagram.nodes.flatMap((n) => (n.loc.file ? [[n.id, n.loc.file] as const] : []))), [diagram]);
  const [notice, setNotice] = useState<string | null>(null);
  // A link that could not be opened says so; the banner also carries long-link and backup messages.
  const [banner, setBanner] = useState<BannerMessage | null>(() => {
    const link = readShareLink(window.location.hash);
    if (link && 'error' in link) return { message: link.error, tone: 'warning' };
    const example = link ? null : exampleFromSearch(window.location.search);
    return example && !example.example ? { message: `There is no example called “${example.id}”; Examples in the top bar lists them all.`, tone: 'warning' } : null;
  });
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
    () => (useCase && scenario ? { id: `${useCase.id}/${scenario.id}`, name: useCase.name, steps: scenario.steps, condition: scenario.condition } : undefined),
    [useCase, scenario],
  );

  // An example link has done its job once the example is open: the address bar becomes a share link like any other.
  useEffect(() => {
    const { pathname, search, hash } = window.location;
    if (exampleFromSearch(search) !== null) window.history.replaceState(null, '', `${pathname}${withoutExample(search)}${hash}`);
  }, []);

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
  /** "Overlay: load": the analysis drawn on the diagram, for documents with a traffic block. */
  const [overlayOn, setOverlayOn] = useState(false);
  const canOverlay = (diagram.traffic?.length ?? 0) > 0;
  const overlay = useMemo(
    () => (overlayOn && canOverlay ? analysisOverlay(diagram, simulation.analysis) : undefined),
    [overlayOn, canOverlay, diagram, simulation.analysis],
  );
  const shownNodes = useMemo(
    () => (overlay ? nodes.map((n) => (overlay.nodes[n.id] ? { ...n, data: { ...n.data, overlay: overlay.nodes[n.id] } } : n)) : nodes),
    [nodes, overlay],
  );
  const [edges, setEdges] = useState<Edge[]>([]);

  // Usage counts: the first look at the simulation's numbers (the Analysis or
  // HLD tab, or the load overlay) and at the tests, once per session each.
  useEffect(() => {
    if (view === 'analysis' || view === 'hld' || (overlayOn && canOverlay)) track('simulation_run', { once: 'session' });
    if (view === 'tests') track('test_run', { once: 'session', key: 'test_run:editor' });
  }, [view, overlayOn, canOverlay]);

  // Edges are local state so selection works; keep it across re-parses.
  useEffect(() => {
    setEdges((previous) => {
      const selected = new Set(previous.filter((e) => e.selected).map((e) => e.id));
      return toFlowEdges(diagram).map((e) => (selected.has(e.id) ? { ...e, selected: true } : e));
    });
  }, [diagram]);

  // Keep what the user had selected across re-layouts.
  const showLaidOut = useCallback((laidOut: Node[]) => {
    setNodes((previous) => {
      const selected = new Set(previous.filter((n) => n.selected).map((n) => n.id));
      return laidOut.map((n) => (selected.has(n.id) ? { ...n, selected: true } : n));
    });
  }, []);
  const layoutSettled = useAutoLayout(diagram, showLaidOut);

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

  const renameDocFile = (id: string, current: string) => {
    const name = window.prompt('File name (used by import "…")', current);
    if (name !== null) setDocState((s) => renameFile(s, id, name));
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
    track('share_link_created');
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this link:', url);
    }
    if (isLongLink(url)) {
      setBanner({ message: LONG_LINK_MESSAGE, tone: 'warning', action: { label: 'Download .proschi', run: () => downloadText(source, rootPath) } });
    }
  };

  const exportAll = () => {
    downloadBlob(new Blob([buildBackup(docState, loadProgress())], { type: 'application/zip' }), backupFileName());
  };

  const importBackup = async (file: File | undefined) => {
    if (!file) return;
    try {
      const backup = readBackup(new Uint8Array(await file.arrayBuffer()));
      const plan = planMerge(docState, backup.docs);
      let replaced = 0;
      const next = applyMerge(docState, plan, ({ existing }) => {
        const yes = window.confirm(`"${titleOf(existing.source)}" (${fileNameOf(existing)}) differs from the copy in the backup. Replace it with the backup's version?`);
        if (yes) replaced++;
        return yes;
      });
      openDoc(() => next);
      saveProgress(mergeProgress(loadProgress(), backup.progress));
      setBanner({ message: mergeSummary(plan, replaced, Object.keys(backup.progress).length) });
    } catch (error) {
      setBanner({ message: `Could not import ${file.name}: ${error instanceof Error ? error.message : String(error)}`, tone: 'warning' });
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
    setView('diagram');
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

  /** Adds a catalog component; one dropped on the canvas is pinned where it fell, a clicked one is laid out. */
  const addFromCanvas = (tech: string, position?: { x: number; y: number }) => {
    editSource((src) => addNode(src, { name: tech, tech, position }).source);
  };

  const connectNodes = (from: string, to: string) => {
    // The connection may already exist in an imported file.
    if (diagram.edges.some((e) => e.source === from && e.target === to)) return;
    editSource((src) => addConnection(src, from, to));
  };

  /** A problem (or test) in an imported file opens that file, if it is saved in this browser. */
  const selectDiagnostic = (d: SourceLoc) => {
    if (d.file === undefined) {
      editorRef.current?.goTo(d.line, d.col);
      return;
    }
    const target = docState.docs.find((doc) => doc.id !== current.id && fileNameOf(doc) === d.file);
    if (target && !current.imports?.[d.file]) openDoc((s) => selectDoc(s, target.id));
  };

  const selectInEditor = useCallback((line: number, col: number, length: number, focus: boolean) => editorRef.current?.select(line, col, length, focus), []);
  const diagramKey = useMemo(() => `${diagram.nodes.map((n) => `${n.id}:${n.name}`).join('|')}#${diagram.edges.length}`, [diagram]);
  const openExample = (exampleSource: string) =>
    // An example picked while the current diagram is still empty takes its place instead of piling up "Untitled".
    openDoc((s) => (isBlank(currentDoc(s).source) ? removeDoc(addDoc(s, exampleSource), s.currentId) : addDoc(s, exampleSource)));
  const openHldExample = () => {
    const example = examples.find((e) => e.id === 'url-shortener');
    if (!example) return;
    openExample(example.source);
    setView('tests');
    setMobilePane('diagram');
  };

  const canPlay = !!scenario && scenario.steps.length > 0;
  const problemCount = diagnostics.length;
  const sortedDocs = [...docState.docs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <div
      className="h-[100dvh] flex flex-col bg-paper text-ink"
      style={keyboard.style}
      data-zen={zen.zen || undefined}
      data-keyboard={keyboard.open || undefined}
    >
      <ZenCollapse zen={zen.zen}>
        <Header base="../" current="editor" compact>
        <div className="flex items-center gap-1 min-w-0 flex-1 sm:flex-none">
          <Menu
            label="Diagrams"
            trigger={
              <>
                <span className="max-w-[7.5rem] sm:max-w-[14rem] truncate">{titleOf(source)}</span>
                <ChevronDown size={14} />
              </>
            }
          >
            {(close) => (
              <>
                <div className={`px-3 pt-1 pb-1.5 ${eyebrow}`}>Saved in this browser</div>
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
                          className={`flex-1 min-w-0 px-3 py-1.5 text-left text-sm hover:bg-ink/10 ${doc.id === docState.currentId ? 'font-bold text-ink shadow-[inset_4px_0_0_rgb(var(--c-pink))]' : 'text-ink/85'}`}
                        >
                          <span className="block truncate">{title}</span>
                          <span className="block truncate text-xs font-normal text-muted">
                            {fileNameOf(doc)} · {new Date(doc.updatedAt).toLocaleString()}
                          </span>
                        </button>
                        <button
                          aria-label={`Rename file ${fileNameOf(doc)}`}
                          title="Rename the file imports refer to"
                          onClick={() => renameDocFile(doc.id, fileNameOf(doc))}
                          className="p-1.5 rounded text-muted hover:text-ink hover:bg-ink/10"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          aria-label={`Delete ${title}`}
                          onClick={() => deleteDoc(doc.id, title)}
                          className="mr-1 p-1.5 rounded text-muted hover:text-fail hover:bg-fail/10"
                        >
                          <Trash2 size={14} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <div className="my-1 border-t border-ink/10" />
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
                <MenuItem
                  icon={<AlignLeft size={14} />}
                  onSelect={() => {
                    close();
                    editorRef.current?.format();
                  }}
                >
                  Format code <span className="ml-auto text-xs text-muted">Shift+Alt+F</span>
                </MenuItem>
                <div className="my-1 border-t border-ink/10" />
                <MenuItem
                  icon={<Archive size={14} />}
                  onSelect={() => {
                    exportAll();
                    close();
                  }}
                >
                  Export all (.zip)
                </MenuItem>
                <MenuItem
                  icon={<ArchiveRestore size={14} />}
                  onSelect={() => {
                    backupInputRef.current?.click();
                    close();
                  }}
                >
                  Import backup…
                </MenuItem>
                <p className="px-3 pt-0.5 pb-1 text-xs text-muted">Saved in this browser only — export a backup.</p>
              </>
            )}
          </Menu>
        </div>
        <HelpMenu
          className="sm:order-last"
          onTour={() => {
            setTourRun((n) => n + 1);
            setTour('tour');
          }}
        />
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
        <input
          ref={backupInputRef}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          aria-label="Import backup"
          onChange={(e) => {
            importBackup(e.target.files?.[0]);
            e.target.value = '';
          }}
        />

        <div className="ps-header__wrap flex items-center gap-2 w-full sm:w-auto sm:min-w-0 sm:flex-wrap sm:ml-auto">
          <button
            onClick={() => setShowExamples(true)}
            aria-label="Examples"
            className={toolButton}
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
            className={`flex-1 min-w-0 sm:flex-none sm:max-w-[16rem] ${field}`}
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
              className={outlineButton}
            >
              <LayoutGrid size={16} />
              <span className="hidden sm:inline">Diagram</span>
            </button>
          ) : (
            <button
              onClick={startPlaying}
              disabled={!canPlay}
              data-tour="play"
              aria-label="Play"
              title={canPlay ? 'Play this use case' : 'Add a usecase with steps to play it'}
              className={primaryButton}
            >
              <Play size={16} />
              <span className="hidden sm:inline">Play</span>
            </button>
          )}

          <ZenButton zen={zen} className={iconButton} />

          <button
            onClick={copyShareLink}
            data-tour="share"
            aria-label={copied ? 'Copied' : 'Share'}
            title={playing ? 'Copy a link to this step of the use case' : 'Copy a link that contains this diagram'}
            className={outlineButton}
          >
            {copied ? <Check size={16} className="text-pass" /> : <Link size={16} />}
            <span className="hidden sm:inline">{copied ? 'Copied' : 'Share'}</span>
          </button>
        </div>
        </Header>
        {banner && <Banner banner={banner} onClose={() => setBanner(null)} />}

        <div data-tour="panes" className="md:hidden bg-surface">
          <Tabs
            label="View"
            idPrefix="pane"
            fill
            value={mobilePane}
            onChange={setMobilePane}
            items={[
              { id: 'code', label: 'Code', icon: <Code2 size={16} />, badge: problemCount > 0 ? problemCount : undefined },
              { id: 'diagram', label: playing ? 'Playback' : VIEW_LABEL[view], icon: <Network size={16} /> },
            ]}
          />
        </div>
      </ZenCollapse>

      <div className="flex-1 min-h-0 flex flex-col md:flex-row">
        <EditorZone
          id="pane-panel-code"
          data-tour="code"
          className={`${mobilePane === 'code' ? 'flex' : 'hidden'} md:flex flex-1 md:flex-none min-h-0 md:w-[42%] md:max-w-[720px] flex-col md:border-r-bw-2`}
        >
          <div className="flex-1 min-h-0">
            <CodeEditor ref={editorRef} value={source} onChange={typeSource} diagnostics={rootDiagnostics} nodeIds={nodeIds} />
          </div>
          <DiagnosticsPanel diagnostics={diagnostics} onSelect={selectDiagnostic} />
        </EditorZone>

        <section id="pane-panel-diagram" className={`${mobilePane === 'diagram' ? 'flex' : 'hidden'} md:flex flex-col flex-1 min-h-0 min-w-0`}>
          <ZenCollapse zen={zen.zen}>
            {!playing && <ViewTabs view={view} onChange={setView} results={simulation.results} />}
            {hasScenarios && useCase && scenario && (view === 'diagram' || playing) && (
              <ScenarioBar useCase={useCase} current={playing ? scenario.id : undefined} onPick={pickScenario} />
            )}
          </ZenCollapse>
          <div id={playing ? undefined : `view-panel-${view}`} className="flex-1 min-h-0 relative">
            <Suspense fallback={<PaneLoading />}>
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
              ) : view === 'analysis' ? (
                <AnalysisPanel
                  diagram={diagram}
                  analysis={simulation.analysis}
                  onSelect={selectDiagnostic}
                  review={<ReviewPanel source={source} input={() => editorReviewInput(parsedSource, parsed, simulation.analysis, simulation.results)} onSelect={selectDiagnostic} />}
                />
              ) : view === 'tests' ? (
                <TestsPanel results={simulation.results} onSelect={selectDiagnostic} />
              ) : view === 'hld' ? (
                <HldView diagram={diagram} nodes={nodes} edges={edges} analysis={simulation.analysis} results={simulation.results} />
              ) : (
                <ReactFlowProvider>
                  <DiagramView
                    nodes={shownNodes}
                    overlay={overlay}
                    canOverlay={canOverlay}
                    onToggleOverlay={() => setOverlayOn((on) => !on)}
                    edges={edges}
                    onNodesChange={setNodes}
                    onEdgesChange={setEdges}
                    title={diagram.title}
                    hasPinnedNodes={diagram.nodes.some((n) => n.position)}
                    importedNodes={importedNodes}
                    onMoveNodes={moveNodes}
                    onConnectNodes={connectNodes}
                    onRenameNode={renameFromCanvas}
                    onAddNode={addFromCanvas}
                    onEdit={editSource}
                    diagram={diagram}
                    onResetLayout={() => editSource(clearPositions)}
                    onDelete={deleteFromCanvas}
                    fitKey={`${mobilePane}:${layoutSettled}`}
                    mermaid={{ diagram, useCaseId: useCase?.id, scenarioId: scenario?.id }}
                    notice={notice}
                    onNotice={setNotice}
                    cover={tour === 'tour' ? tourCover : null}
                  />
                </ReactFlowProvider>
              )}
            </Suspense>
            {nodes.length === 0 && !playing && view === 'diagram' &&
              (isBlank(source) ? (
                <div className="absolute inset-0 flex items-center justify-center overflow-y-auto p-4">
                  <Suspense fallback={null}>
                    <StarterCard onTemplate={setSource} onExamples={() => setShowExamples(true)} />
                  </Suspense>
                </div>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <p className="text-sm text-muted">
                    Start typing, e.g. <code className="px-1 bg-ink/5 rounded font-mono">api -&gt; db</code>
                  </p>
                </div>
              ))}
          </div>
        </section>
      </div>

      {showExamples && (
        <Suspense fallback={<PaneLoading overlay />}>
          <ExamplesGallery
            onClose={() => setShowExamples(false)}
            onPick={(example) => {
              openExample(example.source);
              setShowExamples(false);
            }}
          />
        </Suspense>
      )}

      {tour === 'tour' && (
        <Suspense fallback={null}>
          <EditorTour
            key={tourRun}
            source={source}
            nodes={diagram.nodes}
            diagramKey={diagramKey}
            canPlay={canPlay}
            playing={playing}
            view={view}
            hasTraffic={(diagram.traffic ?? []).length > 0}
            copied={copied}
            setMobilePane={setMobilePane}
            stopPlaying={stopPlaying}
            edit={editSource}
            selectInEditor={selectInEditor}
            openHldExample={openHldExample}
            onClose={() => setTour(null)}
            onCover={setTourCover}
          />
        </Suspense>
      )}
      <ZenStatus zen={zen} />
      {tour === 'hint' && (
        <Suspense fallback={null}>
          <TourHint
            onStart={() => setTour('tour')}
            onDismiss={() => {
              markSeen('editor');
              setTour(null);
            }}
          />
        </Suspense>
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
      className={`flex items-center gap-1.5 px-2 py-1.5 overflow-x-auto ${subBar}`}
    >
      <span className={`hidden sm:inline px-1.5 flex-shrink-0 ${eyebrow}`}>Scenarios</span>
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
            title={s.condition ? `Play “${s.name}” — when ${s.condition}` : `Play “${s.name}”`}
            className={`flex-shrink-0 inline-flex items-center gap-1.5 rounded-full border-bw-1 px-3 py-1.5 sm:py-1 text-sm font-semibold whitespace-nowrap transition-[transform,box-shadow] duration-d1 ${
              active
                ? `border-ink text-on-accent shadow-brutal-sm ${error ? 'bg-fail' : 'bg-pop-pink'}`
                : 'border-ink/25 text-ink/85 hover:border-ink hover:bg-surface'
            }`}
          >
            <span aria-hidden="true" className={`h-2 w-2 rounded-[2px] border border-current ${error ? 'bg-fail' : 'bg-pass'}`} />
            {s.name}
            {status !== undefined && <span className={`font-mono text-xs tabular-nums ${active ? '' : error ? 'text-fail' : 'text-muted'}`}>{status}</span>}
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
  /** Adds a component from the palette, at a canvas position when it was dropped. */
  onAddNode: (techStack: string, position?: { x: number; y: number }) => void;
  /** Applies an inspector edit to the text. */
  onEdit: (edit: (source: string) => string) => void;
  /** The parsed diagram, for the inspector. */
  diagram: Diagram;
  /** The simulation drawn on the canvas, when "Overlay: load" is on. */
  overlay?: SimOverlay;
  /** The document has traffic to simulate, so the overlay can be turned on. */
  canOverlay: boolean;
  onToggleOverlay: () => void;
  onResetLayout: () => void;
  onDelete: (nodeIds: string[], edgeIds: string[]) => void;
  /** Changes when the view becomes visible again, so it can re-fit. */
  fitKey: string;
  mermaid: MermaidSource;
  /** Nodes declared in imported files (id → file); they cannot be moved here. */
  importedNodes: Map<string, string>;
  /** A short message shown over the canvas, e.g. why an edit was refused. */
  notice: string | null;
  onNotice: (message: string) => void;
  /** A band of the screen covered by a floating card; fitting keeps the diagram clear of it. */
  cover?: CoverBand | null;
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
  onAddNode,
  onEdit,
  diagram,
  overlay,
  canOverlay,
  onToggleOverlay,
  onResetLayout,
  onDelete,
  fitKey,
  mermaid,
  importedNodes,
  notice,
  onNotice,
  cover,
}: DiagramViewProps) {
  const { getNodes, screenToFlowPosition } = useReactFlow();
  const [selection, setSelection] = useState<{ nodes: Node[]; edges: Edge[] }>({ nodes: [], edges: [] });
  const [paletteOpen, setPaletteOpen] = useState(false);
  /** The node or connection whose settings were closed, so they stay closed until something else is selected. */
  const [closedSettings, setClosedSettings] = useState<string | null>(null);
  const single = selection.nodes.length + selection.edges.length === 1 ? (selection.nodes[0] ?? selection.edges[0]) : undefined;
  const selectedNode = selection.nodes.length === 1 ? diagram.nodes.find((n) => n.id === selection.nodes[0].id) : undefined;
  const selectedEdge = selection.edges.length === 1 ? diagram.edges.find((e) => e.id === selection.edges[0].id) : undefined;
  const showSettings = single !== undefined && single.id !== closedSettings && (selectedNode !== undefined || selectedEdge !== undefined);
  const selectionCount = selection.nodes.length + selection.edges.length;
  const hasSelection = selectionCount > 0;
  const singleNode = selection.nodes.length === 1 && selection.edges.length === 0 ? selection.nodes[0] : undefined;
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
  // Re-fit once nodes are measured after being added or removed, not on every drag.
  // The part of the canvas a covering band hides, measured after layout.
  const [inset, setInset] = useState<FitInset | undefined>(undefined);
  const coverKey = cover ? `${cover.top}:${cover.bottom}` : '';
  useLayoutEffect(() => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!cover || !rect || rect.height === 0) return setInset(undefined);
    // A card docked low hides the bottom of the canvas, one docked high its top.
    const low = cover.top + cover.bottom > rect.top + rect.bottom;
    const top = low ? 0 : Math.max(0, cover.bottom - rect.top);
    const bottom = low ? Math.max(0, rect.bottom - cover.top) : 0;
    setInset((prev) => (prev?.top === top && prev?.bottom === bottom ? prev : { top, bottom }));
    // coverKey captures cover by value; fitKey changes when the pane is shown again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverKey, fitKey]);
  // No animated fit: d3-zoom reads the pane size on the transition's first tick, and a pane hidden by
  // then (phone Code/Diagram tabs) is 0×0, which interpolates the viewport to NaN. Nodes already glide via settle.
  useFitOnChange(`${nodes.map((n) => n.id).join('|')}#${fitKey}`, { wrapper: wrapperRef, inset });

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
      className="relative h-full"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(TECH_DRAG_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(e) => {
        const tech = e.dataTransfer.getData(TECH_DRAG_TYPE);
        if (!tech) return;
        e.preventDefault();
        setPaletteOpen(false);
        onAddNode(tech, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
      }}
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
        fitViewOptions={FIT_VIEW_OPTIONS}
        minZoom={0.1}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        {overlay && <FlowParticles flows={overlay.flows} nodes={overlay.nodes} />}
        <Controls showInteractive={false} />
        <Panel position="top-left">
          <div className="relative">
            <button
              type="button"
              onClick={() => setPaletteOpen((o) => !o)}
              aria-label="Add component"
              aria-expanded={paletteOpen}
              aria-haspopup="dialog"
              className={`${toolButton} border-ink bg-surface shadow-brutal-sm aria-expanded:bg-pop-yellow aria-expanded:text-on-accent`}
            >
              <Plus size={16} />
              <span className="whitespace-nowrap">
                Add<span className="hidden sm:inline"> component</span>
              </span>
            </button>
            {paletteOpen && (
              <div className="absolute left-0 top-full z-10 mt-1">
                <Palette
                  onAdd={(tech) => {
                    setPaletteOpen(false);
                    onAddNode(tech);
                  }}
                  onClose={() => setPaletteOpen(false)}
                />
              </div>
            )}
          </div>
        </Panel>
        {/* With the settings card open, Delete is in its header; this bar covers several items or a closed card. */}
        {(notice || (hasSelection && !showSettings)) && (
          <Panel position="bottom-center" className="flex flex-col items-center gap-2">
            {notice && (
              <p role="status" className="rounded border-bw-1 border-ink bg-ink px-3 py-1.5 text-xs font-semibold text-paper shadow-brutal-sm">
                {notice}
              </p>
            )}
            {hasSelection && !showSettings && (
              <div role="toolbar" aria-label="Selection" className="flex items-center gap-1 rounded-full border-bw-1 border-ink bg-surface py-1 pl-4 pr-1 shadow-brutal-sm">
                <span className="max-w-[10rem] truncate pr-1 text-sm font-semibold text-ink">
                  {singleNode ? (singleNode.data?.name ?? singleNode.id) : `${selectionCount} selected`}
                </span>
                {singleNode && (
                  <button
                    type="button"
                    onClick={() => promptRename(singleNode)}
                    className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-sm font-semibold text-ink hover:bg-ink/10"
                  >
                    <Pencil size={14} />
                    Rename
                  </button>
                )}
                <button
                  type="button"
                  onClick={deleteSelection}
                  className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-sm font-semibold text-red-700 dark:text-red-300 hover:bg-fail/10"
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              </div>
            )}
          </Panel>
        )}
        {nodes.length > 0 && !(hasSelection && !showSettings) && (
          <Panel position="bottom-right" className="hidden md:block text-xs text-muted bg-paper/85 rounded px-2 py-1">
            Drag to pin · select to edit settings · drag between dots to connect · Delete removes
          </Panel>
        )}
        {nodes.length > 0 && (
          <Panel position="top-right" className="flex items-center gap-1">
            {canOverlay && (
              <button
                type="button"
                onClick={onToggleOverlay}
                aria-pressed={overlay !== undefined}
                title="Show how busy each node is and the requests flowing, at the traffic block's rates"
                className={`${toolButton} aria-pressed:border-ink aria-pressed:bg-pop-yellow aria-pressed:text-on-accent aria-pressed:shadow-brutal-sm`}
              >
                <Gauge size={16} />
                <span className="whitespace-nowrap">
                  <span className="hidden sm:inline">Overlay: </span>load
                </span>
              </button>
            )}
            {hasPinnedNodes && (
              <button
                onClick={onResetLayout}
                title="Remove every pos x,y and lay the diagram out automatically"
                className={toolButton}
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
                  <MermaidMenuItems source={mermaid} close={close} />
                </>
              )}
            </Menu>
          </Panel>
        )}
      </ReactFlow>
      {showSettings && (
        <div className="pointer-events-none absolute inset-x-2 bottom-2 z-10 flex max-h-[55%] max-md:[[data-keyboard]_&]:max-h-[calc(100%-1rem)] md:inset-x-auto md:bottom-auto md:right-2 md:top-14 md:max-h-[calc(100%-4.5rem)] md:w-72">
          <Inspector
            key={single.id}
            node={selectedNode}
            edge={selectedNode ? undefined : selectedEdge}
            capacity={selectedNode ? diagram.capacity?.find((c) => c.node === selectedNode.id) : undefined}
            importedFrom={selectedNode ? importedNodes.get(selectedNode.id) : selectedEdge?.loc.file}
            onEdit={onEdit}
            onDelete={deleteSelection}
            onClose={() => setClosedSettings(single.id)}
          />
        </div>
      )}
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
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-pass border-t border-ink/15">
        <CheckCircle2 size={14} />
        No problems
      </div>
    );
  }

  return (
    <ul data-testid="diagnostics" className="max-h-36 overflow-y-auto border-t border-ink/15 text-xs font-mono">
      {diagnostics.map((d, i) => (
        <li key={i}>
          <button onClick={() => onSelect(d)} className="w-full flex items-start gap-2 px-3 py-1.5 text-left hover:bg-ink/10">
            {d.severity === 'error' ? (
              <AlertCircle size={14} className="text-fail flex-shrink-0 mt-px" />
            ) : (
              <AlertTriangle size={14} className="text-pop-yellow flex-shrink-0 mt-px" />
            )}
            <span className="text-muted tabular-nums flex-shrink-0">
              {d.file ? `${d.file}:` : ''}
              {d.line}:{d.col}
            </span>
            <span className="text-ink font-sans">{d.message}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
