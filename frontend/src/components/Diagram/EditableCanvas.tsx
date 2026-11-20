import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, { Background, BackgroundVariant, Controls, Panel, ReactFlowProvider, useReactFlow } from 'reactflow';
import type { Edge, EdgeTypes, Node, NodeChange } from 'reactflow';
import 'reactflow/dist/style.css';
import ComponentNode from '../Canvas/ComponentNode';
import GroupNode from '../Canvas/GroupNode';
import SystemNode from '../Canvas/SystemNode';
import TextNode from '../Canvas/TextNode';
import RoutedEdge from '../Canvas/RoutedEdge';
import FlowParticles from '../Overlay/FlowParticles';
import { parse, type Diagram } from '../../dsl';
import { addConnection, removeConnections, removeNode, renameNode } from '../../dsl/edit';
import { analysisOverlay } from '../../sim/overlay';
import type { Analysis } from '../../sim';
import { prompt } from '../../design/dialogs';
import { FIT_VIEW_OPTIONS, useFitOnChange } from './useFitOnChange';
import Inspector from './Inspector';
import { TECH_DRAG_TYPE } from './Palette';
import { AddAfterPicker, CanvasMenu, ConnectHint, EmptyCanvas, FlowsToggle, PaletteDock, PaletteToggle, type AddAfterState, type CanvasMenuActions, type CanvasMenuState } from './CanvasEditing';
import { addComponent, nameNode, namedElsewhere } from './addFlow';
import { NodeActionsContext, type NodeActions } from '../Canvas/nodeActions';
import FlowsPanel, { type StepPick } from './FlowsPanel';
import { nextPick } from './flows';
import { canvasKey, historyKey, useConnectHint, useMiniMap, usePaletteOpen, type CanvasKey } from './canvasEditState';
import { CanvasMiniMap, CanvasTopBar, MiniMapButton, OverlayTools } from './CanvasTools';
import { finderItemsOf, useOverlayOn, usePinDrag, useTopBarInset, withEdgeLoads, withNodeLoads } from './canvasShared';
import { useCanvasEdits } from './useCanvasEdits';
import { ConnectAtAnyZoom, connectionLabels, newConnection, useConnectDrop } from './connect';
import NodeFinder from './NodeFinder';

/**
 * A laid-out canvas that edits its document's text: drag components in from
 * the palette, drag between dots to connect, select one to change its
 * settings, Delete or right-click to remove it. Nodes and connections from an
 * imported file (a practice problem's own) stay as they are; additions go into
 * this document. Every change is one dsl/edit.ts edit of `source`, which stays
 * the source of truth. As on the editor's canvas (DiagramView), dragging a node
 * pins it (`pos x,y`) and Auto-layout unpins them all, the load overlay shows
 * how busy each node is, and the right-click menu, copy and paste, the node
 * finder and the minimap work the same; the shared parts are in
 * canvasShared.ts, CanvasTools.tsx and useCanvasEdits.ts.
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
  /** A layout is on its way (ELK, then the glide): `data-layout-busy` on the canvas, which the e2e tests wait out. */
  layoutBusy?: boolean;
  /** Practice: capacity is the problem's (Inspector `problemCapacity`). */
  problemCapacity?: boolean;
  /** Where the palette's shown state is remembered. */
  paletteKey: string;
  phone: boolean;
  /** Offers the Flows builder (use cases and scenarios without code, FlowsPanel.tsx). */
  flows?: boolean;
  /**
   * Simulates the design for the load overlay (on by default when it has traffic, remembered under
   * `overlayKey`); without it there is no overlay (the interview, where the load would give the estimates away).
   */
  simulate?: (diagram: Diagram) => Analysis | undefined;
  overlayKey?: string;
}

type Selected = { kind: 'node' | 'edge'; id: string } | null;

/** How much of the canvas's right side a floating panel covers, with its margin: the palette (w-64), the settings (w-72). */
const FLOATING_PALETTE = 256 + 8;
const FLOATING_SETTINGS = 288 + 8;

type XY = { x: number; y: number };
const NO_MOVES: ReadonlyMap<string, XY> = new Map();

