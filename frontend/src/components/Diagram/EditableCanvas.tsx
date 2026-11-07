import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactFlow, { Background, BackgroundVariant, Controls, Panel, ReactFlowProvider } from 'reactflow';
import type { Edge, EdgeTypes, Node } from 'reactflow';
import 'reactflow/dist/style.css';
import ComponentNode from '../Canvas/ComponentNode';
import GroupNode from '../Canvas/GroupNode';
import SystemNode from '../Canvas/SystemNode';
import TextNode from '../Canvas/TextNode';
import RoutedEdge from '../Canvas/RoutedEdge';
import Legend from '../Canvas/Legend';
import { parse, type Diagram } from '../../dsl';
import { addConnection, addNode, removeConnections, removeNode, uniqueId } from '../../dsl/edit';
import { FIT_VIEW_OPTIONS, useFitOnChange } from './useFitOnChange';
import Inspector from './Inspector';
import { TECH_DRAG_TYPE } from './Palette';
import { CanvasMenu, ConnectHint, PaletteDock, PaletteToggle, type CanvasMenuState } from './CanvasEditing';
import { historyKey, useConnectHint, usePaletteOpen } from './canvasEditState';

/**
 * A laid-out canvas that edits its document's text: drag components in from
 * the palette, drag between dots to connect, select one to change its
 * settings, Delete or right-click to remove it. Nodes and connections from an
 * imported file (a practice problem's own) stay as they are; additions go into
 * this document. Every change is one dsl/edit.ts edit of `source`, which stays
 * the source of truth. The layout is automatic, so nodes are not dragged.
 */

const nodeTypes = { componentNode: ComponentNode, groupNode: GroupNode, systemNode: SystemNode, textNode: TextNode };
const EDGE_TYPES: EdgeTypes = { default: RoutedEdge };

interface EditableCanvasProps {
  /** This document's text, and the diagram parsed from it with its imports. */
  source: string;
  diagram: Diagram;
  /** Replaces the text; the code editor makes each change one undo step. */
  onChange: (next: string) => void;
  /** Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z on the canvas: the code editor's undo and redo. */
  onUndo: () => void;
  onRedo: () => void;
  nodes: Node[];
  edges: Edge[];
  /** Changes when the canvas becomes visible again or is laid out, so it can re-fit. */
  fitKey: string;
  /** Practice: capacity is the problem's (Inspector `problemCapacity`). */
  problemCapacity?: boolean;
  /** Where the palette's shown state is remembered. */
  paletteKey: string;
  phone: boolean;
}

type Selected = { kind: 'node' | 'edge'; id: string } | null;

