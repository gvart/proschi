import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  ReactFlowProvider,
  applyNodeChanges,
  useNodesInitialized,
  useReactFlow,
} from 'reactflow';
import type { Edge, Node, NodeChange } from 'reactflow';
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
} from 'lucide-react';
import { ecommerceExample, parse, type Diagnostic } from '../../dsl';
import { layoutDiagram, toFlowEdges } from '../../dsl/layout';
import { loadJson, saveJson } from '../../services/storage';
import {
  BLANK_SOURCE,
  addDoc,
  currentDoc,
  initialState,
  removeDoc,
  selectDoc,
  titleOf,
  updateCurrent,
  type DocumentState,
} from '../../playground/documents';
import { decodeShareLink, encodeShareHash, shareUrl, type PlaybackTarget } from '../../playground/share';
import { addConnection, clearPositions, renameNode, setNodePosition } from '../../dsl/edit';
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
  return initialState({
    stored: loadJson<DocumentState | null>(DOCS_KEY, null),
    legacySource: loadJson<string | null>(LEGACY_SOURCE_KEY, null),
    sharedSource: decodeShareLink(window.location.hash)?.source ?? null,
    fallbackSource: ecommerceExample,
  });
}

interface PlaygroundProps {
  onOpenBuilder: () => void;
}

