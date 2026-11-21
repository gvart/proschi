import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactFlow, { Background, BackgroundVariant, Controls, Panel, applyEdgeChanges, applyNodeChanges, getNodesBounds, getViewportForBounds, useReactFlow, useStoreApi } from 'reactflow';
import type { Edge, EdgeChange, Node, NodeChange } from 'reactflow';
import { ArrowLeft, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { notify, prompt } from '../../design/dialogs';
import { useToastClearance } from '../../design/toastClearance';
import type { Diagram } from '../../dsl/types';
import type { SimOverlay } from '../../sim/overlay';
import type { CoverBand } from '../../onboarding/Tour';
import ComponentNode from '../Canvas/ComponentNode';
import GroupNode from '../Canvas/GroupNode';
import SystemNode from '../Canvas/SystemNode';
import TextNode from '../Canvas/TextNode';
import type { SystemNodeData } from '../Canvas/systemActions';
import { TECH_DRAG_TYPE } from '../Diagram/Palette';
import { CanvasMiniMap, CanvasTopBar, MiniMapButton, OverlayTools } from '../Diagram/CanvasTools';
import { finderItemsOf, useKeepInView, useLateOpen, useNarrow, usePinDrag, useTopBarInset } from '../Diagram/canvasShared';
import FlowsPanel, { type StepPick } from '../Diagram/FlowsPanel';
import { FlowsView } from '../Diagram/FlowsView';
import { AddAfterPicker, CanvasMenu, ConnectHint, PaletteDock, PaletteToggle, SelectionEmpty, ViewSwitch, type AddAfterState, type CanvasMenuActions, type CanvasMenuState, type RailTab } from '../Diagram/CanvasEditing';
import { NodeActionsContext, type NodeActions } from '../Canvas/nodeActions';
import { canvasKey, scalable, stepNode, stepReplicas, useConnectHint, useMiniMap, usePaletteOpen, type CanvasKey } from '../Diagram/canvasEditState';
import Inspector from '../Diagram/Inspector';
import { ConnectAtAnyZoom, connectionLabels, useConnectDrop } from '../Diagram/connect';
import NodeFinder from '../Diagram/NodeFinder';
import QuickAdd from '../Diagram/QuickAdd';
import { canvasActions, promptUseCase } from '../Diagram/quickItems';
import { FIT_MAX_ZOOM, FIT_VIEW_OPTIONS, useFitOnChange, type FitInset } from '../Diagram/useFitOnChange';
import FlowParticles from '../Overlay/FlowParticles';
import { PlaybackMiniMap } from '../UseCases/UseCasePlayback';
import { PLAYBACK_EDGE_TYPES, type PlaybackView } from '../UseCases/playbackView';
import { exportImage, fileNameFor, type PngScale } from './exportDiagram';
import { iconButton } from './ui';
import type { Crumb } from './useSystemView';

const nodeTypes = {
  componentNode: ComponentNode,
  groupNode: GroupNode,
  systemNode: SystemNode,
  textNode: TextNode,
};


export interface ImageRequest {
  format: 'png' | 'svg';
  /** A PNG's pixel ratio; 2× when absent. */
  scale?: PngScale;
}

export interface DiagramViewProps {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: (update: (nodes: Node[]) => Node[]) => void;
  onEdgesChange: (update: (edges: Edge[]) => Edge[]) => void;
  title?: string;
  hasPinnedNodes: boolean;
  onMoveNodes: (moved: { id: string; position: { x: number; y: number } }[]) => void;
  onConnectNodes: (from: string, to: string) => void;
  /** Names a node; returns its id after (the id follows the name while it is the generated one), if it was named. */
  onRenameNode: (id: string, name: string) => string | undefined;
  /**
   * Adds a component from the palette, at a canvas position when it was dropped, connected from `from` when
   * given; returns its id, if it was added.
   */
  onAddNode: (techStack: string, position?: { x: number; y: number }, from?: string) => string | undefined;
  /** Applies an inspector edit to the text. */
  onEdit: (edit: (source: string) => string) => void;
  /** Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z on the canvas: the code editor's undo and redo, where every canvas edit is one step. */
  onUndo: () => void;
  onRedo: () => void;
  /** On a phone the rail (palette, Flows, settings) is a sheet under the canvas. */
  phone: boolean;
  /** The parsed diagram, for the inspector. */
  diagram: Diagram;
  /** The simulation drawn on the canvas, when "Overlay: load" is on. */
  overlay?: SimOverlay;
  /** The document has traffic to simulate, so the overlay can be turned on. */
  canOverlay: boolean;
  onToggleOverlay: () => void;
  /** The live what-if's pill (components/WhatIf), beside the overlay toggle while the overlay is on. */
  whatIfControl?: ReactNode;
  /** Right-click → Simulate down: takes a node down in the live what-if, or brings it back up. */
  onSimulateDown?: (id: string) => void;
  /** The nodes simulated down. */
  downIds?: readonly string[];
  /** A node picked elsewhere (Results), to select and zoom to; a new `n` asks again. */
  focusRequest?: { id: string; n: number } | null;
  onResetLayout: () => void;
  onDelete: (nodeIds: string[], edgeIds: string[]) => void;
  /** Ctrl/Cmd+C: keeps the nodes and the connections between them for pasting. */
  onCopyNodes: (ids: string[]) => void;
  /** Ctrl/Cmd+V and Ctrl/Cmd+D: the new nodes' ids, to select them. */
  onPasteNodes: () => string[] | undefined;
  onDuplicateNodes: (ids: string[]) => string[] | undefined;
  /** An end of a connection was dragged to another node. */
  onReconnect: (edgeId: string, from: string, to: string) => void;
  /** Removes a node's `pos x,y` (right-click → Unpin position). */
  onUnpinNode: (id: string) => void;
  /** Shows a node's or a connection's text in the code pane. */
  onJumpToCode: (id: string) => void;
  /** The canvas selection changed (outside playback): the ids of its nodes and connections, to show their text. */
  onSelectionLink: (ids: string[]) => void;
  /** What the code pane's cursor sits on: marked on the canvas, apart from the selection. */
  linked: string[];
  /** Changes when the view becomes visible again, so it can re-fit. */
  fitKey: string;
  /** A layout is on its way (ELK, then the glide): `data-layout-busy` on the canvas, which the e2e tests wait out. */
  layoutBusy: boolean;
  /** Changes when the pane was resized in place (the splitter), so it can glide to a new fit. */
  glideKey: string;
  /** An image to export (the Export menu in the header), made once the nodes are drawn. */
  imageRequest: ImageRequest | null;
  onImageDone: () => void;
  /** Nodes declared in imported files (id → file); they cannot be moved here. */
  importedNodes: Map<string, string>;
  /** A short message shown over the canvas, e.g. why an edit was refused. */
  notice: string | null;
  onNotice: (message: string) => void;
  /** A band of the screen covered by a floating card; fitting keeps the diagram clear of it. */
  cover?: CoverBand | null;
  /** The use case playing over the diagram, if any; the canvas is read-only meanwhile. */
  playback: PlaybackView;
  /** Where the canvas is among the document's systems, top first; one crumb at the top. */
  crumbs: Crumb[];
  /** The team file shown when navigated into a system; the canvas cannot edit it. */
  focusFile?: string;
  /** The team file cannot be edited in the code pane (it came with a link, or from a remote source). */
  focusReadOnly?: boolean;
  /** What the rest of the document sends into the design navigated into. */
  focusInbound?: string;
  onCrumb: (path: string) => void;
  /** Navigates into a system box (double-click). */
  onOpenSystem: (id: string) => void;
  /** Offers the Flows builder (use cases and scenarios without code, FlowsPanel.tsx) on this document's text. */
  flows?: { source: string; diagram: Diagram; onChange: (next: string) => void; useCase: string | undefined; onUseCase: (id: string) => void; scenario?: string; onScenario?: (id: string | undefined) => void };
  /** What an empty canvas shows (the editor's starter card), centred on the canvas. */
  empty?: ReactNode;
  /**
   * Code mode: the diagram is there to look at, the text is edited in the code. Panning, zooming, selecting
   * (to find its line), playback and the what-ifs stay; nothing on the canvas changes the text.
   */
  viewOnly?: boolean;
}

/** Renders the parsed diagram. Canvas edits are written back to the text, which stays the source of truth. */
export default function DiagramView({
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
  onUndo,
  onRedo,
  phone,
  diagram,
  overlay,
  canOverlay,
  onToggleOverlay,
  whatIfControl,
  onSimulateDown,
  downIds,
  focusRequest,
  onResetLayout,
  onDelete,
  onCopyNodes,
  onPasteNodes,
  onDuplicateNodes,
  onReconnect,
  onUnpinNode,
  onJumpToCode,
  onSelectionLink,
  linked,
  fitKey,
  layoutBusy,
  glideKey,
  imageRequest,
  onImageDone,
  importedNodes,
  notice,
  onNotice,
  cover,
  playback,
  crumbs,
  focusFile,
  focusReadOnly,
  focusInbound,
  onCrumb,
  onOpenSystem,
  flows,
  empty,
  viewOnly = false,
}: DiagramViewProps) {
  const playing = playback.active;
  const { getNode, getNodes, getViewport, screenToFlowPosition, fitView, setViewport } = useReactFlow();
  const flowStore = useStoreApi();
  const [selection, setSelection] = useState<{ nodes: Node[]; edges: Edge[] }>({ nodes: [], edges: [] });
  // Rename and Delete stay clear of the toasts.
  const clearToasts = useToastClearance();
  // The palette: in the rail beside the canvas on wider screens (remembered), in the sheet under it on phones.
  const [docked, setDocked] = usePaletteOpen('proschi.canvas.palette');
  const [sheet, setSheet] = useState(false);
  const [paletteFocus, setPaletteFocus] = useState(false);
  const canAdd = !playing && !viewOnly && crumbs.length === 1;
  // The Flows builder is a view of its own over the canvas (FlowsView.tsx), behind the `Architecture | Flows` switch,
  // on phones too. As on the practice canvas.
  const [flowsShown, setFlowsShown] = usePaletteOpen('proschi.canvas.flows');
  const flowsOpen = canAdd && !!flows && flowsShown;
  /** The ends of a step being added in the Flows view (the command bar's "Add a step" gives it the first). */
  const [pick, setPick] = useState<StepPick | null>(null);
  const paletteOpen = canAdd && (phone ? sheet : docked);
  const togglePalette = () => {
    setPick(null);
    setPaletteFocus(!paletteOpen);
    // Opened, the palette is what shows: the selection's settings, which would take its place, are put away.
    if (!paletteOpen) closeSelection();
    if (phone) setSheet(!sheet);
    else setDocked(!docked);
  };
  const closePalette = () => (phone ? setSheet(false) : setDocked(false));
  const [menu, setMenu] = useState<CanvasMenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const [hintSeen, dismissHint] = useConnectHint();
  /** The type picker of a node's "+", or of a connection let go on empty canvas. */
  const [addAfter, setAddAfter] = useState<AddAfterState | null>(null);
  const closeAddAfter = useCallback(() => setAddAfter(null), []);
  const connectDrop = useConnectDrop(
    diagram,
    (from, to) => {
      dismissHint();
      onConnectNodes(from, to);
    },
    onNotice,
    (from, at) => canAdd && setAddAfter({ from, ...at }),
  );
  /** The component whose name is typed on the canvas (ComponentNode's field). */
  const [editing, setEditing] = useState<string | null>(null);
  /** The last id a name changed, so a click that comes before the layout catches up still means that node. */
  const renamed = useRef<{ from: string; to: string } | null>(null);
  /** The component added last on this canvas: the fit keeps it readable (useFitOnChange `added`). */
  const [lastAdded, setLastAdded] = useState<string>();
  const [miniMap, setMiniMap] = useMiniMap();
  /** The node finder: to jump to a node, or to pick the one to connect `from` to. */
  const [finder, setFinder] = useState<{ connectFrom?: string } | null>(null);
  /** Components just added, selected once the layout draws them. */
  const [pendingSelect, setPendingSelect] = useState<string[] | null>(null);
  /** The node or connection whose settings were closed, so they stay closed until something else is selected. */
  const [closedSettings, setClosedSettings] = useState<string | null>(null);
  /** The type picker T asked for: the component's, opened in its settings until a type is picked or it closes. */
  const [typeRequest, setTypeRequest] = useState<{ id: string; n: number } | null>(null);
  /** The command bar (A, or Ctrl/Cmd+K). */
  const [quick, setQuick] = useState(false);
  const single = selection.nodes.length + selection.edges.length === 1 ? (selection.nodes[0] ?? selection.edges[0]) : undefined;
  const selectedNode = selection.nodes.length === 1 ? diagram.nodes.find((n) => n.id === selection.nodes[0].id) : undefined;
  const selectedEdge = selection.edges.length === 1 ? diagram.edges.find((e) => e.id === selection.edges[0].id) : undefined;
  const showSettings = !playing && !viewOnly && single !== undefined && single.id !== closedSettings && (selectedNode !== undefined || selectedEdge !== undefined);
  /**
   * The rail stays on the Selection tab once a selection opened it, with nothing selected too, so selecting and
   * clicking away does not open and close the rail (and move the canvas) every time.
   */
  const [selectionTab, setSelectionTab] = useState(false);
  const selectionShown = !viewOnly && !playing && (showSettings || (selectionTab && canAdd));
  const railTab: RailTab = selectionShown ? 'selection' : 'components';
  // Opened by a selection alone, the rail waits for the click to finish (useLateOpen) before it narrows the canvas.
  const selectionOpens = useLateOpen(selectionShown && !paletteOpen);
  const railOpen = paletteOpen || selectionOpens;
  const selectionCount = selection.nodes.length + selection.edges.length;
  const hasSelection = !playing && !viewOnly && selectionCount > 0;
  const singleNode = selection.nodes.length === 1 && selection.edges.length === 0 ? selection.nodes[0] : undefined;
  const pinDrag = usePinDrag({
    imported: importedNodes,
    onMove: onMoveNodes,
    restore: (back) => onNodesChange((current) => current.map((n) => (back.has(n.id) ? { ...n, position: back.get(n.id)! } : n))),
    onNotice,
  });

  /** The component a new one is connected from: the one just added, else the selected component or system. */
  const chainFrom = (() => {
    const kind = singleNode && diagram.nodes.find((n) => n.id === singleNode.id)?.kind;
    const id = pendingSelect?.length === 1 ? pendingSelect[0] : kind === 'component' || kind === 'system' ? singleNode?.id : undefined;
    return id && renamed.current?.from === id ? renamed.current.to : id;
  })();
  /**
   * Adds a component, connected from `from` when given, selected and with its name ready to type. A dropped one
   * opens its settings; one clicked keeps the palette for the next, connected from it.
   */
  const addComponent = (tech: string, position?: { x: number; y: number }, from?: string) => {
    const id = onAddNode(tech, position, from);
    if (!id) return;
    if (from) dismissHint();
    setPendingSelect([id]);
    if (!position) setClosedSettings(id);
    setEditing(id);
    setLastAdded(id);
  };
  /** Selects only `ids` (nodes or a connection), as a click (or a box) would. */
  const selectOnly = useCallback(
    (...ids: string[]) => {
      const chosen = new Set(ids);
      onNodesChange((current) => current.map((n) => (!!n.selected === chosen.has(n.id) ? n : { ...n, selected: chosen.has(n.id) })));
      onEdgesChange((current) => current.map((e) => (!!e.selected === chosen.has(e.id) ? e : { ...e, selected: chosen.has(e.id) })));
    },
    [onNodesChange, onEdgesChange],
  );
  useEffect(() => {
    if (!pendingSelect || !pendingSelect.every((id) => nodes.some((n) => n.id === id))) return;
    selectOnly(...pendingSelect);
    // A renamed node whose settings were put away keeps them away, from the render it is selected in (not before,
    // or its old id, still selected, would show them for a frame and hide the palette).
    const r = renamed.current;
    if (r && pendingSelect.includes(r.to)) setClosedSettings((c) => (c === r.from ? r.to : c));
    setPendingSelect(null);
  }, [nodes, pendingSelect, selectOnly]);

  useEffect(() => {
    if (showSettings && !paletteOpen) setSelectionTab(true);
  }, [showSettings, paletteOpen]);

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

  const wrapperRef = useRef<HTMLDivElement>(null);
  // The selection, shown in the code pane. Playback selects nothing, so it is left out.
  const selectionKey = [...selection.nodes, ...selection.edges].map((item) => item.id).join('\n');
  useEffect(() => {
    if (!playing) onSelectionLink(selectionKey ? selectionKey.split('\n') : []);
    // Once per selection; the handler is a new function on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, playing]);

  // What the code's cursor sits on wears a ring of its own (pc-linked in canvas.css), the selection untouched.
  const linkedKey = linked.join('\n');
  const linkedIds = useMemo(() => new Set(linkedKey ? linkedKey.split('\n') : []), [linkedKey]);
  const linkedClass = (className: string | undefined) => (className ? `${className} pc-linked` : 'pc-linked');
  const drawnNodes = useMemo(() => (linkedIds.size === 0 ? nodes : nodes.map((n) => (linkedIds.has(n.id) ? { ...n, className: linkedClass(n.className) } : n))), [nodes, linkedIds]);
  const drawnEdges = useMemo(() => (linkedIds.size === 0 ? edges : edges.map((e) => (linkedIds.has(e.id) ? { ...e, className: linkedClass(e.className) } : e))), [edges, linkedIds]);
  // A linked node out of sight, or under a card over the canvas (a floating rail, the legend),
  // is brought into the uncovered part: a short pan at the same zoom.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const rect = wrapper?.getBoundingClientRect();
    const node = [...linkedIds].map((id) => getNode(id)).find((n) => n?.width && n.height);
    if (!wrapper || !node || !rect || rect.width === 0) return;
    const covers = [...(wrapper.parentElement ?? wrapper).querySelectorAll<HTMLElement>('[data-testid="palette-dock"][data-floating], .pc-legend')]
      .map((el) => el.getBoundingClientRect())
      .filter((c) => c.width > 0 && c.height > 0);
    // The free area: the pane less the cards along a whole side (a floating rail on the right).
    const free = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    for (const c of covers) {
      if (c.height > rect.height / 2 && c.left > rect.left + rect.width / 2) free.right = Math.min(free.right, c.left);
      else if (c.width > rect.width / 2 && c.top > rect.top + rect.height / 2) free.bottom = Math.min(free.bottom, c.top);
    }
    const { x, y, zoom } = getViewport();
    const at = node.positionAbsolute ?? node.position;
    const center = { x: at.x + node.width! / 2, y: at.y + node.height! / 2 };
    const screen = { x: rect.left + center.x * zoom + x, y: rect.top + center.y * zoom + y };
    const inFree = screen.x >= free.left && screen.x <= free.right && screen.y >= free.top && screen.y <= free.bottom;
    const covered = covers.some((c) => screen.x >= c.left && screen.x <= c.right && screen.y >= c.top && screen.y <= c.bottom);
    if (inFree && !covered) return;
    const target = { x: (free.left + free.right) / 2 - rect.left, y: (free.top + free.bottom) / 2 - rect.top };
    // A tween of our own: React Flow's animated setViewport zooms out and back in mid-pan (d3's interpolateZoom).
    const to = { x: target.x - center.x * zoom, y: target.y - center.y * zoom };
    const start = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - start) / 300);
      const eased = 1 - (1 - t) ** 3;
      setViewport({ x: x + (to.x - x) * eased, y: y + (to.y - y) * eased, zoom });
      if (t < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [linkedIds, getNode, getViewport, setViewport]);

  /** Names a component in place on the canvas; other nodes (a group, a note, a system) in a dialog. */
  const promptRename = async (node: Node) => {
    // Ask the parent straight away, which explains why a node from an imported file cannot be renamed.
    if (importedNodes.has(node.id)) return void onRenameNode(node.id, '');
    if (node.type === 'componentNode' && !node.data?.system) return setEditing(node.id);
    const name = await prompt({ title: 'Rename', label: 'Display name', defaultValue: node.data?.name ?? node.id, confirmLabel: 'Rename' });
    if (name !== null) onRenameNode(node.id, name);
  };
  /** The name typed on the canvas: written, and the selection follows the id when it changes. */
  const finishName = (id: string, name: string | null) => {
    setEditing(null);
    // Enter or Escape: back to the canvas's keys (a click elsewhere keeps its own focus).
    if (document.activeElement?.classList.contains('pc-node__name-field')) wrapperRef.current?.focus({ preventScroll: true });
    else
      requestAnimationFrame(() => {
        if (document.activeElement === document.body) wrapperRef.current?.focus({ preventScroll: true });
      });
    if (name === null) return;
    const next = onRenameNode(id, name);
    if (!next || next === id) return;
    renamed.current = { from: id, to: next };
    if (lastAdded === id) setLastAdded(next);
    if (selection.nodes.some((n) => n.id === id)) setPendingSelect([next]);
  };
  // The same object while nothing in it changes, so the nodes (memo) don't all render again on every pan and glide.
  const finishNameRef = useRef(finishName);
  useLayoutEffect(() => {
    finishNameRef.current = finishName;
  });
  const readOnly = playing || viewOnly || crumbs.length > 1;
  const nodeActions = useMemo<NodeActions | null>(
    // While a Flows step is picked, a click on a node picks it: no "+" to land on instead.
    () => (readOnly ? null : { editing, onName: (id, name) => finishNameRef.current(id, name), onAddAfter: canAdd ? (id, at) => setAddAfter({ from: id, ...at }) : undefined }),
    [readOnly, editing, canAdd],
  );

  const deleteSelection = () => {
    if (playing || viewOnly || (selection.nodes.length === 0 && selection.edges.length === 0)) return;
    onDelete(
      selection.nodes.map((n) => n.id),
      selection.edges.map((e) => e.id).filter((id) => !id.startsWith('step:')),
    );
  };

  const duplicate = (ids: string[]) => {
    const added = onDuplicateNodes(ids);
    if (added?.length) setPendingSelect(added);
  };
  /** Opens the "+" type picker beside a node, to add one connected from it (C). */
  const addAfterNode = (id: string): boolean => {
    const box = wrapperRef.current?.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`)?.getBoundingClientRect();
    if (!box) return false;
    setAddAfter({ from: id, x: box.right, y: box.top + box.height / 2 });
    return true;
  };
  /** The canvas's keys (canvasEditState.ts); false when the key is left to the browser (Ctrl+C or Tab with nothing selected). */
  const runCanvasKey = (key: CanvasKey): boolean => {
    const ids = selection.nodes.map((n) => n.id);
    const node = singleNode && diagram.nodes.find((n) => n.id === singleNode.id);
    const own = node && !importedNodes.has(node.id);
    switch (key) {
      case 'copy':
        if (ids.length === 0) return false;
        onCopyNodes(ids);
        return true;
      case 'paste': {
        const added = onPasteNodes();
        if (added?.length) setPendingSelect(added);
        return true;
      }
      case 'duplicate':
        if (ids.length > 0) duplicate(ids);
        return true;
      case 'rename':
        if (!singleNode) return false;
        void promptRename(singleNode);
        return true;
      case 'find':
        setFinder({});
        return true;
      case 'quick':
        if (!canAdd) return false;
        setQuick(true);
        return true;
      case 'next':
      case 'previous': {
        if (ids.length === 0) return false;
        const drawn = getNodes().filter((n) => !n.hidden && n.type !== 'groupNode');
        const next = stepNode(drawn.map((n) => ({ id: n.id, ...(n.positionAbsolute ?? n.position) })), singleNode?.id, key === 'previous');
        if (!next) return false;
        selectOnly(next);
        setClosedSettings(null);
        return true;
      }
      case 'connect':
        return canAdd && !!node && (node.kind === 'component' || node.kind === 'system') && addAfterNode(node.id);
      case 'type':
        if (!node || node.kind !== 'component' || !own) return false;
        setClosedSettings(null);
        setSelectionTab(true);
        setTypeRequest({ id: node.id, n: (typeRequest?.n ?? 0) + 1 });
        return true;
      case 'more':
      case 'fewer':
        if (!node || !scalable(node) || !own) return false;
        onEdit((src) => stepReplicas(src, node.id, key === 'more' ? 1 : -1));
        return true;
      case 'layout':
        // Laying out again only unpins: without a pinned node the layout is already the automatic one.
        if (!hasPinnedNodes) return false;
        onResetLayout();
        return true;
    }
  };
  const closeQuick = () => {
    setQuick(false);
    wrapperRef.current?.focus({ preventScroll: true });
  };
  /** The command bar's actions, those the canvas can do now. */
  const quickActions = () => {
    const local = flows?.diagram.useCases.some((u) => u.loc.file === undefined);
    const from = chainFrom;
    return canvasActions({
      newUseCase: flows
        ? async () => {
            const added = await promptUseCase(flows.source);
            if (!added) return;
            flows.onChange(added.source);
            flows.onUseCase(added.id);
            if (!flowsOpen) toggleFlows();
          }
        : undefined,
      addStep: flows && local ? () => {
        if (!flowsOpen) toggleFlows();
        setPick({ from });
      } : undefined,
      rename: singleNode && (() => void promptRename(singleNode)),
      remove: selectionCount > 0 ? deleteSelection : undefined,
      fit: () => void fitView({ ...FIT_VIEW_OPTIONS, duration: 300 }),
    });
  };
  /** The nodes the finder offers: those drawn, without groups and notes when connecting. */
  const finderItems = () => finderItemsOf(diagram, nodes, finder?.connectFrom);
  const closeFinder = () => {
    setFinder(null);
    // Back on the canvas, so its keys work again.
    wrapperRef.current?.focus({ preventScroll: true });
  };
  const pickFound = (id: string) => {
    if (finder?.connectFrom) {
      dismissHint();
      onConnectNodes(finder.connectFrom, id);
      return;
    }
    selectOnly(id);
    setClosedSettings(null);
    void fitView({ nodes: [{ id }], duration: 300, maxZoom: 1.25, padding: 0.5 });
  };
  /** The right-click menu's actions for what it was opened on. */
  const menuActions = (): CanvasMenuActions => {
    const node = menu?.id ? diagram.nodes.find((n) => n.id === menu.id) : undefined;
    if (!menu?.id) return {};
    if (!node) return { onJumpToCode: () => onJumpToCode(menu.id!) };
    const simulateDown =
      onSimulateDown && node.kind === 'component' && crumbs.length === 1
        ? () => {
            setClosedSettings(node.id);
            onSimulateDown(node.id);
          }
        : undefined;
    // In Code mode the menu only looks: at the code, or at the design without this node.
    if (viewOnly) return { onJumpToCode: () => onJumpToCode(node.id), onSimulateDown: simulateDown, down: downIds?.includes(node.id) };
    const drawn = nodes.find((n) => n.id === node.id);
    const own = !importedNodes.has(node.id);
    const plain = node.kind === 'component' || node.kind === 'text';
    return {
      onRename: drawn && (() => promptRename(drawn)),
      onDuplicate: own && plain ? () => duplicate([node.id]) : undefined,
      onConnect: node.kind === 'component' || node.kind === 'system' ? () => setFinder({ connectFrom: node.id }) : undefined,
      onUnpin: own && node.position ? () => onUnpinNode(node.id) : undefined,
      onJumpToCode: () => onJumpToCode(node.id),
      // The settings would cover the what-if card, so they close.
      onSimulateDown: simulateDown,
      down: downIds?.includes(node.id),
    };
  };

  // The canvas may have just been opened for the export (from another tab, the
  // code pane on a phone, or playback): wait until it is shown and its nodes are measured.
  useEffect(() => {
    if (!imageRequest) return;
    let cancelled = false;
    let frame = 0;
    const tick = async () => {
      if (cancelled) return;
      const viewport = wrapperRef.current?.querySelector<HTMLElement>('.react-flow__viewport');
      const drawn = getNodes();
      const ready = !!viewport && viewport.getClientRects().length > 0 && drawn.length > 0 && drawn.every((n) => n.width && n.height);
      if (!ready && frame++ < 120) {
        requestAnimationFrame(() => void tick());
        return;
      }
      try {
        if (!ready || !viewport) throw new Error('the diagram is not on screen');
        const legend = wrapperRef.current?.querySelector<HTMLElement>('.pc-legend') ?? undefined;
        await exportImage(imageRequest.format, drawn, viewport, fileNameFor(title, imageRequest.format), legend, imageRequest.scale);
      } catch (error) {
        console.error('Export failed:', error);
        notify({ title: 'Sorry, the image could not be exported.', tone: 'danger' });
      } finally {
        if (!cancelled) onImageDone();
      }
    };
    requestAnimationFrame(() => void tick());
    return () => {
      cancelled = true;
    };
    // Once per request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageRequest]);
  // A node picked in Results: once the canvas is drawn and its own fit has settled
  // (the view has not moved for a while), select the node and zoom to it.
  useEffect(() => {
    if (!focusRequest) return;
    let frame = 0;
    let tries = 0;
    let still = 0;
    let last = '';
    const tick = () => {
      const { domNode, width, height, transform } = flowStore.getState();
      const drawn = getNodes();
      const node = drawn.find((n) => n.id === focusRequest.id);
      const sized = !!domNode?.offsetWidth && Math.abs(domNode.offsetWidth - width) <= 1 && Math.abs(domNode.offsetHeight - height) <= 1;
      const ready = !!node && sized && !!wrapperRef.current?.offsetWidth && drawn.every((n) => n.width && n.height);
      const view = transform.join(',');
      still = ready && view === last ? still + 1 : 0;
      last = view;
      if (!node || still < 15) {
        if (tries++ < 300) frame = requestAnimationFrame(tick);
        return;
      }
      selectOnly(node.id);
      zoomTo(node.id);
    };
    // A late fit of the whole diagram (a layout settling) may still come: for a moment, zoom back to the node,
    // unless the reader has taken the view in hand.
    let held = 0;
    let target = '';
    let touched = false;
    const touch = () => (touched = true);
    const wrapper = wrapperRef.current;
    wrapper?.addEventListener('pointerdown', touch);
    wrapper?.addEventListener('wheel', touch);
    const viewOf = (t: readonly number[]) => t.map((n) => n.toFixed(2)).join(',');
    const fit = (id: string) => {
      const { width, height, minZoom, nodeOrigin } = flowStore.getState();
      const node = getNodes().find((n) => n.id === id);
      if (!node) return;
      const viewport = getViewportForBounds(getNodesBounds([node], nodeOrigin), width, height, minZoom, FIT_MAX_ZOOM, 0.8);
      // React Flow applies it a moment later, so the view is held against what was asked, not what is there yet.
      target = viewOf([viewport.x, viewport.y, viewport.zoom]);
      setViewport(viewport);
    };
    const zoomTo = (id: string) => {
      fit(id);
      const hold = () => {
        if (touched || held++ > 90) return;
        if (held > 3 && viewOf(flowStore.getState().transform) !== target) fit(id);
        frame = requestAnimationFrame(hold);
      };
      frame = requestAnimationFrame(hold);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      wrapper?.removeEventListener('pointerdown', touch);
      wrapper?.removeEventListener('wheel', touch);
    };
    // Once per request, and again once React Flow is ready: its viewport helpers do nothing until then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.n, setViewport]);
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
  // then (phone Code/Preview tabs) is 0×0, which interpolates the viewport to NaN. Nodes already glide via settle.
  // The exception: playback, the splitter and the rail resize a pane that stays shown, and there the diagram glides to its new fit.
  // Below the top bar's buttons, tools and folded legend too, so no node of the fit sits under them.
  const barInset = useTopBarInset(wrapperRef, `${nodes.length > 0}:${playing}:${crumbs.length}:${canOverlay}:${!!overlay}:${hasPinnedNodes}:${!!diagram.legend}`);
  const narrow = useNarrow(wrapperRef);
  const fitInset = useMemo(() => (barInset > (inset?.top ?? 0) ? { top: barInset, bottom: inset?.bottom } : inset), [barInset, inset]);
  // A phone's sheet takes half of the canvas at once: the diagram is fitted to what is left before it is drawn, not glided there.
  const railKey = `${paletteOpen}:${flowsOpen}:${railOpen}`;
  useFitOnChange(`${nodes.map((n) => n.id).join('|')}#${fitKey}`, {
    wrapper: wrapperRef,
    inset: fitInset,
    glide: `${playing ? 'playing' : ''}:${glideKey}:${phone ? '' : railKey}`,
    still: phone ? railKey : undefined,
    added: lastAdded,
  });
  useKeepInView(playing ? undefined : singleNode?.id, railOpen);

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => onEdgesChange((current) => applyEdgeChanges(changes, current)),
    [onEdgesChange],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => onNodesChange((current) => applyNodeChanges(changes, current)),
    [onNodesChange],
  );

  /** Puts the selection's settings away, so the tab under them (or no rail) shows. */
  function closeSelection() {
    if (single) setClosedSettings(single.id);
    setSelectionTab(false);
  }
  const showTab = (tab: RailTab) => {
    if (tab === 'selection') {
      setClosedSettings(null);
      setSelectionTab(true);
      return;
    }
    closeSelection();
    if (!paletteOpen) {
      setPick(null);
      setPaletteFocus(true);
      if (phone) setSheet(true);
      else setDocked(true);
    }
  };
  const toggleFlows = () => {
    setPick(null);
    setFlowsShown(!flowsOpen);
  };
  /** A phone's "Show on the architecture": the canvas, with a step's components selected. */
  const showOnCanvas = (ids: string[]) => {
    toggleFlows();
    setPendingSelect(ids);
  };
  const flowsPanel = flowsOpen && flows && (
    <FlowsPanel
      source={flows.source}
      diagram={flows.diagram}
      onChange={flows.onChange}
      pick={pick}
      onPick={setPick}
      useCase={flows.useCase}
      onUseCase={flows.onUseCase}
      scenario={flows.scenario}
      onScenario={flows.onScenario}
      onClose={toggleFlows}
      onUndo={phone ? onUndo : undefined}
      onRedo={phone ? onRedo : undefined}
      onShow={phone ? showOnCanvas : undefined}
      layout={phone ? 'phone' : 'pane'}
      headerPicker
    />
  );
  // A component just added keeps its settings closed (the palette stays for the next add), but where the Selection
  // tab is already showing, it shows them rather than "Nothing selected".
  const inspector = (showSettings || (selectionShown && !playing && !viewOnly && (selectedNode !== undefined || selectedEdge !== undefined))) && single && (
    <Inspector
      key={single.id}
      diagram={diagram}
      node={selectedNode}
      edge={selectedNode ? undefined : selectedEdge}
      labels={!selectedNode && selectedEdge ? connectionLabels(diagram, selectedEdge) : undefined}
      capacity={selectedNode ? diagram.capacity?.find((c) => c.node === selectedNode.id) : undefined}
      importedFrom={selectedNode ? importedNodes.get(selectedNode.id) : selectedEdge?.loc.file}
      system={selectedNode ? (nodes.find((n) => n.id === selectedNode.id)?.data as SystemNodeData | undefined)?.system : undefined}
      docked
      typeRequest={typeRequest?.id === single.id ? typeRequest.n : undefined}
      onTypeDone={() => {
        setTypeRequest(null);
        wrapperRef.current?.focus({ preventScroll: true });
      }}
      onEdit={onEdit}
      onDelete={deleteSelection}
      onClose={closeSelection}
      // A long press does not open the right-click menu on every touch screen, so phones get Simulate down here.
      onSimulateDown={phone && onSimulateDown && selectedNode?.kind === 'component' && crumbs.length === 1 ? () => onSimulateDown(selectedNode.id) : undefined}
      down={!!selectedNode && !!downIds?.includes(selectedNode.id)}
    />
  );

  return (
    // Ctrl/Cmd+Z in Code mode too: the view-only diagram edits nothing, but undoes and redoes the code it shows.
    <FlowsView
      phone={phone}
      view={flowsPanel}
      onToggle={canAdd && flows ? toggleFlows : undefined}
      onUndo={() => !playing && onUndo()}
      onRedo={() => !playing && onRedo()}
    >
    <PaletteDock
      open={railOpen}
      tab={railTab}
      onTab={showTab}
      selection={selectionShown ? inspector || <SelectionEmpty onClose={() => setSelectionTab(false)} /> : undefined}
      phone={phone}
      focus={paletteFocus}
      onAdd={(tech) => addComponent(tech, undefined, chainFrom)}
      connectFrom={chainFrom ? (diagram.nodes.find((n) => n.id === chainFrom)?.name ?? chainFrom) : undefined}
      onClose={closePalette}
    />
    <div
      ref={wrapperRef}
      // Focusable, so the keys above work after a drop from the palette.
      tabIndex={-1}
      data-canvas-focus
      // While a Flows step is picked, a click on a node picks it: the dots, grips and resizer that edit it are put away.
      className={`relative h-full min-w-0 flex-1 outline-hidden ${playing || viewOnly ? '' : 'pc-editable'}`}
      data-layout-busy={layoutBusy || undefined}
      onDragOver={(e) => {
        if (viewOnly || !e.dataTransfer.types.includes(TECH_DRAG_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(e) => {
        const tech = e.dataTransfer.getData(TECH_DRAG_TYPE);
        if (!tech || playing || viewOnly) return;
        e.preventDefault();
        e.currentTarget.focus();
        addComponent(tech, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
      }}
      onKeyDown={(e) => {
        const target = e.target as HTMLElement;
        if ((e.key === 'Delete' || e.key === 'Backspace') && !target.closest('input, textarea, [contenteditable]')) {
          e.preventDefault();
          deleteSelection();
          // The deleted item had the focus; keep it on the canvas so Ctrl+Z still works.
          wrapperRef.current?.focus({ preventScroll: true });
          return;
        }
        const key = playing ? null : canvasKey(e);
        // Finding a node only looks; the other keys edit.
        if (key && (!viewOnly || key === 'find') && runCanvasKey(key)) e.preventDefault();
      }}
    >
      <NodeActionsContext.Provider value={nodeActions}>
      <ReactFlow
        nodes={drawnNodes}
        edges={drawnEdges}
        nodeTypes={nodeTypes}
        edgeTypes={PLAYBACK_EDGE_TYPES}
        // Playing a use case shows it over this canvas, read-only.
        nodesDraggable={!playing && !viewOnly}
        nodesConnectable={!playing && !viewOnly}
        elementsSelectable={!playing}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onNodeDragStart={pinDrag.onNodeDragStart}
        onNodeDragStop={pinDrag.onNodeDragStop}
        // A click on a node whose settings were put away (one just added from the palette, say) shows them again.
        onNodeClick={(_event, node) => closedSettings === node.id && editing !== node.id && setClosedSettings(null)}
        // A connection drops anywhere on a node's body; one it can't take is refused, saying why.
        isValidConnection={connectDrop.isValidConnection}
        onConnectStart={connectDrop.onConnectStart}
        onConnect={connectDrop.onConnect}
        onConnectEnd={connectDrop.onConnectEnd}
        onNodeContextMenu={(event, node) => {
          if (playing) return;
          event.preventDefault();
          selectOnly(node.id);
          setClosedSettings(null);
          setMenu({ x: event.clientX, y: event.clientY, label: node.data?.name ?? node.id, id: node.id });
        }}
        onEdgeContextMenu={(event, edge) => {
          if (playing || edge.id.startsWith('step:')) return;
          event.preventDefault();
          selectOnly(edge.id);
          setClosedSettings(null);
          setMenu({ x: event.clientX, y: event.clientY, label: `${edge.source} → ${edge.target}`, id: edge.id });
        }}
        // Dragging an end of a connection onto another node moves that end, in the text.
        edgesUpdatable={!playing && !viewOnly}
        onReconnect={(edge, connection) => {
          if (playing || edge.id.startsWith('step:') || !connection.source || !connection.target) return;
          onReconnect(edge.id, connection.source, connection.target);
        }}
        onReconnectStart={connectDrop.onReconnectStart}
        onReconnectEnd={connectDrop.onReconnectEnd}
        // A system box opens its team design; renaming it stays in its settings and the selection bar.
        onNodeDoubleClick={(_event, node) => {
          if (playing) return;
          if (node.type === 'systemNode' || node.data?.system) onOpenSystem(node.id);
          else if (!viewOnly) void promptRename(node);
        }}
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
        <ConnectAtAnyZoom />
        {overlay && !playing && <FlowParticles flows={overlay.flows} nodes={overlay.nodes} />}
        <Controls showInteractive={false}>
          {/* The minimap is for wide screens; on a phone it would cover the diagram. */}
          {!playing && !phone && <MiniMapButton shown={miniMap} onToggle={() => setMiniMap(!miniMap)} />}
        </Controls>
        {playing && <PlaybackMiniMap view={playback} />}
        {!playing && !phone && miniMap && <CanvasMiniMap />}
        <CanvasTopBar
          left={
            !playing &&
            (crumbs.length > 1 ? (
              <Breadcrumbs crumbs={crumbs} file={focusFile} readOnly={focusReadOnly} inbound={focusInbound} onPick={onCrumb} />
            ) : (
              canAdd && (
                <>
                  {flows && <ViewSwitch flows={flowsOpen} onChange={(next) => next !== flowsOpen && toggleFlows()} />}
                  {/* Each shows its tab of the rail, or hides the rail when its tab is the one shown. */}
                  <PaletteToggle open={paletteOpen && railTab === 'components'} onToggle={() => (paletteOpen && railTab === 'components' ? togglePalette() : showTab('components'))} />
                </>
              )
            ))
          }
          hint={canAdd && !hintSeen && nodes.length >= 2 && edges.length === 0 && <ConnectHint onDismiss={dismissHint} />}
          right={
            nodes.length > 0 &&
            (!playing || diagram.legend) && (
              <OverlayTools
                overlay={overlay}
                canOverlay={canOverlay}
                onToggleOverlay={onToggleOverlay}
                whatIfControl={whatIfControl}
                pinned={hasPinnedNodes && !viewOnly}
                onResetLayout={onResetLayout}
                hideTools={playing}
                phone={phone}
                narrow={narrow}
                legend={diagram.legend}
              />
            )
          }
        />
        {/* With the settings open, Delete is in their header; this bar covers several items or closed settings. */}
        {(notice || (hasSelection && !showSettings)) && (
          <Panel position="bottom-center" className="flex flex-col items-center gap-2">
            {notice && (
              <p role="status" className="rounded-sm border-bw-1 border-ink bg-ink px-3 py-1.5 text-xs font-semibold text-paper shadow-brutal-sm">
                {notice}
              </p>
            )}
            {hasSelection && !showSettings && (
              <div ref={clearToasts} role="toolbar" aria-label="Selection" className="flex items-center gap-1 rounded-full border-bw-1 border-ink bg-surface py-1 pl-4 pr-1 shadow-brutal-sm">
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
        {/* The minimap takes this corner. */}
        {nodes.length > 0 && !playing && !miniMap && !notice && !(hasSelection && !showSettings) && (
          <Panel position="bottom-right" className="hidden md:block text-xs text-muted bg-paper/85 rounded-sm px-2 py-1">
            {narrow
              ? '? for shortcuts'
              : viewOnly
                ? 'Select to find its line · edit in the code, or switch to Visual to edit here · ? for shortcuts'
                : 'Drag to pin · select to edit · drag from a dot onto a component to connect · right-click for more · ? for shortcuts'}
          </Panel>
        )}
      </ReactFlow>
      </NodeActionsContext.Provider>
      {empty}
      {addAfter && (
        <AddAfterPicker
          at={addAfter}
          fromName={diagram.nodes.find((n) => n.id === addAfter.from)?.name ?? addAfter.from}
          onAdd={(tech) => {
            setAddAfter(null);
            addComponent(tech, undefined, addAfter.from);
          }}
          onClose={closeAddAfter}
        />
      )}
      {menu && (
        <CanvasMenu menu={menu} onSettings={viewOnly ? undefined : () => setClosedSettings(null)} onDelete={viewOnly ? undefined : deleteSelection} onClose={closeMenu} actions={menuActions()} />
      )}
      {quick && (
        <QuickAdd
          types={diagram.types ?? []}
          actions={quickActions()}
          connectFrom={chainFrom ? (diagram.nodes.find((n) => n.id === chainFrom)?.name ?? chainFrom) : undefined}
          onAdd={(tech) => addComponent(tech, undefined, chainFrom)}
          onClose={closeQuick}
        />
      )}
      {finder && (
        <NodeFinder
          items={finderItems()}
          label={finder.connectFrom ? `Connect ${diagram.nodes.find((n) => n.id === finder.connectFrom)?.name ?? finder.connectFrom} to` : 'Find a component'}
          placeholder={finder.connectFrom ? 'Connect to…' : 'Find a component…'}
          onPick={pickFound}
          onClose={closeFinder}
        />
      )}
    </div>
    </FlowsView>
  );
}

/** Where the canvas is among the document's systems (Drone startup › Order Processing), with the way back. */
function Breadcrumbs({ crumbs, file, readOnly, inbound, onPick }: { crumbs: Crumb[]; file?: string; readOnly?: boolean; inbound?: string; onPick: (path: string) => void }) {
  const up = crumbs[crumbs.length - 2];
  return (
    <nav aria-label="Breadcrumb" className="flex max-w-[min(calc(100vw-7rem),36rem)] flex-col rounded-sm border-bw-1 border-ink bg-surface py-1 pl-1 pr-3 shadow-brutal-sm">
      <div className="flex min-w-0 items-center gap-1">
        <button type="button" onClick={() => onPick(up.path)} aria-label={`Back to ${up.name}`} title={`Back to ${up.name}`} className={`${iconButton} !h-7 !w-7`}>
          <ArrowLeft size={15} />
        </button>
        <ol className="flex min-w-0 items-center gap-1 text-sm">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <li key={c.path} className={`flex items-center gap-1 ${last ? 'min-w-0' : 'flex-none max-sm:[&:not(:first-child)]:hidden'}`}>
                {i > 0 && <ChevronRight size={14} className="flex-none text-muted" aria-hidden="true" />}
                {last ? (
                  <span aria-current="page" className="truncate font-bold text-ink">
                    {c.name}
                  </span>
                ) : (
                  <button type="button" onClick={() => onPick(c.path)} className="max-w-[10rem] truncate rounded-sm px-1 font-semibold text-ink/75 underline-offset-2 hover:text-ink hover:underline">
                    {c.name}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
        {file && (
          <span className="ml-2 hidden flex-none font-mono text-xs text-muted md:inline" title={readOnly ? 'This design is in its own file, which cannot be edited here' : 'This design is in its own file, open in the code pane'}>
            {file}
            {readOnly && ' · read-only'}
          </span>
        )}
      </div>
      {inbound && (
        <span className="min-w-0 truncate pb-0.5 pl-9 text-xs font-semibold text-ink/75" title="The load shown includes what the rest of the document sends into this design">
          {inbound}
        </span>
      )}
    </nav>
  );
}