function Canvas({ source, diagram, onChange, onUndo, onRedo, nodes, edges, fitKey, problemCapacity, paletteKey, phone }: EditableCanvasProps) {
  useFitOnChange(`${nodes.map((n) => n.id).join('|')}#${fitKey}`);
  const [selected, setSelected] = useState<Selected>(null);
  const [settingsClosed, setSettingsClosed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [menu, setMenu] = useState<CanvasMenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const [hintSeen, dismissHint] = useConnectHint();
  const [docked, setDocked] = usePaletteOpen(paletteKey);
  const [sheet, setSheet] = useState(false);
  const [paletteFocus, setPaletteFocus] = useState(false);
  const paletteOpen = phone ? sheet : docked;
  /** A component just added, selected once the layout draws it. */
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const imported = useMemo(() => new Map(diagram.nodes.filter((n) => n.loc.file !== undefined).map((n) => [n.id, n.loc.file!])), [diagram]);
  const node = selected?.kind === 'node' ? diagram.nodes.find((n) => n.id === selected.id) : undefined;
  const edge = selected?.kind === 'edge' ? diagram.edges.find((e) => e.id === selected.id) : undefined;
  // A selection the text no longer has (deleted, or renamed in the code) is dropped.
  const current: Selected = node || edge ? selected : null;

  const select = (next: Selected) => {
    setSelected(next);
    setSettingsClosed(false);
  };

  useEffect(() => {
    if (!pending || !nodes.some((n) => n.id === pending)) return;
    setSelected({ kind: 'node', id: pending });
    setSettingsClosed(false);
    setPending(null);
  }, [nodes, pending]);

  /** Adds a component where the layout puts it; a dropped one (or a phone's tap) is selected, a clicked one leaves the palette shown for the next. */
  const add = (tech: string, select: boolean) => {
    const id = uniqueId(source, tech, imported.keys());
    onChange(addNode(source, { id, name: tech, tech }).source);
    if (select) setPending(id);
  };

  const connect = (from: string, to: string) => {
    dismissHint();
    if (from === to || diagram.edges.some((e) => e.source === from && e.target === to)) return;
    onChange(addConnection(source, from, to));
  };

  const remove = () => {
    if (node) {
      const file = imported.get(node.id);
      if (file) return setNotice(`"${node.name}" is part of ${file}; it stays.`);
      const result = removeNode(source, node.id);
      if (result.error !== undefined) return setNotice(result.error);
      onChange(result.source);
    } else if (edge) {
      if (edge.loc.file) return setNotice(`That connection is part of ${edge.loc.file}; it stays.`);
      // Edge ids count duplicates across every file; the text edit needs this document's own ids.
      const own = parse(source).diagram.edges.filter((e) => e.loc.line === edge.loc.line).map((e) => e.id);
      onChange(removeConnections(source, own));
    }
    setSelected(null);
  };

  const shownNodes = useMemo(() => nodes.map((n) => (current?.kind === 'node' && n.id === current.id ? { ...n, selected: true } : n)), [nodes, current]);
  const shownEdges = useMemo(() => edges.map((e) => (current?.kind === 'edge' && e.id === current.id ? { ...e, selected: true } : e)), [edges, current]);

  // With the palette docked, the settings take its place beside the canvas instead of covering the diagram.
  const dockSettings = !!current && !settingsClosed && paletteOpen && !phone;
  const inspector = current && !settingsClosed && (
    <Inspector
      key={current.id}
      node={node}
      edge={node ? undefined : edge}
      capacity={node ? diagram.capacity?.find((c) => c.node === node.id) : undefined}
      importedFrom={node ? imported.get(node.id) : edge?.loc.file}
      problemCapacity={problemCapacity}
      docked={dockSettings}
      onEdit={(edit) => onChange(edit(source))}
      onDelete={remove}
      onClose={() => setSettingsClosed(true)}
    />
  );

  return (
    <div
      className="flex h-full"
      onKeyDown={(e) => {
        const step = historyKey(e);
        if (!step) return;
        e.preventDefault();
        if (step === 'undo') onUndo();
        else onRedo();
      }}
    >
      <PaletteDock
        open={paletteOpen}
        phone={phone}
        focus={paletteFocus}
        onAdd={(tech) => add(tech, phone)}
        onClose={() => (phone ? setSheet(false) : setDocked(false))}
        settings={dockSettings ? inspector : undefined}
      />
      <div
        tabIndex={-1}
        className="pc-editable relative h-full min-w-0 flex-1 outline-hidden"
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(TECH_DRAG_TYPE)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(e) => {
          const tech = e.dataTransfer.getData(TECH_DRAG_TYPE);
          if (!tech) return;
          e.preventDefault();
          e.currentTarget.focus();
          add(tech, true);
        }}
        onKeyDown={(e) => {
          if ((e.key === 'Delete' || e.key === 'Backspace') && current && !(e.target as Element).closest('input, textarea, select, [contenteditable]')) {
            e.preventDefault();
            remove();
          }
        }}
      >
        <ReactFlow
          nodes={shownNodes}
          edges={shownEdges}
          nodeTypes={nodeTypes}
          edgeTypes={EDGE_TYPES}
          // Laid out automatically: there is no position to drag to.
          nodesDraggable={false}
          nodesConnectable
          elementsSelectable
          onNodeClick={(_e, n) => select({ kind: 'node', id: n.id })}
          onEdgeClick={(_e, ed) => select({ kind: 'edge', id: ed.id })}
          onPaneClick={() => setSelected(null)}
          onConnect={(c) => c.source && c.target && connect(c.source, c.target)}
          onNodeContextMenu={(e, n) => {
            e.preventDefault();
            select({ kind: 'node', id: n.id });
            setMenu({ x: e.clientX, y: e.clientY, label: n.data?.name ?? n.id });
          }}
          onEdgeContextMenu={(e, ed) => {
            e.preventDefault();
            select({ kind: 'edge', id: ed.id });
            setMenu({ x: e.clientX, y: e.clientY, label: `${ed.source} → ${ed.target}` });
          }}
          deleteKeyCode={null}
          zoomOnDoubleClick={false}
          fitView
          fitViewOptions={FIT_VIEW_OPTIONS}
          minZoom={0.1}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <Controls showInteractive={false} />
          <Panel position="top-left">
            {/* While the settings stand in for the palette, the button brings the palette back. */}
            <PaletteToggle
              open={paletteOpen && !dockSettings}
              onToggle={() => {
                if (dockSettings) return setSettingsClosed(true);
                setPaletteFocus(!paletteOpen);
                if (phone) setSheet(!sheet);
                else setDocked(!docked);
              }}
            />
          </Panel>
          {!hintSeen && nodes.length >= 2 && edges.length === 0 && (
            <Panel position="top-center" className="max-md:!top-12">
              <ConnectHint onDismiss={dismissHint} />
            </Panel>
          )}
          {diagram.legend && (
            <Panel position="top-right">
              <Legend entries={diagram.legend} />
            </Panel>
          )}
          {notice && (
            <Panel position="bottom-center">
              <p role="status" className="rounded-sm border-bw-1 border-ink bg-ink px-3 py-1.5 text-xs font-semibold text-paper shadow-brutal-sm">
                {notice}
              </p>
            </Panel>
          )}
        </ReactFlow>
        {inspector && !dockSettings && (
          <div className="pointer-events-none absolute inset-x-2 bottom-2 z-10 flex max-h-[55%] md:inset-x-auto md:bottom-auto md:right-2 md:top-14 md:max-h-[calc(100%-4.5rem)] md:w-72">
            {inspector}
          </div>
        )}
        {menu && <CanvasMenu menu={menu} onSettings={() => setSettingsClosed(false)} onDelete={remove} onClose={closeMenu} />}
      </div>
    </div>
  );
}

export default function EditableCanvas(props: EditableCanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
