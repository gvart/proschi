import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ReactFlowProvider } from 'reactflow';
import type { Edge, Node } from 'reactflow';
import 'reactflow/dist/style.css';
import { confirm, copyFallback } from '../../design/dialogs';
import { Group, Panel as SplitPanel, Separator, type Layout } from 'react-resizable-panels';
import {
  AlignLeft,
  ArrowLeft,
  AlertCircle,
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  FilePlus,
  LayoutGrid,
  Link,
  Link2,
  Code,
  LogIn,
  List,
  Play,
  Route,
  Upload,
  Code2,
  Network,
  ArchiveRestore,
  Import,
  RefreshCw,
  History,
  PanelLeft,
  Search,
} from 'lucide-react';
import { examples, parse, type Diagnostic, type DiagramScenario, type DiagramUseCase, type SourceLoc } from '../../dsl';
import { toFlowEdges } from '../../dsl/layout';
import { withEdgeStyles } from '../../dsl/toCanvas';
import { useAutoLayout } from '../Diagram/useDiagramLayout';
import { loadJson, saveJson } from '../../services/storage';
import { FIRST_RUN_SOURCE, exampleFromSearch, withoutExample } from '../../playground/exampleLink';
import {
  BLANK_SOURCE,
  DOCS_KEY,
  addDoc,
  addFile,
  addFiles,
  cloudImports,
  currentDoc,
  fileNameOf,
  initialState,
  isBlank,
  openShared,
  removeDoc,
  renameFile,
  selectDoc,
  titleOf,
  updateCurrent,
  updateDoc,
  type DocumentState,
} from '../../playground/documents';
import { createDocStore } from '../../playground/docStore';
import { groupByEndpoint } from '../../playground/useCaseGroups';
import { filesResolver, importableFiles, teamFileOf, usedImports, type TeamFile } from '../../playground/imports';
import { LONG_LINK_MESSAGE, LONG_LINK_SHORTEN_MESSAGE, decodeShareLink, encodeShareHash, isLongLink, readShareLink, shareUrl, type PlaybackTarget } from '../../playground/share';
import { applyMerge, backupFileName, buildBackup, mergeSummary, planMerge, readBackup } from '../../playground/backup';
import { loadProgress, mergeProgress, saveProgress } from '../../practice/progress';
import { addConnection, addNode, clearPosition, clearPositions, copyNodes, duplicateNodes, pasteNodes, removeConnections, removeNode, renameNode, retargetConnection, setNodePosition, uniqueId, type PasteOptions } from '../../dsl/edit';
import { EmptyCanvas } from '../Diagram/CanvasEditing';
import { isShortcutsKey } from '../Diagram/canvasEditState';
import ShortcutsDialog from './ShortcutsDialog';
import { SystemActionsContext, type SystemActions } from '../Canvas/systemActions';
import { useSystemView, type Crumb } from './useSystemView';
import PaneLoading from '../PaneLoading';
import ViewTabs from '../Analysis/ViewTabs';
import { parseView, type View } from '../Analysis/view';
import { useSimulation } from '../Analysis/useSimulation';
import { editorReviewInput } from '../../review/editor';
import CodeEditor, { type CodeEditorHandle } from './CodeEditor';
import Menu, { MenuItem } from './Menu';
import { downloadBlob, downloadText, renderPreviewPng } from './exportDiagram';
import { MAX_PREVIEW_BYTES, createShare, embedSnippet, embedUrl, fetchShare, shareIdFromSearch } from '../../services/shares';
import { ApiError } from '../../services/api';
import { FeaturesContext, showsUpgrade, useFeatures } from '../featureState';
import { billingEnabled } from '../../services/billing';
import PartnerButton from '../../partner/PartnerButton';
import { usePartnerShortcut } from '../../partner/shortcut';
import PartnerDock from '../../partner/PartnerDock';
import { useIsPhone } from '../../onboarding/layout';
import { useAccount } from '../../practice/useAccount';
import AccountMenu from '../../practice/AccountMenu';
import { track } from '../../services/metrics';
import Banner, { type BannerMessage } from './Banner';
import ExportMenu from './ExportMenu';
import { useZenMode } from './useZenMode';
import { useKeyboardViewport } from './useKeyboardViewport';
import { ZenButton, ZenCollapse, ZenStatus } from './Zen';
import EditorZone from './EditorZone';
import CloudSection, { CloudIcon } from './CloudStatus';
import FileSidebar, { type FileActions } from './FileSidebar';
import FilesRail from './FilesRail';
import { MOD_KEY } from './modKey';
import DiagramView, { type ImageRequest } from './DiagramView';
import QuickOpen from './QuickOpen';
import { addDocIn, brokenImports, docsInFolder, duplicateDoc, folderOf, moveDoc, removeFolder, renameFolder } from '../../playground/folders';
import { useCloudSync } from './useCloudSync';
import { useCloudFiles } from './useCloudFiles';
import { withCloudErrors } from '../../playground/cloudRefs';
import type { VersionInfo } from '../../playground/versions';
import type { VersionMode } from './VersionViewer';
import { eyebrow, iconButton, outlineButton, primaryButton, subBar, toolButton } from './ui';
import Tabs from '../../design/Tabs';
import Select from '../../design/Select';
import HelpMenu from '../../onboarding/HelpMenu';
import Header from '../../design/Header';
import { markSeen, startMode, type StartMode } from '../../onboarding/seen';
import type { CoverBand } from '../../onboarding/Tour';
import { UseCasePlayback } from '../UseCases/UseCasePlayback';
import { useFeedbackDiagram } from '../../feedback/diagram';

// Panes that are not visible at start load on first use.
const HldView = lazy(() => import('../Hld/HldView'));
const ResultsPanel = lazy(() => import('../Analysis/ResultsPanel'));
const ReviewPanel = lazy(() => import('../../review/ReviewPanel'));
const PartnerPanel = lazy(() => import('../../partner/PartnerPanel'));
const ExamplesGallery = lazy(() => import('./ExamplesGallery'));
const ShortLinksDialog = lazy(() => import('./ShortLinksDialog'));
const ImportDialog = lazy(() => import('./ImportDialog'));
const VersionsDialog = lazy(() => import('./VersionsDialog'));
const ShareLinkDialog = lazy(() => import('./ShareLinkDialog'));
const VersionViewer = lazy(() => import('./VersionViewer'));
// First-run help costs nothing until it is shown.
const EditorTour = lazy(() => import('../../onboarding/EditorTour'));
const TourHint = lazy(() => import('../../onboarding/TourHint'));
const StarterCard = lazy(() => import('../../onboarding/StarterCard'));

const noop = () => {};
const LEGACY_SOURCE_KEY = 'proschi.playground.source';
/** The splitter's position between the code and diagram panes. */
const SPLIT_KEY = 'proschi.playground.split';
const PARSE_DELAY_MS = 150;
/** Whether the diagrams sidebar is pinned open, on wider screens; until it is set, from this width on. */
const FILES_KEY = 'proschi.playground.files';
const FILES_PINNED_FROM = 1440;
const VIEW_LABEL: Record<View, string> = { diagram: 'Diagram', results: 'Results', hld: 'HLD' };

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
  return (
    readShareLink(window.location.hash) !== null ||
    exampleFromSearch(window.location.search) !== null ||
    new URLSearchParams(window.location.search).has('s')
  );
}

/** Whether this browser has saved diagrams from an earlier visit. */
function isReturning(): boolean {
  return loadJson<unknown>(DOCS_KEY, null) !== null || loadJson<unknown>(LEGACY_SOURCE_KEY, null) !== null;
}