export default function Playground({ onOpenBuilder }: PlaygroundProps) {
  const [docState, setDocState] = useState(loadInitialState);
  const source = currentDoc(docState).source;
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
  const [playing, setPlaying] = useState(!!linkPlayback);
  const [initialStep, setInitialStep] = useState(linkPlayback ? linkPlayback.step - 1 : undefined);
  const [playStep, setPlayStep] = useState(0);
  const [showExamples, setShowExamples] = useState(false);
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

  const { diagram, diagnostics } = useMemo(() => parse(parsedSource), [parsedSource]);
  const nodeIds = useMemo(() => diagram.nodes.map((n) => n.id), [diagram]);
  const useCase = diagram.useCases.find((u) => u.id === selectedUseCaseId) ?? diagram.useCases[0];
  const playback: PlaybackTarget | undefined = playing && useCase ? { useCase: useCase.id, step: playStep + 1 } : undefined;
  const playbackKey = playback ? `${playback.useCase}#${playback.step}` : '';

  // Keep the address bar a shareable link to the diagram, and to the current step while playing.
  useEffect(() => {
    const timer = setTimeout(() => {
      window.history.replaceState(null, '', encodeShareHash(source, playback));
    }, PARSE_DELAY_MS);
    return () => clearTimeout(timer);
    // playbackKey captures playback by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, playbackKey]);

  const [nodes, setNodes] = useState<Node[]>([]);
  const edges = useMemo(() => toFlowEdges(diagram), [diagram]);

  useEffect(() => {
    let cancelled = false;
    layoutDiagram(diagram)
      .then((laidOut) => !cancelled && setNodes(laidOut))
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
  };

  const deleteDoc = (id: string, title: string) => {
    if (window.confirm(`Delete "${title}"? This cannot be undone.`)) openDoc((s) => removeDoc(s, id));
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    openDoc((s) => addDoc(s, text));
  };

  const copyShareLink = async () => {
    const url = shareUrl(source, window.location, playback);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this link:', url);
    }
  };

  const canPlay = !!useCase && useCase.steps.length > 0;
  const sortedDocs = [...docState.docs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <header className="flex flex-wrap items-center gap-2 px-4 py-2 bg-white border-b border-gray-200">
        <span className="text-lg font-bold text-gray-900 mr-1">Proschi</span>

        <Menu
          label="Diagrams"
          trigger={
            <>
              <span className="max-w-[14rem] truncate">{titleOf(source)}</span>
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
                        <span className="block text-xs font-normal text-gray-400">{new Date(doc.updatedAt).toLocaleString()}</span>
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
                  downloadText(source, fileNameFor(diagram.title, 'proschi'));
                  close();
                }}
              >
                Download .proschi file
              </MenuItem>
            </>
          )}
        </Menu>
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

        <div className="flex flex-wrap items-center gap-2 ml-auto">
          <button
            onClick={() => setShowExamples(true)}
            className="inline-flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded-md text-gray-700 hover:bg-gray-100"
          >
            <BookOpen size={16} />
            Examples
          </button>

          <select
            aria-label="Use case"
            value={useCase?.id ?? ''}
            onChange={(e) => {
              setSelectedUseCaseId(e.target.value);
              setInitialStep(undefined);
            }}
            disabled={diagram.useCases.length === 0}
            className="text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white disabled:text-gray-400 max-w-[12rem]"
          >
            {diagram.useCases.length === 0 && <option value="">No use cases</option>}
            {diagram.useCases.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>

          {playing ? (
            <button
              onClick={stopPlaying}
              className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              <LayoutGrid size={16} />
              Diagram
            </button>
          ) : (
            <button
              onClick={() => setPlaying(true)}
              disabled={!canPlay}
              title={canPlay ? 'Play this use case' : 'Add a usecase with steps to play it'}
              className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play size={16} />
              Play
            </button>
          )}

          <button
            onClick={copyShareLink}
            title={playing ? 'Copy a link to this step of the use case' : 'Copy a link that contains this diagram'}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            {copied ? <Check size={16} className="text-green-600" /> : <Link size={16} />}
            {copied ? 'Copied' : 'Share'}
          </button>

          <button onClick={onOpenBuilder} className="text-sm px-3 py-1.5 rounded-md text-gray-600 hover:bg-gray-100">
            Visual builder
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex flex-col md:flex-row">
        <section className="h-[45vh] md:h-auto md:w-[42%] md:max-w-[720px] flex flex-col border-b md:border-b-0 md:border-r border-gray-200 bg-white">
          <div className="flex-1 min-h-0">
            <CodeEditor ref={editorRef} value={source} onChange={setSource} diagnostics={diagnostics} nodeIds={nodeIds} />
          </div>
          <DiagnosticsPanel diagnostics={diagnostics} onSelect={(d) => editorRef.current?.goTo(d.line, d.col)} />
        </section>

        <section className="flex-1 min-h-0 min-w-0 relative">
          {playing && useCase ? (
            <UseCasePlayer
              useCase={useCase}
              nodes={nodes}
              edges={edges}
              onBack={stopPlaying}
              initialStep={initialStep}
              onStepChange={setPlayStep}
            />
          ) : (
            <ReactFlowProvider>
              <DiagramView
                nodes={nodes}
                edges={edges}
                onNodesChange={setNodes}
                title={diagram.title}
                hasPinnedNodes={diagram.nodes.some((n) => n.position)}
                onMoveNodes={(moved) => editSource((src) => moved.reduce((acc, n) => setNodePosition(acc, n.id, n.position), src))}
                onConnectNodes={(from, to) => editSource((src) => addConnection(src, from, to))}
                onRenameNode={(id, name) => editSource((src) => renameNode(src, id, name))}
                onResetLayout={() => editSource(clearPositions)}
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

interface DiagramViewProps {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: (update: (nodes: Node[]) => Node[]) => void;
  title?: string;
  hasPinnedNodes: boolean;
  onMoveNodes: (moved: { id: string; position: { x: number; y: number } }[]) => void;
  onConnectNodes: (from: string, to: string) => void;
  onRenameNode: (id: string, name: string) => void;
  onResetLayout: () => void;
}

/** Renders the parsed diagram. Canvas edits are written back to the text, which stays the source of truth. */
function DiagramView({
  nodes,
  edges,
  onNodesChange,
  title,
  hasPinnedNodes,
  onMoveNodes,
  onConnectNodes,
  onRenameNode,
  onResetLayout,
}: DiagramViewProps) {
  const { fitView, getNodes } = useReactFlow();
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
    const frame = requestAnimationFrame(() => fitView({ padding: 0.15, duration: 200 }));
    return () => cancelAnimationFrame(frame);
  }, [structure, measured, fitView]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => onNodesChange((current) => applyNodeChanges(changes, current)),
    [onNodesChange],
  );

  return (
    <div ref={wrapperRef} className="h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onNodeDragStop={(_event, _node, dragged) => onMoveNodes(dragged.map((n) => ({ id: n.id, position: n.position })))}
        onConnect={(connection) => connection.source && connection.target && onConnectNodes(connection.source, connection.target)}
        onNodeDoubleClick={(_event, node) => {
          const name = window.prompt('Display name', node.data?.name ?? node.id);
          if (name !== null) onRenameNode(node.id, name);
        }}
        zoomOnDoubleClick={false}
        fitView
        minZoom={0.1}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls showInteractive={false} />
        {nodes.length > 0 && (
          <Panel position="bottom-right" className="hidden md:block text-xs text-gray-400 bg-white/80 rounded px-2 py-1">
            Drag to pin · double-click to rename · drag between dots to connect
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
              {d.line}:{d.col}
            </span>
            <span className="text-gray-800">{d.message}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
