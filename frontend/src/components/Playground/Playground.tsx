import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlowProvider,
  applyNodeChanges,
  useNodesInitialized,
  useReactFlow,
} from 'reactflow';
import type { Edge, Node, NodeChange } from 'reactflow';
import 'reactflow/dist/style.css';
import { AlertCircle, AlertTriangle, CheckCircle2, LayoutGrid, Play } from 'lucide-react';
import { ecommerceExample, parse, type Diagnostic } from '../../dsl';
import { layoutDiagram, toFlowEdges } from '../../dsl/layout';
import { loadJson, saveJson } from '../../services/storage';
import ComponentNode from '../Canvas/ComponentNode';
import GroupNode from '../Canvas/GroupNode';
import TextNode from '../Canvas/TextNode';
import { UseCasePlayer } from '../UseCases/UseCasePlayback';
import CodeEditor, { type CodeEditorHandle } from './CodeEditor';

const SOURCE_KEY = 'proschi.playground.source';
const PARSE_DELAY_MS = 150;

const nodeTypes = {
  componentNode: ComponentNode,
  groupNode: GroupNode,
  textNode: TextNode,
};

const examples: Record<string, string> = {
  'E-commerce': ecommerceExample,
  Blank: 'title "Untitled"\n\n',
};

interface PlaygroundProps {
  onOpenBuilder: () => void;
}

export default function Playground({ onOpenBuilder }: PlaygroundProps) {
  const [source, setSource] = useState(() => loadJson(SOURCE_KEY, ecommerceExample));
  const [parsedSource, setParsedSource] = useState(source);
  const [selectedUseCaseId, setSelectedUseCaseId] = useState<string>();
  const [playing, setPlaying] = useState(false);
  const editorRef = useRef<CodeEditorHandle>(null);

  // Re-parse and save shortly after typing stops.
  useEffect(() => {
    const timer = setTimeout(() => {
      setParsedSource(source);
      saveJson(SOURCE_KEY, source);
    }, PARSE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [source]);

  const { diagram, diagnostics } = useMemo(() => parse(parsedSource), [parsedSource]);
  const nodeIds = useMemo(() => diagram.nodes.map((n) => n.id), [diagram]);
  const useCase = diagram.useCases.find((u) => u.id === selectedUseCaseId) ?? diagram.useCases[0];

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

  const loadExample = (name: string) => {
    const isExample = Object.values(examples).includes(source);
    if (!isExample && !window.confirm('Replace your current diagram with this example?')) return;
    setSource(examples[name]);
    setPlaying(false);
  };

  const canPlay = !!useCase && useCase.steps.length > 0;

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <header className="flex flex-wrap items-center gap-3 px-4 py-2 bg-white border-b border-gray-200">
        <div className="flex items-baseline gap-3 min-w-0">
          <span className="text-lg font-bold text-gray-900">Proschi</span>
          <span className="text-sm text-gray-500 truncate">{diagram.title}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2 ml-auto">
          <select
            aria-label="Load example"
            value=""
            onChange={(e) => e.target.value && loadExample(e.target.value)}
            className="text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white"
          >
            <option value="">Examples…</option>
            {Object.keys(examples).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          <select
            aria-label="Use case"
            value={useCase?.id ?? ''}
            onChange={(e) => setSelectedUseCaseId(e.target.value)}
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
              onClick={() => setPlaying(false)}
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
            <UseCasePlayer useCase={useCase} nodes={nodes} edges={edges} onBack={() => setPlaying(false)} />
          ) : (
            <ReactFlowProvider>
              <DiagramView nodes={nodes} edges={edges} onNodesChange={setNodes} />
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
    </div>
  );
}

interface DiagramViewProps {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: (update: (nodes: Node[]) => Node[]) => void;
}

/** Read-only rendering of the parsed diagram; nodes can be dragged but edits stay in the text. */
function DiagramView({ nodes, edges, onNodesChange }: DiagramViewProps) {
  const { fitView } = useReactFlow();
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
    [onNodesChange]
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={handleNodesChange}
      nodesConnectable={false}
      fitView
      minZoom={0.1}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
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
          <button
            onClick={() => onSelect(d)}
            className="w-full flex items-start gap-2 px-3 py-1.5 text-left hover:bg-gray-100"
          >
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