function Canvas({ source, diagram, onChange, onUndo, onRedo, nodes, edges, fitKey, layoutBusy, problemCapacity, paletteKey, phone, flows = false, simulate, overlayKey = 'proschi.practice.overlay' }: EditableCanvasProps) {
  const { fitView } = useReactFlow();
  const [selected, setSelected] = useState<Selected>(null);
  const [settingsClosed, setSettingsClosed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [menu, setMenu] = useState<CanvasMenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const [hintSeen, dismissHint] = useConnectHint();
  const [docked, setDocked] = usePaletteOpen(paletteKey);
  const [sheet, setSheet] = useState(false);
  const [paletteFocus, setPaletteFocus] = useState(false);
  const [flowsShown, setFlowsShown] = usePaletteOpen(`${paletteKey}.flows`);
  const flowsOpen = flows && flowsShown;
  /** The Flows builder's use case, kept here so closing the builder doesn't forget it. */
  const [flowsUseCase, setFlowsUseCase] = useState<string>();
  /** The step being added in the Flows builder: node clicks pick its ends instead of selecting. */
  const [pick, setPick] = useState<StepPick | null>(null);
  /** The two components of the Flows step row under the pointer, lit up on the canvas. */
  const [flowHover, setFlowHover] = useState<string[] | null>(null);
  const paletteOpen = (phone ? sheet : docked) && !flowsOpen;
  /** Whether the palette floats over the canvas (a narrow pane) rather than sitting beside it. */
  const [floating, setFloating] = useState(false);
  /** A component just added, selected once the layout draws it; `settings` opens its settings (a drop), else the palette stays for the next. */
  const [pending, setPending] = useState<{ id: string; settings: boolean } | null>(null);
  /** The component whose name is typed on the canvas (ComponentNode's field). */
  const [editing, setEditing] = useState<string | null>(null);
  /** The type picker of a node's "+", or of a connection let go on empty canvas. */
  const [addAfter, setAddAfter] = useState<AddAfterState | null>(null);
  const closeAddAfter = useCallback(() => setAddAfter(null), []);
  /** The last id a name changed, so a click that comes before the layout catches up still means that node. */
  const renamed = useRef<{ from: string; to: string } | null>(null);
  /** The component added last on this canvas: the fit keeps it readable (useFitOnChange `added`). */
  const [lastAdded, setLastAdded] = useState<string>();

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const imported = useMemo(() => new Map(diagram.nodes.filter((n) => n.loc.file !== undefined).map((n) => [n.id, n.loc.file!])), [diagram]);
  const edits = useCanvasEdits({ source, diagram, apply: (edit) => onChange(edit(source)), imported, onNotice: setNotice });
  const [miniMap, setMiniMap] = useMiniMap();
  /** The node finder: to jump to a node, or to pick the one to connect `from` to. */
  const [finder, setFinder] = useState<{ connectFrom?: string } | null>(null);

  // The load overlay, as on the editor's canvas: on by default once the design (with the problem's file) has traffic.
  const [overlayOn, toggleOverlay] = useOverlayOn(overlayKey);
  const canOverlay = !!simulate && (diagram.traffic?.length ?? 0) > 0;
  const overlay = useMemo(() => {
    if (!overlayOn || !canOverlay) return undefined;
    const analysis = simulate?.(diagram);
    return analysis ? analysisOverlay(diagram, analysis) : undefined;
  }, [overlayOn, canOverlay, simulate, diagram]);
  const pinned = diagram.nodes.some((n) => n.position && !imported.has(n.id));

  // Where nodes were dragged to, until the next layout (which has their new `pos`) replaces `nodes`; and the
  // sizes React Flow measured, so a node redrawn mid-drag is not hidden until measured again.
  const [drag, setDrag] = useState<{ of: Node[]; at: ReadonlyMap<string, XY> }>({ of: nodes, at: NO_MOVES });
  const moves = drag.of === nodes ? drag.at : NO_MOVES;
  const [sizes, setSizes] = useState<ReadonlyMap<string, { type?: string; width: number; height: number }>>(new Map());
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const at = new Map<string, XY>();
      const measured = new Map<string, { width: number; height: number }>();
      for (const c of changes) {
        if (c.type === 'position' && c.position) at.set(c.id, c.position);
        if (c.type === 'dimensions' && c.dimensions) measured.set(c.id, c.dimensions);
      }
      if (at.size > 0) setDrag((d) => ({ of: nodes, at: new Map([...(d.of === nodes ? d.at : NO_MOVES), ...at]) }));
      if (measured.size > 0) {
        const types = new Map(nodes.map((n) => [n.id, n.type]));
        setSizes((s) => new Map([...s, ...[...measured].map(([id, size]) => [id, { ...size, type: types.get(id) }] as const)]));
      }
    },
    [nodes],
  );
  const pinDrag = usePinDrag({
    imported,
    onMove: edits.move,
    restore: (back) => setDrag((d) => ({ of: nodes, at: new Map([...d.at].filter(([id]) => !back.has(id))) })),
    onNotice: setNotice,
    lockedNotice: (id, file) => `"${diagram.nodes.find((n) => n.id === id)?.name ?? id}" is part of ${file}; it stays where the layout puts it.`,
  });
  const node = selected?.kind === 'node' ? diagram.nodes.find((n) => n.id === selected.id) : undefined;
  const edge = selected?.kind === 'edge' ? diagram.edges.find((e) => e.id === selected.id) : undefined;
  // A selection the text no longer has (deleted, or renamed in the code) is dropped.
  const current: Selected = node || edge ? selected : null;

  const canvasRef = useRef<HTMLDivElement>(null);
  /**
   * Keeps the keys on the canvas. A selected connection is drawn again (React Flow lifts it), so the focus
   * a click gave it falls to the page and Delete never reached the canvas; a removed one takes it along too.
   */
  const keepFocus = () => {
    if (!canvasRef.current?.contains(document.activeElement)) return;
    canvasRef.current.focus({ preventScroll: true });
  };

  const select = (next: Selected) => {
    setSelected(next);
    setSettingsClosed(false);
    keepFocus();
  };

  useEffect(() => {
    if (!pending || !nodes.some((n) => n.id === pending.id)) return;
    setSelected({ kind: 'node', id: pending.id });
    setSettingsClosed(!pending.settings);
    setPending(null);
  }, [nodes, pending]);

  /** The component a new one is connected from: the one just added, else the selected component or system. */
  const chainFrom = (() => {
    const id = pending?.id ?? (node && (node.kind === 'component' || node.kind === 'system') ? node.id : undefined);
    return id && renamed.current?.from === id ? renamed.current.to : id;
  })();
  /**
   * Adds a component where the layout puts it, connected from `from` (a palette click: the selection), selected,
   * with its name ready to type. A dropped one opens its settings; one clicked leaves the palette for the next.
   */
  const add = (tech: string, { from, drop = false }: { from?: string; drop?: boolean } = {}) => {
    const result = addComponent(source, tech, { from, taken: imported.keys() });
    onChange(result.source);
    if (from) dismissHint();
    setPending({ id: result.id, settings: drop });
    setEditing(result.id);
    setLastAdded(result.id);
  };
  /** The name typed on the canvas: written, and the id follows it while it is the generated one. */
  const finishName = (id: string, name: string | null) => {
    setEditing(null);
    // Enter or Escape: back to the canvas's keys (a click elsewhere keeps its own focus).
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) canvasRef.current?.focus({ preventScroll: true });
    });
    if (name === null) return;
    const result = nameNode(source, id, name, { taken: imported.keys(), keepId: namedElsewhere(diagram, id) });
    if (result.source === source) return;
    onChange(result.source);
    if (result.id !== id) {
      renamed.current = { from: id, to: result.id };
      if (lastAdded === id) setLastAdded(result.id);
      if (current?.kind === 'node' && current.id === id) setSelected({ kind: 'node', id: result.id });
    }
  };

  const connect = (from: string, to: string) => {
    dismissHint();
    const { error, label } = newConnection(diagram, from, to);
    if (error !== undefined) return setNotice(error);
    onChange(addConnection(source, from, to, label));
  };
  const connectDrop = useConnectDrop(diagram, connect, setNotice, (from, at) => setAddAfter({ from, ...at }));

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
    keepFocus();
  };

  const shownNodes = useMemo(() => {
    // While a step is picked, its ends are marked instead of the selection.
    const marked = flowHover && flowsOpen ? flowHover : pick && flowsOpen ? [pick.from, pick.to] : current?.kind === 'node' ? [current.id] : [];
    const drawn = nodes.map((n) => {
      const at = moves.get(n.id);
      const size = sizes.get(n.id);
      const measured = size && size.type === n.type && !n.width ? { width: size.width, height: size.height } : {};
      return marked.includes(n.id) || at || measured.width ? { ...n, ...measured, ...(at ? { position: at } : {}), ...(marked.includes(n.id) ? { selected: true } : {}) } : n;
    });
    return withNodeLoads(drawn, overlay);
  }, [nodes, current, pick, flowHover, flowsOpen, moves, sizes, overlay]);
  const pickNode = (id: string) => {
    if (pick) setPick(nextPick(pick, id));
  };
  const toggleFlows = () => {
    setPick(null);
    if (!flowsOpen) {
      setSelected(null);
      if (phone) setSheet(false);
      else setDocked(false);
    }
    setFlowsShown(!flowsOpen);
  };
  const flowsPanel = flowsOpen && (
    <FlowsPanel source={source} diagram={diagram} onChange={onChange} pick={pick} onPick={setPick} useCase={flowsUseCase} onUseCase={setFlowsUseCase} onClose={toggleFlows} onHighlight={setFlowHover} />
  );
  const shownEdges = useMemo(
    () => withEdgeLoads(edges.map((e) => (current?.kind === 'edge' && e.id === current.id ? { ...e, selected: true } : e)), overlay),
    [edges, current, overlay],
  );

  /** Selects a node once the layout draws it (a paste or a duplicate: the first of its new nodes). */
  const selectNew = (ids: string[] | undefined) => {
    if (ids?.length) setPending({ id: ids[0], settings: true });
  };
  /** Names a component in place on the canvas; other nodes (a group, a note) in a dialog. */
  const rename = async (id: string) => {
    const target = diagram.nodes.find((n) => n.id === id);
    if (!target) return;
    const file = imported.get(id);
    if (file) return setNotice(`"${target.name}" is part of ${file}; it stays.`);
    if (target.kind === 'component' && nodes.find((n) => n.id === id)?.type === 'componentNode') return setEditing(id);
    const name = await prompt({ title: 'Rename', label: 'Display name', defaultValue: target.name, confirmLabel: 'Rename' });
    if (name !== null) onChange(renameNode(source, id, name));
  };
  /** Ctrl/Cmd+C, V and D, and `/` or Ctrl/Cmd+F; false when the key is left to the browser (Ctrl+C with nothing selected). */
  const runCanvasKey = (key: CanvasKey): boolean => {
    const ids = current?.kind === 'node' ? [current.id] : [];
    if (key === 'copy') {
      if (ids.length === 0) return false;
      edits.copy(ids);
    } else if (key === 'paste') selectNew(edits.paste());
    else if (key === 'duplicate') {
      if (ids.length > 0) selectNew(edits.duplicate(ids));
    } else if (key === 'rename') {
      if (ids.length === 0) return false;
      void rename(ids[0]);
    } else setFinder({});
    return true;
  };
  const pickFound = (id: string) => {
    if (finder?.connectFrom) return connect(finder.connectFrom, id);
    select({ kind: 'node', id });
    void fitView({ nodes: [{ id }], duration: 300, maxZoom: 1.25, padding: 0.5 });
  };
  const closeFinder = () => {
    setFinder(null);
    // Back on the canvas, so its keys work again.
    canvasRef.current?.focus({ preventScroll: true });
  };
  /** The right-click menu's actions for the node it was opened on (a connection has Settings and Delete). */
  const menuActions = (): CanvasMenuActions => {
    const target = menu?.id ? diagram.nodes.find((n) => n.id === menu.id) : undefined;
    if (!target) return {};
    const own = !imported.has(target.id);
    const plain = target.kind === 'component' || target.kind === 'text';
    return {
      onRename: () => void rename(target.id),
      onDuplicate: own && plain ? () => selectNew(edits.duplicate([target.id])) : undefined,
      onConnect: target.kind === 'component' || target.kind === 'system' ? () => setFinder({ connectFrom: target.id }) : undefined,
      onUnpin: own && target.position ? () => edits.unpin(target.id) : undefined,
    };
  };

  // With the palette docked, the settings take its place beside the canvas instead of covering the diagram.
  const dockSettings = !!current && !settingsClosed && (paletteOpen || flowsOpen) && !phone;
  // Showing or hiding a panel glides the diagram to a new fit (unless the reader zoomed or panned): a docked one
  // changes the canvas's width, a floating one (the palette in a narrow pane, the settings) covers its right side.
  const cover = (paletteOpen || flowsOpen) && !phone && floating ? (flowsOpen ? FLOATING_SETTINGS : FLOATING_PALETTE) : current && !settingsClosed && !dockSettings && !phone ? FLOATING_SETTINGS : 0;
  // Below the top bar's buttons, tools and folded legend, so no node of the fit sits under them.
  const barInset = useTopBarInset(canvasRef, `${nodes.length > 0}:${canOverlay}:${!!overlay}:${pinned}:${!!diagram.legend}`);
  useFitOnChange(`${nodes.map((n) => n.id).join('|')}#${fitKey}`, { glide: `${paletteOpen}:${flowsOpen}`, right: cover, inset: barInset ? { top: barInset } : undefined, added: lastAdded });
  const inspector = current && !settingsClosed && (
    <Inspector
      key={current.id}
      node={node}
      edge={node ? undefined : edge}
      labels={!node && edge ? connectionLabels(diagram, edge) : undefined}
      capacity={node ? diagram.capacity?.find((c) => c.node === node.id) : undefined}
      importedFrom={node ? imported.get(node.id) : edge?.loc.file}
      problemCapacity={problemCapacity}
      docked={dockSettings}
      onEdit={(edit) => onChange(edit(source))}
      onDelete={remove}
      onClose={() => setSettingsClosed(true)}
    />
  );

  const nodeActions: NodeActions = { editing, onName: finishName, onAddAfter: (id, at) => setAddAfter({ from: id, ...at }) };

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
        open={paletteOpen || (flowsOpen && !phone)}
        flows={flowsPanel || undefined}
        phone={phone}
        focus={paletteFocus}
        onAdd={(tech) => add(tech, { from: chainFrom })}
        connectFrom={chainFrom ? (diagram.nodes.find((n) => n.id === chainFrom)?.name ?? chainFrom) : undefined}
        onClose={() => (phone ? setSheet(false) : setDocked(false))}
        settings={dockSettings ? inspector : undefined}
        onFloatingChange={setFloating}
      />
      <div
        ref={canvasRef}
        tabIndex={-1}
        className="pc-editable relative h-full min-w-0 flex-1 outline-hidden"
        data-layout-busy={layoutBusy || undefined}
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
          add(tech, { drop: true });
        }}
        onKeyDown={(e) => {
          if ((e.key === 'Delete' || e.key === 'Backspace') && current && !(e.target as Element).closest('input, textarea, select, [contenteditable]')) {
            e.preventDefault();
            remove();
            return;
          }
          const key = canvasKey(e);
          if (key && runCanvasKey(key)) e.preventDefault();
        }}
      >
        <NodeActionsContext.Provider value={nodeActions}>
        <ReactFlow
          nodes={shownNodes}
          edges={shownEdges}
          nodeTypes={nodeTypes}
          edgeTypes={EDGE_TYPES}
          // Dragging a node pins it where it is dropped (`pos x,y`); Auto-layout unpins them all.
          nodesDraggable
          onNodesChange={onNodesChange}
          onNodeDragStart={pinDrag.onNodeDragStart}
          onNodeDragStop={pinDrag.onNodeDragStop}
          nodesConnectable
          elementsSelectable
          // Dragging an end of a connection onto another node moves that end, in the text.
          edgesUpdatable
          onReconnect={(ed, c) => c.source && c.target && edits.reconnect(ed.id, c.source, c.target)}
          onReconnectStart={connectDrop.onReconnectStart}
          onReconnectEnd={connectDrop.onReconnectEnd}
          onNodeClick={(_e, n) => (pick && flowsOpen ? pickNode(n.id) : select({ kind: 'node', id: n.id }))}
          onNodeDoubleClick={(_e, n) => !(pick && flowsOpen) && void rename(n.id)}
          // While a Flows step is picked, a click on a connection sends the step along it.
          onEdgeClick={(_e, ed) => (pick && flowsOpen ? setPick({ from: ed.source, to: ed.target }) : select({ kind: 'edge', id: ed.id }))}
          onPaneClick={() => (pick ? undefined : setSelected(null))}
          // A connection drops anywhere on a node's body; one it can't take is refused, saying why.
          isValidConnection={connectDrop.isValidConnection}
          onConnectStart={connectDrop.onConnectStart}
          onConnect={connectDrop.onConnect}
          onConnectEnd={connectDrop.onConnectEnd}
          onNodeContextMenu={(e, n) => {
            e.preventDefault();
            select({ kind: 'node', id: n.id });
            setMenu({ x: e.clientX, y: e.clientY, label: n.data?.name ?? n.id, id: n.id });
          }}
          onEdgeContextMenu={(e, ed) => {
            e.preventDefault();
            select({ kind: 'edge', id: ed.id });
            setMenu({ x: e.clientX, y: e.clientY, label: `${ed.source} → ${ed.target}`, id: ed.id });
          }}
          deleteKeyCode={null}
          zoomOnDoubleClick={false}
          fitView
          fitViewOptions={FIT_VIEW_OPTIONS}
          minZoom={0.1}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <ConnectAtAnyZoom />
          {overlay && <FlowParticles flows={overlay.flows} nodes={overlay.nodes} />}
          <Controls showInteractive={false}>{!phone && <MiniMapButton shown={miniMap} onToggle={() => setMiniMap(!miniMap)} />}</Controls>
          {!phone && miniMap && <CanvasMiniMap />}
          <CanvasTopBar
            left={
              <>
            {/* While the settings stand in for the palette, the button brings the palette back. */}
            <PaletteToggle
              open={paletteOpen && !dockSettings}
              onToggle={() => {
                if (dockSettings) return setSettingsClosed(true);
                if (flowsOpen) setFlowsShown(false);
                setPick(null);
                setPaletteFocus(!paletteOpen);
                if (phone) setSheet(!sheet);
                else setDocked(!docked);
              }}
            />
            {flows && <FlowsToggle open={flowsOpen && !dockSettings} onToggle={() => (dockSettings ? setSettingsClosed(true) : toggleFlows())} />}
            {/* In the top bar's row, so in a narrow pane it wraps below the buttons instead of covering them. */}
            {!hintSeen && nodes.length >= 2 && edges.length === 0 && <ConnectHint onDismiss={dismissHint} />}
              </>
            }
            right={
              nodes.length > 0 &&
              (canOverlay || pinned || diagram.legend) && (
                <OverlayTools overlay={overlay} canOverlay={canOverlay} onToggleOverlay={toggleOverlay} pinned={pinned} onResetLayout={edits.resetLayout} phone={phone} narrow legend={diagram.legend} />
              )
            }
          />
          {notice && (
            <Panel position="bottom-center">
              <p role="status" className="rounded-sm border-bw-1 border-ink bg-ink px-3 py-1.5 text-xs font-semibold text-paper shadow-brutal-sm">
                {notice}
              </p>
            </Panel>
          )}
        </ReactFlow>
        </NodeActionsContext.Provider>
        {inspector && !dockSettings && (
          <div className="pointer-events-none absolute inset-x-2 bottom-2 z-10 flex max-h-[55%] md:inset-x-auto md:bottom-auto md:right-2 md:top-14 md:max-h-[calc(100%-4.5rem)] md:w-72">
            {inspector}
          </div>
        )}
        {phone && flowsPanel && (
          <div data-testid="flows-sheet" className="absolute inset-x-0 bottom-0 z-20 flex max-h-[55%] flex-col overflow-hidden rounded-t-brutal border-t-bw-2 border-ink bg-surface shadow-brutal-lg">
            {flowsPanel}
          </div>
        )}
        {nodes.length === 0 && <EmptyCanvas />}
        {addAfter && (
          <AddAfterPicker
            at={addAfter}
            fromName={diagram.nodes.find((n) => n.id === addAfter.from)?.name ?? addAfter.from}
            onAdd={(tech) => {
              setAddAfter(null);
              add(tech, { from: addAfter.from });
            }}
            onClose={closeAddAfter}
          />
        )}
        {menu && <CanvasMenu menu={menu} onSettings={() => setSettingsClosed(false)} onDelete={remove} onClose={closeMenu} actions={menuActions()} />}
        {finder && (
          <NodeFinder
            items={finderItemsOf(diagram, nodes, finder.connectFrom)}
            label={finder.connectFrom ? `Connect ${diagram.nodes.find((n) => n.id === finder.connectFrom)?.name ?? finder.connectFrom} to` : 'Find a component'}
            placeholder={finder.connectFrom ? 'Connect to…' : 'Find a component…'}
            onPick={pickFound}
            onClose={closeFinder}
          />
        )}
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