/** The view a link asks for with `?view=` (old names such as `tests` included), else the diagram. */
function initialView(): View {
  return parseView(new URLSearchParams(window.location.search).get('view')) ?? 'diagram';
}

/** The tour on a first visit; only a hint over a shared diagram or example link. */
function initialTourMode(): StartMode {
  return startMode('editor', { deepLink: isDeepLink(), returning: isReturning() });
}

const EDITOR_CONTEXT = { kind: 'editor' } as const;

/** The pane a phone opens on: the code on a first visit, where it all starts; the diagram for a link or a returning visitor. */
function initialMobilePane(): 'code' | 'diagram' {
  return !isDeepLink() && !isReturning() ? 'code' : 'diagram';
}

export default function Playground() {
  // An external store, so cloud sync can merge into the latest diagrams (src/playground/docStore.ts).
  const [docStore] = useState(() => createDocStore(loadInitialState()));
  const docState = useSyncExternalStore(docStore.subscribe, docStore.get);
  const setDocState = docStore.set;
  const current = currentDoc(docState);
  /**
   * The `cloud:` files a share link bundled, for the diagram it opened. They are never
   * saved with it (storedImports): only used, while open, where a version cannot be fetched.
   */
  const [linkCloud, setLinkCloud] = useState(() => ({ docId: docStore.get().currentId, files: cloudImports(decodeShareLink(window.location.hash)?.imports) }));
  const linkCloudFiles = linkCloud.docId === current.id ? linkCloud.files : {};
  const source = current.source;
  useFeedbackDiagram(source);
  const rootPath = fileNameOf(current);
  const setSource = useCallback((next: string) => setDocState((s) => updateCurrent(s, next)), [setDocState]);
  /** The reader's own edit in the code pane (not a value set from outside, which the editor echoes back). */
  const typeSource = (next: string) => {
    if (next !== source) track('editor_first_edit', { once: 'browser' });
    setSource(next);
  };
  /** Applies a canvas edit to the current document's text. */
  const editSource = useCallback(
    (edit: (source: string) => string) => {
      track('editor_first_edit', { once: 'browser' });
      setDocState((s) => updateCurrent(s, edit(currentDoc(s).source)));
    },
    [setDocState],
  );

  // A link may point at a use case step; open straight into playback there.
  const [linkPlayback] = useState(() => decodeShareLink(window.location.hash)?.playback);
  const [parsedSource, setParsedSource] = useState(source);
  /** Short links and cloud sources, signed in on a build with accounts; `off` elsewhere. */
  const account = useAccount(noop);
  const [selectedUseCaseId, setSelectedUseCaseId] = useState<string | undefined>(linkPlayback?.useCase);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | undefined>(linkPlayback?.scenario);
  const [playing, setPlaying] = useState(!!linkPlayback);
  const [initialStep, setInitialStep] = useState(linkPlayback ? linkPlayback.step - 1 : undefined);
  const [playStep, setPlayStep] = useState(0);
  const [showExamples, setShowExamples] = useState(false);
  /**
   * The diagrams sidebar on wider screens: pinned beside the code (remembered; by default from 1440px),
   * else a rail that opens it over the panes ("peek"). Phones open it as a drawer instead.
   */
  const [filesPinned, setFilesPinned] = useState(() => loadJson<boolean | null>(FILES_KEY, null) ?? window.innerWidth >= FILES_PINNED_FROM);
  const [filesPeek, setFilesPeek] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const closeShortcuts = useCallback(() => setShowShortcuts(false), []);
  const [showShortLinks, setShowShortLinks] = useState(false);
  /** The short link made for a document and its imports, so asking again reuses it. */
  const shortLinkRef = useRef<{ key: string; id: string; url: string } | null>(null);
  const [shortening, setShortening] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showShareLink, setShowShareLink] = useState(false);
  /** A saved version open read-only, or two compared, over the editor. */
  const [versionView, setVersionView] = useState<{ mode: VersionMode; versions: VersionInfo[] } | null>(null);
  /** The code and diagram panes' sizes, as last set with the splitter. */
  const [splitLayout] = useState(() => loadJson<Layout | undefined>(SPLIT_KEY, undefined));
  /** Bumped when the splitter is let go, so the diagram re-fits its new width. */
  const [splitMoves, setSplitMoves] = useState(0);
  // Phones show one pane at a time.
  const [mobilePane, setMobilePane] = useState<'code' | 'diagram'>(initialMobilePane);
  const [view, setView] = useState<View>(initialView);
  const [copied, setCopied] = useState(false);
  const [tour, setTour] = useState<StartMode>(initialTourMode);
  /** Bumped by Help → Take the tour, so a replay starts at the first step. */
  const [tourRun, setTourRun] = useState(0);
  /** The screen band a phone tour card covers; the canvas fits the diagram around it. */
  const [tourCover, setTourCover] = useState<CoverBand | null>(null);
  const editorRef = useRef<CodeEditorHandle>(null);
  const teamEditorRef = useRef<CodeEditorHandle>(null);
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
  // `cloud:` sources are versions in the signed-in account, fetched before the parse (V6).
  const accountStatus = account.state.status;
  const cloudRefs = useCloudFiles(parsedSource, rootPath, { ...current.imports, ...linkCloudFiles }, accountStatus === 'loading' ? null : accountStatus === 'signed-in');
  const importableKey = JSON.stringify({ ...importableFiles(docState.docs, current), ...linkCloudFiles, ...cloudRefs.files });
  const cloudErrorsKey = JSON.stringify(cloudRefs.errors);
  const parsed = useMemo(
    () =>
      parse(parsedSource, {
        path: rootPath,
        resolve: withCloudErrors(filesResolver(JSON.parse(importableKey), rootPath), JSON.parse(cloudErrorsKey), cloudRefs.loading),
      }),
    [parsedSource, rootPath, importableKey, cloudErrorsKey, cloudRefs.loading],
  );
  const { diagram, diagnostics } = parsed;
  const simulation = useSimulation(diagram);
  /** What the canvas shows of the document's systems: collapsed, expanded in place, or navigated into. */
  const systems = useSystemView(current.id, diagram, simulation.analysis, simulation.results);
  const { shown } = systems;
  /** Navigated into a system: its team file, which the code pane shows instead of the document. */
  const team = useMemo(() => (systems.focusFile ? teamFileOf(docState.docs, current, systems.focusFile, cloudRefs.files) : undefined), [systems.focusFile, docState.docs, current, cloudRefs.files]);
  const teamDiagnostics = useMemo(() => (team ? diagnostics.filter((d) => d.file === team.path) : []), [team, diagnostics]);
  const editTeam = (next: string) => {
    if (team?.docId) setDocState((s) => updateDoc(s, team.docId!, next));
  };
  const imports = useMemo(() => usedImports(parsed, JSON.parse(importableKey), rootPath), [parsed, importableKey, rootPath]);
  const importsKey = JSON.stringify(imports);
  const rootDiagnostics = useMemo(() => diagnostics.filter((d) => d.file === undefined), [diagnostics]);
  /** Nodes declared in imported files or team designs (id → file); canvas edits leave them alone. */
  const importedNodes = useMemo(() => new Map(shown.nodes.flatMap((n) => (n.loc.file ? [[n.id, n.loc.file] as const] : []))), [shown]);
  const [notice, setNotice] = useState<string | null>(null);
  // A link that could not be opened says so; the banner also carries long-link and backup messages.
  const [banner, setBanner] = useState<BannerMessage | null>(() => {
    const link = readShareLink(window.location.hash);
    if (link && 'error' in link) return { message: link.error, tone: 'warning' };
    const example = link ? null : exampleFromSearch(window.location.search);
    return example && !example.example ? { message: `There is no example called “${example.id}”; Examples in the top bar lists them all.`, tone: 'warning' } : null;
  });
  const cloud = useCloudSync(docStore, (titles) =>
    setBanner({
      message: `Changed on another device as well, so both versions are kept: yours is now ${titles.map((t) => `"${t}"`).join(', ')}.`,
      tone: 'warning',
    }),
  );
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  const nodeIds = useMemo(() => diagram.nodes.map((n) => n.id), [diagram]);
  // Use cases play on what the canvas shows, so navigated into a team design they are that team's.
  const useCase = shown.useCases.find((u) => u.id === selectedUseCaseId) ?? shown.useCases[0];
  const scenario = useCase?.scenarios.find((s) => s.id === selectedScenarioId) ?? useCase?.scenarios[0];
  const hasScenarios = (useCase?.scenarios.length ?? 0) > 1;
  const playback: PlaybackTarget | undefined =
    playing && useCase ? { useCase: useCase.id, ...(hasScenarios && scenario ? { scenario: scenario.id } : {}), step: playStep + 1 } : undefined;
  const playbackKey = playback ? `${playback.useCase}/${playback.scenario ?? ''}#${playback.step}` : '';
  const useCaseOptions = useMemo(
    () =>
      groupByEndpoint(shown.useCases).flatMap((group) =>
        group.useCases.map((u) => ({
          value: u.id,
          label: u.name,
          group: group.label || undefined,
          description: u.scenarios.length > 1 ? `${u.scenarios.length} scenarios` : undefined,
        })),
      ),
    [shown],
  );
  // The player restarts when this changes, so each scenario starts at its first step.
  const playedUseCase = useMemo(
    () => (useCase && scenario ? { id: `${useCase.id}/${scenario.id}`, name: useCase.name, steps: scenario.steps, condition: scenario.condition } : undefined),
    [useCase, scenario],
  );

  // A short link (/s/<id>) sends people here with ?s=<id>: open its diagram, then drop the parameter.
  useEffect(() => {
    const id = shareIdFromSearch(window.location.search);
    if (!id) return;
    let cancelled = false;
    const dropParam = (hash: string) => {
      const params = new URLSearchParams(window.location.search);
      params.delete('s');
      const query = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${hash}`);
    };
    fetchShare(id).then(
      (share) => {
        if (cancelled) return;
        openDoc((s) => openShared(s, share.source, share.imports));
        setLinkCloud({ docId: docStore.get().currentId, files: cloudImports(share.imports) });
        dropParam(encodeShareHash(share.source, undefined, share.imports));
      },
      (error: unknown) => {
        if (cancelled) return;
        const gone = error instanceof ApiError && error.status === 404;
        setBanner({ message: gone ? 'This short link no longer exists: its owner deleted it.' : 'Could not open the short link; try again in a moment.', tone: 'warning' });
        if (gone) dropParam(window.location.hash);
      },
    );
    return () => {
      cancelled = true;
    };
    // Once, on load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const canOverlay = (shown.traffic?.length ?? 0) > 0;
  const { overlayOf, summaries } = systems;
  const overlay = useMemo(() => (overlayOn && canOverlay ? overlayOf() : undefined), [overlayOn, canOverlay, overlayOf]);
  const shownNodes = useMemo(
    () =>
      nodes.map((n) => {
        const load = overlay?.nodes[n.id];
        const system = summaries.get(n.id);
        return load || system ? { ...n, data: { ...n.data, ...(load ? { overlay: load } : {}), ...(system ? { system } : {}) } } : n;
      }),
    [nodes, overlay, summaries],
  );
  const systemActions = useMemo<SystemActions>(() => ({ open: systems.open, toggle: systems.toggle }), [systems.open, systems.toggle]);
  const [edges, setEdges] = useState<Edge[]>([]);

  // Usage counts: the first look at the simulation's numbers (the Results or
  // HLD tab, or the load overlay) and at the tests (Results), once per session each.
  useEffect(() => {
    if (view === 'results' || view === 'hld' || (overlayOn && canOverlay)) track('simulation_run', { once: 'session' });
    if (view === 'results') track('test_run', { once: 'session', key: 'test_run:editor' });
  }, [view, overlayOn, canOverlay]);

  // Edges are local state so selection works; keep it across re-parses.
  useEffect(() => {
    setEdges((previous) => {
      const selected = new Set(previous.filter((e) => e.selected).map((e) => e.id));
      return withEdgeStyles(shown, toFlowEdges(shown)).map((e) => (selected.has(e.id) ? { ...e, selected: true } : e));
    });
  }, [shown]);

  // Keep what the user had selected across re-layouts, and the size React Flow measured: a node
  // without one is hidden until measured again, and a re-measure can be lost while the layout glides.
  const showLaidOut = useCallback((laidOut: Node[]) => {
    setNodes((previous) => {
      const before = new Map(previous.map((n) => [n.id, n]));
      return laidOut.map((n) => {
        const p = before.get(n.id);
        if (!p) return n;
        const measured = p.type === n.type && p.width && p.height ? { width: p.width, height: p.height } : {};
        return p.selected || measured.width ? { ...n, ...measured, ...(p.selected ? { selected: true } : {}) } : n;
      });
    });
  }, []);
  const { settled: layoutSettled, busy: layoutBusy } = useAutoLayout(shown, showLaidOut);

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

  const deleteDoc = async (id: string, title: string) => {
    if (await confirm({ title: `Delete "${title}"?`, body: 'This cannot be undone.', confirmLabel: 'Delete', tone: 'danger' })) openDoc((s) => removeDoc(s, id));
  };

  const pinFiles = (pinned: boolean) => {
    setFilesPinned(pinned);
    setFilesPeek(false);
    saveJson(FILES_KEY, pinned);
  };
  const toggleFiles = () => {
    if (!window.matchMedia('(min-width: 768px)').matches) return setDrawer((d) => !d);
    if (filesDocked) pinFiles(false);
    // While the Design partner is open the sidebar stays folded, so the diagram keeps its width.
    else if (partnerOpen) setFilesPeek((p) => !p);
    else pinFiles(true);
  };

  /** Moves or renames files, then warns about the diagrams whose imports stopped finding a file. */
  const changeFiles = (update: (s: DocumentState) => DocumentState) => {
    const before = docStore.get();
    const after = update(before);
    if (after === before) return;
    setDocState(after);
    const broken = brokenImports(before.docs, after.docs);
    if (broken.length === 0) return;
    const names = broken.slice(0, 3).map((d) => `"${titleOf(d.source)}"`).join(', ');
    setBanner({ tone: 'warning', message: `${names}${broken.length > 3 ? ` and ${broken.length - 3} more` : ''} ${broken.length === 1 ? 'has an import that no longer finds its file' : 'have imports that no longer find their files'}; update the import lines.` });
  };

  // Ctrl/Cmd+P: go to a diagram (instead of printing the page); `?` outside fields: the shortcuts; Escape closes the phone drawer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawer(false);
        setFilesPeek(false);
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setQuickOpen(true);
      }
      if (isShortcutsKey(e)) {
        e.preventDefault();
        setShowShortcuts(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const fileActions: FileActions = {
    open: (id) => {
      if (id !== docState.currentId) openDoc((s) => selectDoc(s, id));
      setDrawer(false);
      setFilesPeek(false);
    },
    create: (folder) => {
      openDoc((s) => addDocIn(s, BLANK_SOURCE, folder));
      setDrawer(false);
      setFilesPeek(false);
    },
    renameFile: (id, base) =>
      changeFiles((s) => {
        const doc = s.docs.find((d) => d.id === id);
        if (!doc) return s;
        const folder = folderOf(fileNameOf(doc));
        const clean = base.replace(/\//g, '-');
        return renameFile(s, id, folder ? `${folder}/${clean}` : clean);
      }),
    move: (id, folder) => changeFiles((s) => moveDoc(s, id, folder)),
    duplicate: (id) => openDoc((s) => duplicateDoc(s, id)),
    remove: (id) => {
      const doc = docStore.get().docs.find((d) => d.id === id);
      if (doc) deleteDoc(id, titleOf(doc.source));
    },
    renameFolder: (from, to) => changeFiles((s) => renameFolder(s, from, to)),
    removeFolder: async (folder) => {
      const n = docsInFolder(docStore.get().docs, folder).length;
      if (await confirm({ title: `Delete the folder "${folder}" and the ${n} ${n === 1 ? 'diagram' : 'diagrams'} in it?`, body: 'This cannot be undone.', confirmLabel: 'Delete folder', tone: 'danger' })) openDoc((s) => removeFolder(s, folder));
    },
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    openDoc((s) => addFile(s, text, file.name));
  };

  const signedIn = account.state.status === 'signed-in';
  const features = useFeatures(account.state);
  const shareLinks = features('share_links');

  // Design partner (src/partner): on builds with accounts, beside the panes or as a sheet on phones.
  const hasPartner = billingEnabled && account.state.status !== 'off';
  const [partnerOpen, setPartnerOpen] = useState(false);
  const phone = useIsPhone();
  const togglePartner = useCallback(() => setPartnerOpen((o) => !o), []);
  // The pinned sidebar folds into its rail while the partner panel is open (not remembered), so the diagram keeps its width.
  const filesDocked = filesPinned && !(hasPartner && partnerOpen);
  const closePartner = useCallback(() => setPartnerOpen(false), []);
  usePartnerShortcut(togglePartner, hasPartner);
  const sourceNow = useRef(source);
  const importsNow = useRef(imports);
  useEffect(() => {
    sourceNow.current = source;
    importsNow.current = imports;
  });
  const partnerSource = useCallback(() => sourceNow.current, []);
  const partnerFiles = useCallback(() => Object.entries(importsNow.current ?? {}).map(([name, text]) => ({ name, source: text })), []);
  const applyPartner = useCallback(
    (next: string) => {
      if (editorRef.current) editorRef.current.replace(next);
      else setSource(next);
    },
    [setSource],
  );
  const undoPartner = useCallback(() => editorRef.current?.undo() ?? false, []);
  const partnerDiagram = useCallback((s: string) => parse(s, { path: rootPath, resolve: filesResolver(importsNow.current ?? {}, rootPath) }).diagram, [rootPath]);

  const copyText = async (text: string, prompt: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      void copyFallback(text, { title: prompt.replace(/:$/, '') });
    }
  };

  /** The short link of this document: the one made already, or a new one with a preview of the diagram on screen. */
  const ensureShortLink = async (): Promise<{ id: string; url: string } | undefined> => {
    const key = JSON.stringify([source, imports]);
    if (shortLinkRef.current?.key === key) return shortLinkRef.current;
    setShortening(true);
    try {
      let image: string | undefined;
      const viewport = document.querySelector<HTMLElement>('#pane-panel-diagram .react-flow__viewport');
      if (viewport) image = await renderPreviewPng(viewport, MAX_PREVIEW_BYTES).catch(() => undefined);
      const share = await createShare(source, imports, image);
      shortLinkRef.current = { key, id: share.id, url: share.url };
      return shortLinkRef.current;
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 401 ? 'your session expired; sign in again.' : error instanceof Error ? error.message : String(error);
      setBanner({ message: `Could not make a short link: ${message}`, tone: 'warning' });
      return undefined;
    } finally {
      setShortening(false);
    }
  };

  const copyShortLink = async () => {
    const share = await ensureShortLink();
    if (!share) return;
    track('share_link_created');
    await copyText(share.url, 'Copy this short link:');
    setBanner({ message: `Short link copied: ${share.url}. Anyone with it can open the diagram; delete it under Share → Your short links.` });
  };

  const copyShareLink = async () => {
    const url = shareUrl(source, window.location, playback, imports);
    track('share_link_created');
    await copyText(url, 'Copy this link:');
    if (isLongLink(url)) {
      setBanner(
        signedIn
          ? { message: LONG_LINK_SHORTEN_MESSAGE, tone: 'warning', action: { label: 'Copy a short link', run: () => void copyShortLink() } }
          : { message: LONG_LINK_MESSAGE, tone: 'warning', action: { label: 'Download .proschi', run: () => downloadText(source, rootPath) } },
      );
    }
  };

  /** An <iframe> of the read-only embed page: a short link signed in, else the diagram in the address. */
  const copyEmbed = async () => {
    const share = signedIn ? await ensureShortLink() : undefined;
    if (signedIn && !share) return;
    const url = embedUrl(window.location.href, share ? { id: share.id } : { hash: encodeShareHash(source, undefined, imports) });
    await copyText(embedSnippet(url, titleOf(source)), 'Copy this embed code:');
    setBanner(
      isLongLink(url)
        ? {
            message: `Embed code copied, but it is long: the diagram is in its address.${account.state.status === 'signed-out' ? ' Signed in, it uses a short link.' : ''}`,
            tone: 'warning',
          }
        : { message: 'Embed code copied: paste the <iframe> into a page, a wiki or a blog post.' },
    );
  };

  const exportAll = () => {
    downloadBlob(new Blob([buildBackup(docState, loadProgress())], { type: 'application/zip' }), backupFileName());
  };

  const importBackup = async (file: File | undefined) => {
    if (!file) return;
    try {
      const backup = readBackup(new Uint8Array(await file.arrayBuffer()));
      const plan = planMerge(docState, backup.docs);
      const agreed = new Set<(typeof plan.conflicts)[number]>();
      for (const conflict of plan.conflicts) {
        const { existing } = conflict;
        const yes = await confirm({ title: `Replace "${titleOf(existing.source)}" with the backup's version?`, body: `${fileNameOf(existing)} differs from the copy in the backup.`, confirmLabel: 'Replace' });
        if (yes) agreed.add(conflict);
      }
      const replaced = agreed.size;
      const next = applyMerge(docState, plan, (conflict) => agreed.has(conflict));
      openDoc(() => next);
      saveProgress(mergeProgress(loadProgress(), backup.progress));
      setBanner({ message: mergeSummary(plan, replaced, Object.keys(backup.progress).length) });
    } catch (error) {
      setBanner({ message: `Could not import ${file.name}: ${error instanceof Error ? error.message : String(error)}`, tone: 'warning' });
    }
  };

  const deleteFromCanvas = (nodeIds: string[], edgeIds: string[]) => {
    if (systems.focusFile) {
      setNotice(`This is the design in ${systems.focusFile}; delete it there.`);
      return;
    }
    const selectedEdges = shown.edges.filter((e) => edgeIds.includes(e.id));
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
        setNotice(result.error);
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

  /** An image of the diagram asked for in the Export menu; the canvas makes it once it is on screen. */
  const [imageRequest, setImageRequest] = useState<ImageRequest | null>(null);
  const requestImage = (format: ImageRequest['format']) => {
    stopPlaying();
    setView('diagram');
    setMobilePane('diagram');
    setImageRequest({ format });
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

  /** Adds a catalog component and returns its id; one dropped on the canvas is pinned where it fell, a clicked one is laid out. */
  const addFromCanvas = (tech: string, position?: { x: number; y: number }) => {
    if (systems.focusFile) {
      setNotice(`This is the design in ${systems.focusFile}; add components there.`);
      return undefined;
    }
    // The id is picked here, against imported nodes too, so the canvas can select the new node.
    const id = uniqueId(source, tech, importedNodes.keys());
    editSource((src) => addNode(src, { id, name: tech, tech, position }).source);
    return id;
  };
  /** What Ctrl/Cmd+C on the canvas copied (see copyNodes), and how often it was pasted since, so each paste lands a step further. */
  const canvasClipboard = useRef<{ text: string; pastes: number } | null>(null);
  const copyFromCanvas = (ids: string[]) => {
    const text = copyNodes(source, ids.filter((id) => !importedNodes.has(id)));
    if (!text) return setNotice('Groups, systems and imported components are copied in the code.');
    canvasClipboard.current = { text, pastes: 0 };
    // Also as text, to paste into the code or another app; the canvas pastes its own copy.
    navigator.clipboard?.writeText(text).catch(() => undefined);
    const count = parse(text).diagram.nodes.length;
    setNotice(`Copied ${count === 1 ? 'a component' : `${count} components`}; ${MOD_KEY}+V pastes.`);
  };
  /** Applies a paste in one edit and returns the new nodes' ids, so the canvas selects them. */
  const addOnCanvas = (paste: (src: string, options: PasteOptions) => { source: string; ids: string[] }, step: number) => {
    if (systems.focusFile) {
      setNotice(`This is the design in ${systems.focusFile}; add components there.`);
      return undefined;
    }
    const options = { taken: [...importedNodes.keys()], offset: { x: 40 * step, y: 40 * step } };
    const { ids } = paste(source, options);
    if (ids.length > 0) editSource((src) => paste(src, options).source);
    return ids;
  };
  const pasteFromCanvas = () => {
    const clip = canvasClipboard.current;
    if (!clip) return undefined;
    clip.pastes++;
    return addOnCanvas((src, options) => pasteNodes(src, clip.text, options), clip.pastes);
  };
  const duplicateFromCanvas = (ids: string[]) => {
    const own = ids.filter((id) => !importedNodes.has(id));
    const added = addOnCanvas((src, options) => duplicateNodes(src, own, options), 1);
    if (added?.length === 0) setNotice('Groups, systems and imported components are duplicated in the code.');
    return added;
  };
  const reconnectFromCanvas = (edgeId: string, from: string, to: string) => {
    const edge = shown.edges.find((e) => e.id === edgeId);
    if (!edge) return;
    if (systems.focusFile || edge.loc.file || importedNodes.has(from) || importedNodes.has(to)) {
      return setNotice(`Declared in ${systems.focusFile ?? edge.loc.file ?? importedNodes.get(from) ?? importedNodes.get(to)}; connect it there.`);
    }
    // Edge ids count duplicates across every file; the text edit needs this document's own id.
    const rootId = parse(source).diagram.edges.find((r) => r.loc.line === edge.loc.line)?.id;
    if (!rootId) return;
    const result = retargetConnection(source, rootId, from, to);
    if (result.error !== undefined) return setNotice(result.error);
    editSource((src) => retargetConnection(src, rootId, from, to).source ?? src);
  };
  const unpinFromCanvas = (id: string) => {
    if (importedNodes.has(id)) return setNotice(`'${id}' is declared in ${importedNodes.get(id)}; unpin it there.`);
    editSource((src) => clearPosition(src, id));
  };
  /** Selects a node's or a connection's text in the code pane (on a phone, switching to it). */
  const jumpToCode = (id: string) => {
    const loc = shown.nodes.find((n) => n.id === id)?.loc ?? shown.edges.find((e) => e.id === id)?.loc;
    if (!loc) return;
    setMobilePane('code');
    if (loc.file !== undefined || team) return selectDiagnostic(loc);
    // After the code pane is shown, so the editor can take the focus.
    requestAnimationFrame(() => editorRef.current?.select(loc.line, loc.col, loc.length, true));
  };
  const undoCanvas = useCallback(() => void editorRef.current?.undo(), []);
  const redoCanvas = useCallback(() => void editorRef.current?.redo(), []);

  const connectNodes = (from: string, to: string) => {
    if (systems.focusFile || importedNodes.has(from) || importedNodes.has(to)) return setNotice(`Declared in ${systems.focusFile ?? importedNodes.get(from) ?? importedNodes.get(to)}; connect it there.`);
    // The connection may already exist in an imported file.
    if (diagram.edges.some((e) => e.source === from && e.target === to)) return;
    editSource((src) => addConnection(src, from, to));
  };

  /** A problem (or test) in an imported file opens that file, if it is saved in this browser. */
  const selectDiagnostic = (d: SourceLoc) => {
    if (team && d.file === team.path) {
      teamEditorRef.current?.goTo(d.line, d.col);
      return;
    }
    if (d.file === undefined) {
      if (team) systems.goTo('');
      editorRef.current?.goTo(d.line, d.col);
      return;
    }
    const target = docState.docs.find((doc) => doc.id !== current.id && fileNameOf(doc) === d.file);
    if (target && !current.imports?.[d.file]) openDoc((s) => selectDoc(s, target.id));
  };

  const selectInEditor = useCallback((line: number, col: number, length: number, focus: boolean) => editorRef.current?.select(line, col, length, focus), []);
  const diagramKey = useMemo(() => `${diagram.nodes.map((n) => `${n.id}:${n.name}`).join('|')}#${diagram.edges.length}`, [diagram]);
  /** Opens a diagram as a new document, with the files it imports (`files`, path → source) saved beside it. */
  const openExample = (exampleSource: string, files?: Readonly<Record<string, string>>) =>
    openDoc((s) => {
      // An example picked while the current diagram is still empty takes its place instead of piling up "Untitled".
      // It keeps that diagram's folder, as a folder made with "New folder" holds a blank diagram.
      const blank = currentDoc(s);
      const next = isBlank(blank.source) ? removeDoc(addDocIn(s, exampleSource, folderOf(fileNameOf(blank))), s.currentId) : addDoc(s, exampleSource);
      return files ? addFiles(next, files) : next;
    });
  const openHldExample = () => {
    const example = examples.find((e) => e.id === 'url-shortener');
    if (!example) return;
    openExample(example.source);
    setView('results');
    setMobilePane('diagram');
  };

  /** Why this diagram has no versions (they live in the account), with what to do; null when it can have them. */
  const versionsHint = ((): { message: string; actions: { label: string; run: () => void }[] } | null => {
    const state = cloud.state;
    if (state.kind === 'unavailable') return { message: 'Versions are saved in a Proschi account, which this copy of the editor does not have.', actions: [] };
    if (state.kind === 'signed-out') {
      return {
        message: 'Versions live in your Proschi account. Sign in, and this diagram syncs there; then you can save versions of it and use them in other diagrams.',
        actions: state.providers.map((p) => ({ label: `Sign in with ${p === 'github' ? 'GitHub' : 'Google'}`, run: () => cloud.signIn(p) })),
      };
    }
    if (state.kind === 'off' || !cloud.enabled) return { message: 'Versions live in your account, and cloud sync is off in this browser.', actions: [{ label: 'Turn on cloud sync', run: () => cloud.setEnabled(true) }] };
    if (cloud.local.has(current.id)) {
      return {
        message: 'This diagram stays in this browser only, so it has no versions. Keep it in your account to save versions of it.',
        actions: cloud.canKeep ? [{ label: 'Keep in cloud', run: () => cloud.keepInCloud(current.id) }] : [],
      };
    }
    if (state.kind === 'loading') return { message: 'Connecting to your account…', actions: [] };
    if (state.kind === 'offline') return { message: 'Offline: versions are in your account, so they need a connection.', actions: [] };
    return null;
  })();
  /** Why this diagram cannot have a live share link yet (it is not in the account), with what to do; null when it can. */
  const shareHint = ((): { message: string; actions: { label: string; run: () => void }[] } | null => {
    if (cloud.state.kind === 'off' || !cloud.enabled) return { message: 'A share link shows the diagram kept in your account, and cloud sync is off in this browser.', actions: [{ label: 'Turn on cloud sync', run: () => cloud.setEnabled(true) }] };
    if (cloud.local.has(current.id)) {
      return {
        message: 'This diagram stays in this browser only. Keep it in your account to share a link to it.',
        actions: cloud.canKeep ? [{ label: 'Keep in cloud', run: () => cloud.keepInCloud(current.id) }] : [],
      };
    }
    if (cloud.state.kind === 'loading') return { message: 'Connecting to your account…', actions: [] };
    if (cloud.state.kind === 'offline') return { message: 'Offline: share links are made in your account, so they need a connection.', actions: [] };
    return null;
  })();
  const versionDraft = useMemo(() => ({ source, files: JSON.parse(importableKey) as Record<string, string> }), [source, importableKey]);
  /** "Restore into draft": the version's text replaces the draft's; the version stays as it is, and Undo puts the draft back. */
  const restoreVersion = (text: string, tag: string) => {
    const before = source;
    setSource(text);
    setVersionView(null);
    setBanner({
      message: `Restored version ${tag} into the draft. The version itself is unchanged.`,
      action: {
        label: 'Undo',
        run: () => {
          setSource(before);
          setBanner(null);
        },
      },
    });
  };

  const canPlay = !!scenario && scenario.steps.length > 0;
  const problemCount = diagnostics.length;

  const page = (
    <div
      className="h-[100dvh] flex flex-col bg-paper text-ink"
      style={keyboard.style}
      data-zen={zen.zen || undefined}
      data-keyboard={keyboard.open || undefined}
    >
      <ZenCollapse zen={zen.zen}>
        <Header base="../" current="editor" compact siteNav={false} actions={<AccountMenu account={account} />}>
        <div className="flex items-center gap-1 min-w-0 flex-1 sm:flex-initial">
          <button
            type="button"
            aria-label="Diagrams"
            aria-pressed={filesDocked || filesPeek}
            title="Show or hide the diagrams list (Ctrl+P to jump to one)"
            onClick={toggleFiles}
            className={`${toolButton} min-w-0 aria-pressed:md:bg-ink/10`}
          >
            <PanelLeft size={16} className="shrink-0" />
            <span className="max-w-[7.5rem] sm:max-w-[14rem] truncate">{titleOf(source)}</span>
            <CloudIcon state={cloud.state} />
          </button>
          <Menu
            label="File"
            trigger={
              <>
                <span className="max-sm:hidden">File</span>
                <ChevronDown size={14} />
              </>
            }
          >
            {(close) => (
              <>
                <MenuItem
                  icon={<FilePlus size={14} />}
                  onSelect={() => {
                    fileActions.create(current ? folderOf(fileNameOf(current)) : '');
                    close();
                  }}
                >
                  New diagram
                </MenuItem>
                <MenuItem
                  icon={<Search size={14} />}
                  onSelect={() => {
                    setQuickOpen(true);
                    close();
                  }}
                >
                  Go to diagram… <span className="ml-auto text-xs text-muted">{MOD_KEY}+P</span>
                </MenuItem>
                <MenuItem
                  icon={<BookOpen size={14} />}
                  onSelect={() => {
                    setShowExamples(true);
                    close();
                  }}
                >
                  Examples…
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
                  icon={<Import size={14} />}
                  onSelect={() => {
                    setShowImport(true);
                    close();
                  }}
                >
                  Import Mermaid or OpenAPI…
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
                {cloudRefs.any && (
                  <MenuItem
                    icon={<RefreshCw size={14} />}
                    onSelect={() => {
                      cloudRefs.refresh();
                      close();
                    }}
                  >
                    Refresh cloud references
                  </MenuItem>
                )}
                <MenuItem
                  icon={<History size={14} />}
                  onSelect={() => {
                    setShowVersions(true);
                    close();
                  }}
                >
                  Versions…
                </MenuItem>
                {/* Pro only; others see it (with an upgrade hint) only when paid plans are on. */}
                {(shareLinks.ok || showsUpgrade(shareLinks)) && (
                  <MenuItem
                    icon={<Link2 size={14} />}
                    onSelect={() => {
                      setShowShareLink(true);
                      close();
                    }}
                  >
                    Share link…
                  </MenuItem>
                )}
                <div className="my-1 border-t border-ink/10" />
                <MenuItem
                  icon={<ArchiveRestore size={14} />}
                  onSelect={() => {
                    backupInputRef.current?.click();
                    close();
                  }}
                >
                  Import backup…
                </MenuItem>
                <CloudSection cloud={cloud} close={close} />
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
          onShortcuts={() => setShowShortcuts(true)}
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

        <div className="ps-header__wrap flex items-center gap-2 w-full sm:w-auto sm:min-w-0 sm:flex-wrap xl:flex-nowrap sm:ml-auto">
          <Select
            aria-label="Use case"
            title={`Use case: the flow Play runs${useCase ? `. Now: ${useCase.name}` : ''}`}
            prefix={
              <>
                <Route size={16} aria-hidden="true" className="shrink-0" />
                <span className="hidden sm:inline shrink-0 text-xs font-bold uppercase tracking-[0.08em] text-muted">Use case</span>
              </>
            }
            value={useCase?.id ?? ''}
            onChange={(id) => {
              setSelectedUseCaseId(id);
              setSelectedScenarioId(undefined);
              setInitialStep(undefined);
            }}
            options={useCaseOptions}
            placeholder="No use cases"
            disabled={shown.useCases.length === 0}
            className="h-9 flex-1 min-w-0 sm:flex-none sm:w-[17rem]"
          />

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

          <div data-tour="export">
            <ExportMenu
              canImage={nodes.length > 0}
              exporting={imageRequest !== null}
              onImage={requestImage}
              mermaid={{ diagram, useCaseId: useCase?.id, scenarioId: scenario?.id }}
              onDownloadSource={() => downloadText(source, rootPath)}
              onExportAll={exportAll}
            />
          </div>

          <div data-tour="share">
            <Menu
              label={copied ? 'Copied' : 'Share'}
              title="Share: a link, a short link or an embed"
              align="right"
              buttonClassName={outlineButton}
              trigger={
                <>
                  {copied ? <Check size={16} className="text-pass" /> : <Link size={16} />}
                  <span className="hidden xl:inline">{copied ? 'Copied' : shortening ? 'Sharing…' : 'Share'}</span>
                </>
              }
            >
              {(close) => (
                <>
                  <MenuItem
                    icon={<Link size={16} />}
                    onSelect={() => {
                      close();
                      void copyShareLink();
                    }}
                  >
                    {playing ? 'Copy link to this step' : 'Copy link'}
                  </MenuItem>
                  {signedIn && (
                    <MenuItem
                      icon={<Link2 size={16} />}
                      disabled={shortening}
                      onSelect={() => {
                        close();
                        void copyShortLink();
                      }}
                    >
                      Short link with preview
                    </MenuItem>
                  )}
                  <MenuItem
                    icon={<Code size={16} />}
                    disabled={shortening}
                    onSelect={() => {
                      close();
                      void copyEmbed();
                    }}
                  >
                    Embed
                  </MenuItem>
                  {signedIn && (
                    <MenuItem
                      icon={<List size={16} />}
                      onSelect={() => {
                        close();
                        setShowShortLinks(true);
                      }}
                    >
                      Your short links…
                    </MenuItem>
                  )}
                  {account.state.status === 'signed-out' && account.state.providers.length > 0 && (
                    <>
                      <p className="mt-1 border-t border-ink/15 px-3 pt-2 pb-1 text-xs text-muted">Sign in for short links with a preview of the diagram.</p>
                      {account.state.providers.map((provider) => (
                        <MenuItem key={provider} icon={<LogIn size={16} />} onSelect={() => account.signIn(provider)}>
                          Sign in with {provider === 'github' ? 'GitHub' : 'Google'}
                        </MenuItem>
                      ))}
                    </>
                  )}
                </>
              )}
            </Menu>
          </div>
        </div>
        </Header>
        {banner && <Banner banner={banner} onClose={() => setBanner(null)} />}
        {cloud.ask > 0 && (
          <Banner
            banner={{
              message:
                `Add ${cloud.ask} ${cloud.ask === 1 ? 'diagram' : 'diagrams'} from this browser to your account?` +
                (cloud.limit !== null ? ` Your account keeps up to ${cloud.limit}; the most recently edited go first, any others stay here.` : ''),
              action: { label: 'Add to my account', run: () => cloud.answer(true) },
              secondary: { label: 'Keep in this browser only', run: () => cloud.answer(false) },
            }}
            onClose={() => cloud.answer(false)}
          />
        )}

        <div data-tour="panes" className="md:hidden flex items-stretch bg-surface">
          <div className="flex-1 min-w-0">
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
          {/* Phones: in the tab bar, not floating over the panes. */}
          {hasPartner && phone && <PartnerButton bar open={partnerOpen} onToggle={togglePartner} />}
        </div>
      </ZenCollapse>

      <div className="relative flex flex-1 min-h-0">
      {!zen.zen &&
        (filesDocked ? (
          <div className="max-md:hidden w-60 shrink-0 border-r-bw-1 border-ink">
            <FileSidebar docs={docState.docs} currentId={docState.currentId} actions={fileActions} cloud={cloud} onCollapse={() => pinFiles(false)} />
          </div>
        ) : (
          <FilesRail
            title={titleOf(source)}
            cloud={cloud}
            onShow={() => setFilesPeek(true)}
            onQuickOpen={() => setQuickOpen(true)}
            onCreate={() => fileActions.create(current ? folderOf(fileNameOf(current)) : '')}
          />
        ))}
      {!zen.zen && !filesDocked && filesPeek && (
        // Opened from the rail, over the panes: a click beside it or Escape folds it again.
        <div className="max-md:hidden absolute inset-0 z-30" onMouseDown={() => setFilesPeek(false)}>
          <div className="h-full w-60 border-r-bw-1 border-ink shadow-brutal-lg" onMouseDown={(e) => e.stopPropagation()}>
            <FileSidebar docs={docState.docs} currentId={docState.currentId} actions={fileActions} cloud={cloud} onPin={() => pinFiles(true)} onClose={() => setFilesPeek(false)} />
          </div>
        </div>
      )}
      {/* Side by side on wider screens, with a splitter between; phones show one pane at a time (the tabs above). */}
      <Group
        id="playground-split"
        className="flex-1 min-h-0 min-w-0 max-md:[&>[data-mobile-hidden]]:!hidden"
        defaultLayout={splitLayout}
        onLayoutChanged={(layout, meta) => {
          if (!meta.isUserInteraction) return;
          saveJson(SPLIT_KEY, layout);
          setSplitMoves((n) => n + 1);
        }}
      >
        <SplitPanel id="code" defaultSize="42%" minSize="240px" maxSize="75%" data-mobile-hidden={mobilePane !== 'code' || undefined} className="flex">
          <EditorZone
            id="pane-panel-code"
            data-tour="code"
            className="flex flex-1 min-h-0 min-w-0 flex-col"
          >
            {team && <TeamFileBar team={team} up={systems.crumbs[systems.crumbs.length - 2]} onBack={systems.goTo} />}
            {/* Hidden, not unmounted, while a team file is shown, so the document keeps its cursor and undo history. */}
            <div className="flex-1 min-h-0" hidden={!!team}>
              <CodeEditor ref={editorRef} value={source} onChange={typeSource} diagnostics={rootDiagnostics} nodeIds={nodeIds} />
            </div>
            {team && (
              <div className="flex-1 min-h-0">
                <CodeEditor
                  key={team.path}
                  ref={teamEditorRef}
                  value={team.source}
                  onChange={editTeam}
                  readOnly={!!team.readOnly}
                  diagnostics={teamDiagnostics}
                  nodeIds={shown.nodes.map((n) => n.id)}
                />
              </div>
            )}
            <DiagnosticsPanel diagnostics={diagnostics} onSelect={selectDiagnostic} />
          </EditorZone>
        </SplitPanel>
        <Separator
          aria-label="Resize the code and diagram panes"
          className="hidden md:block w-[2px] bg-ink outline-hidden transition-colors hover:bg-pop-pink focus-visible:bg-pop-pink data-[separator=active]:bg-pop-pink"
        />
        <SplitPanel id="diagram" minSize="320px" data-mobile-hidden={mobilePane !== 'diagram' || undefined} className="flex">
          <section id="pane-panel-diagram" className="flex flex-col flex-1 min-h-0 min-w-0">
            <ZenCollapse zen={zen.zen}>
              {!playing && <ViewTabs view={view} onChange={setView} results={simulation.results} />}
              {hasScenarios && useCase && scenario && (view === 'diagram' || playing) && (
                <ScenarioBar useCase={useCase} current={playing ? scenario.id : undefined} onPick={pickScenario} />
              )}
            </ZenCollapse>
            <div id={playing ? undefined : `view-panel-${view}`} className="flex-1 min-h-0 relative">
              <Suspense fallback={<PaneLoading />}>
                {view === 'results' && !playing ? (
                  <ResultsPanel
                    diagram={diagram}
                    analysis={simulation.analysis}
                    results={simulation.results}
                    onSelect={selectDiagnostic}
                    review={
                      <ReviewPanel
                        source={source}
                        input={() => editorReviewInput(parsedSource, parsed, simulation.analysis, simulation.results, { path: rootPath, imports })}
                        onSelect={selectDiagnostic}
                        onOpenPartner={hasPartner ? () => setPartnerOpen(true) : undefined}
                      />
                    }
                  />
                ) : view === 'hld' && !playing ? (
                  <HldView
                    diagram={diagram}
                    nodes={nodes}
                    edges={edges}
                    analysis={simulation.analysis}
                    results={simulation.results}
                    onOpenResults={() => setView('results')}
                  />
                ) : (
                  // Playback restyles this same canvas, so pressing Play does not swap, re-lay-out or re-fit it.
                  <UseCasePlayback
                    useCase={playing ? playedUseCase : undefined}
                    nodes={shownNodes}
                    edges={edges}
                    onBack={stopPlaying}
                    initialStep={initialStep}
                    onStepChange={setPlayStep}
                    showHeader={false}
                  >
                    {(pv) => (
                      <ReactFlowProvider>
                        <SystemActionsContext.Provider value={systemActions}>
                        <DiagramView
                          nodes={pv.nodes}
                          playback={pv}
                          overlay={overlay}
                          canOverlay={canOverlay}
                          onToggleOverlay={() => setOverlayOn((on) => !on)}
                          edges={pv.edges}
                          onNodesChange={setNodes}
                          onEdgesChange={setEdges}
                          title={shown.title}
                          hasPinnedNodes={!systems.focusFile && shown.nodes.some((n) => n.position)}
                          importedNodes={importedNodes}
                          onMoveNodes={moveNodes}
                          onConnectNodes={connectNodes}
                          onRenameNode={renameFromCanvas}
                          onAddNode={addFromCanvas}
                          onEdit={editSource}
                          onUndo={undoCanvas}
                          onRedo={redoCanvas}
                          phone={phone}
                          diagram={shown}
                          crumbs={systems.crumbs}
                          focusFile={systems.focusFile}
                          focusReadOnly={!team || !!team.readOnly}
                          focusInbound={systems.focusInbound}
                          onCrumb={systems.goTo}
                          onOpenSystem={(id) => (summaries.get(id)?.linked ? systems.open(id) : setNotice(`'${id}' is declared without a design; add from "file" to its block to open it.`))}
                          onResetLayout={() => editSource(clearPositions)}
                          onDelete={deleteFromCanvas}
                          onCopyNodes={copyFromCanvas}
                          onPasteNodes={pasteFromCanvas}
                          onDuplicateNodes={duplicateFromCanvas}
                          onReconnect={reconnectFromCanvas}
                          onUnpinNode={unpinFromCanvas}
                          onJumpToCode={jumpToCode}
                          fitKey={`${mobilePane}:${layoutSettled}`}
                          layoutBusy={layoutBusy}
                        glideKey={String(splitMoves)}
                          imageRequest={imageRequest}
                          onImageDone={() => setImageRequest(null)}
                          notice={notice}
                          onNotice={setNotice}
                          cover={tour === 'tour' ? tourCover : null}
                        />
                        </SystemActionsContext.Provider>
                      </ReactFlowProvider>
                    )}
                  </UseCasePlayback>
                )}
              </Suspense>
              {nodes.length === 0 && !playing && view === 'diagram' &&
                (isBlank(source) ? (
                  // Click-through, so the canvas's own Add component button (under this) still works.
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-y-auto p-4">
                    <Suspense fallback={null}>
                      <StarterCard onTemplate={setSource} onExamples={() => setShowExamples(true)} />
                    </Suspense>
                  </div>
                ) : (
                  <EmptyCanvas />
                ))}
            </div>
          </section>
        </SplitPanel>
      </Group>
      {hasPartner && !phone && <PartnerButton open={partnerOpen} onToggle={togglePartner} />}
      {hasPartner && (
        <PartnerDock open={partnerOpen} phone={phone} onClose={closePartner}>
          <Suspense fallback={<PaneLoading />}>
            <PartnerPanel
              storeKey={`editor:${current.id}`}
              context={EDITOR_CONTEXT}
              account={account}
              source={source}
              getSource={partnerSource}
              getFiles={partnerFiles}
              apply={applyPartner}
              undo={undoPartner}
              onClose={closePartner}
              diagramOf={partnerDiagram}
            />
          </Suspense>
        </PartnerDock>
      )}
      </div>

      {drawer && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/40" onMouseDown={() => setDrawer(false)}>
          <div className="h-full w-[min(20rem,85vw)] border-r-bw-2 border-ink shadow-brutal-lg" onMouseDown={(e) => e.stopPropagation()}>
            <FileSidebar docs={docState.docs} currentId={docState.currentId} actions={fileActions} cloud={cloud} onClose={() => setDrawer(false)} />
          </div>
        </div>
      )}

      {quickOpen && (
        <QuickOpen
          docs={docState.docs}
          currentId={docState.currentId}
          onOpen={(id) => fileActions.open(id)}
          onClose={() => setQuickOpen(false)}
        />
      )}

      {showShortcuts && <ShortcutsDialog partner={hasPartner} onClose={closeShortcuts} />}

      {showExamples && (
        <Suspense fallback={<PaneLoading overlay />}>
          <ExamplesGallery
            onClose={() => setShowExamples(false)}
            onPick={(picked, files) => {
              openExample(picked, files);
              setShowExamples(false);
            }}
          />
        </Suspense>
      )}

      {showShortLinks && (
        <Suspense fallback={<PaneLoading overlay />}>
          <ShortLinksDialog
            onClose={() => setShowShortLinks(false)}
            onDeleted={(id) => {
              if (shortLinkRef.current?.id === id) shortLinkRef.current = null;
            }}
          />
        </Suspense>
      )}

      {showShareLink && (
        <Suspense fallback={<PaneLoading overlay />}>
          <ShareLinkDialog docId={current.id} title={titleOf(source)} hint={shareHint} pushedVersion={cloud.pushedVersion} onClose={() => setShowShareLink(false)} />
        </Suspense>
      )}

      {showVersions && (
        <Suspense fallback={<PaneLoading overlay />}>
          <VersionsDialog
            docId={current.id}
            fileName={rootPath}
            hint={versionsHint}
            pushedVersion={cloud.pushedVersion}
            pull={cloud.pull}
            onView={(tag, listing) => {
              setShowVersions(false);
              setVersionView({ mode: { kind: 'view', tag }, versions: listing.versions });
            }}
            onCompare={(tag, listing) => {
              setShowVersions(false);
              setVersionView({ mode: { kind: 'compare', base: tag, target: '' }, versions: listing.versions });
            }}
            onCopy={(text, message) => {
              void copyText(text, 'Copy this:');
              setBanner({ message });
            }}
            onClose={() => setShowVersions(false)}
          />
        </Suspense>
      )}

      {versionView && (
        <Suspense fallback={<PaneLoading overlay />}>
          <VersionViewer
            docId={current.id}
            fileName={rootPath}
            versions={versionView.versions}
            mode={versionView.mode}
            onMode={(mode) => setVersionView((v) => (v ? { ...v, mode } : v))}
            draft={versionDraft}
            cloudFiles={cloudRefs.files}
            onClose={() => setVersionView(null)}
            onRestore={restoreVersion}
          />
        </Suspense>
      )}

      {showImport && (
        <Suspense fallback={<PaneLoading overlay />}>
          <ImportDialog
            onClose={() => setShowImport(false)}
            onOpen={(imported) => {
              openExample(imported);
              setShowImport(false);
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
  // The paid features (components/Feature.tsx) for everything below: the review panel, the share link dialog.
  return <FeaturesContext.Provider value={features}>{page}</FeaturesContext.Provider>;
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
      <span className={`hidden sm:inline px-1.5 shrink-0 ${eyebrow}`}>Scenarios</span>
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
            className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border-bw-1 px-3 py-1.5 sm:py-1 text-sm font-semibold whitespace-nowrap transition-[translate,transform,box-shadow] duration-d1 ${
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

/** Above the code pane while it shows a team file: which file, whether it can be edited here, and the way back. */
function TeamFileBar({ team, up, onBack }: { team: TeamFile; up: Crumb; onBack: (path: string) => void }) {
  return (
    <div className="border-b border-ink/15 bg-surface py-1 pl-1 pr-3 text-xs" aria-label="Team file" role="group">
      <div className="flex min-w-0 items-center gap-2">
        <button type="button" onClick={() => onBack(up.path)} title={`Back to ${up.name}`} className={`${iconButton} !h-7 !w-auto flex-none gap-1 !px-2 text-xs font-semibold`}>
          <ArrowLeft size={14} aria-hidden="true" />
          <span className="max-w-[8rem] truncate">{up.name}</span>
        </button>
        <span className="min-w-0 truncate font-mono text-ink" title={team.path}>
          {team.path}
        </span>
        <span className={`ml-auto flex-none ${team.readOnly ? 'font-bold text-ink' : 'text-muted'}`}>{team.readOnly ? 'Read-only' : 'Saved in this browser'}</span>
      </div>
      {team.readOnly && <p className="pb-0.5 pl-2 pt-0.5 text-ink/75">{team.readOnly}</p>}
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
              <AlertCircle size={14} className="text-fail shrink-0 mt-px" />
            ) : (
              <AlertTriangle size={14} className="text-pop-yellow shrink-0 mt-px" />
            )}
            <span className="text-muted tabular-nums shrink-0">
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
