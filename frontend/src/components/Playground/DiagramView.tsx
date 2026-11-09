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
import { finderItemsOf, useNarrow, usePinDrag, useTopBarInset } from '../Diagram/canvasShared';
import FlowsPanel, { type StepPick } from '../Diagram/FlowsPanel';
import { CanvasMenu, ConnectHint, FlowsToggle, PaletteDock, PaletteToggle, type CanvasMenuActions, type CanvasMenuState } from '../Diagram/CanvasEditing';
import { canvasKey, historyKey, useConnectHint, useMiniMap, usePaletteOpen, type CanvasKey } from '../Diagram/canvasEditState';
import Inspector from '../Diagram/Inspector';
import NodeFinder from '../Diagram/NodeFinder';
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
  onRenameNode: (id: string, name: string) => void;
  /** Adds a component from the palette, at a canvas position when it was dropped; returns its id, if it was added. */
  onAddNode: (techStack: string, position?: { x: number; y: number }) => string | undefined;
  /** Applies an inspector edit to the text. */
  onEdit: (edit: (source: string) => string) => void;
  /** Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z on the canvas: the code editor's undo and redo, where every canvas edit is one step. */
  onUndo: () => void;
  onRedo: () => void;
  /** Phones add components from a bottom sheet instead of the docked palette. */
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
  flows?: { source: string; diagram: Diagram; onChange: (next: string) => void; useCase: string | undefined; onUseCase: (id: string) => void };
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
}: DiagramViewProps) {
  const playing = playback.active;
  const { getNode, getNodes, getViewport, screenToFlowPosition, fitView, setViewport } = useReactFlow();
  const flowStore = useStoreApi();
  const [selection, setSelection] = useState<{ nodes: Node[]; edges: Edge[] }>({ nodes: [], edges: [] });
  // Rename and Delete stay clear of the toasts.
  const clearToasts = useToastClearance();
  // The palette: docked beside the canvas on wider screens (remembered), a sheet on phones.
  const [docked, setDocked] = usePaletteOpen('proschi.canvas.palette');
  const [sheet, setSheet] = useState(false);
  const [paletteFocus, setPaletteFocus] = useState(false);
  const canAdd = !playing && crumbs.length === 1;
  // The Flows builder takes the palette's place beside the canvas (a sheet on phones), as on the practice canvas.
  const [flowsShown, setFlowsShown] = usePaletteOpen('proschi.canvas.flows');
  const flowsOpen = canAdd && !!flows && flowsShown;
  /** The step being added in the Flows builder: node clicks pick its ends instead of selecting. */
  const [pick, setPick] = useState<StepPick | null>(null);
  const picking = flowsOpen && pick !== null;
  const paletteOpen = canAdd && (phone ? sheet : docked) && !flowsOpen;
  const togglePalette = () => {
    if (flowsOpen) setFlowsShown(false);
    setPick(null);
    setPaletteFocus(!paletteOpen);
    if (phone) setSheet(!sheet);
    else setDocked(!docked);
  };
  const closePalette = () => (phone ? setSheet(false) : setDocked(false));
  const [menu, setMenu] = useState<CanvasMenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const [hintSeen, dismissHint] = useConnectHint();
  const [miniMap, setMiniMap] = useMiniMap();
  /** The node finder: to jump to a node, or to pick the one to connect `from` to. */
  const [finder, setFinder] = useState<{ connectFrom?: string } | null>(null);
  /** Components just added, selected once the layout draws them. */
  const [pendingSelect, setPendingSelect] = useState<string[] | null>(null);
  /** The node or connection whose settings were closed, so they stay closed until something else is selected. */
  const [closedSettings, setClosedSettings] = useState<string | null>(null);
  const single = selection.nodes.length + selection.edges.length === 1 ? (selection.nodes[0] ?? selection.edges[0]) : undefined;
  const selectedNode = selection.nodes.length === 1 ? diagram.nodes.find((n) => n.id === selection.nodes[0].id) : undefined;
  const selectedEdge = selection.edges.length === 1 ? diagram.edges.find((e) => e.id === selection.edges[0].id) : undefined;
  const showSettings = !playing && single !== undefined && single.id !== closedSettings && (selectedNode !== undefined || selectedEdge !== undefined);
  const selectionCount = selection.nodes.length + selection.edges.length;
  const hasSelection = !playing && selectionCount > 0;
  const singleNode = selection.nodes.length === 1 && selection.edges.length === 0 ? selection.nodes[0] : undefined;
  const pinDrag = usePinDrag({
    imported: importedNodes,
    onMove: onMoveNodes,
    restore: (back) => onNodesChange((current) => current.map((n) => (back.has(n.id) ? { ...n, position: back.get(n.id)! } : n))),
    onNotice,
  });

  /**
   * A dropped component is selected, so its settings open; one clicked in the palette is not, so
   * the palette stays for the next one. A phone's sheet closes on a tap, and selects it too.
   */
  const addComponent = (tech: string, position?: { x: number; y: number }) => {
    const id = onAddNode(tech, position);
    if (id && (position || phone)) setPendingSelect([id]);
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
    setPendingSelect(null);
  }, [nodes, pendingSelect, selectOnly]);

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
  const linkedKey = (picking ? [pick.from, pick.to].filter((id): id is string => !!id) : linked).join('\n');
  const linkedIds = useMemo(() => new Set(linkedKey ? linkedKey.split('\n') : []), [linkedKey]);
  const linkedClass = (className: string | undefined) => (className ? `${className} pc-linked` : 'pc-linked');
  const drawnNodes = useMemo(
    () => (linkedIds.size === 0 ? nodes : nodes.map((n) => (linkedIds.has(n.id) ? { ...n, className: linkedClass(n.className) } : n))),
    [nodes, linkedIds],
  );
  const drawnEdges = useMemo(
    () => (linkedIds.size === 0 ? edges : edges.map((e) => (linkedIds.has(e.id) ? { ...e, className: linkedClass(e.className) } : e))),
    [edges, linkedIds],
  );
  // A linked node out of sight, or under a card over the canvas (settings, a floating palette, the legend),
  // is brought into the uncovered part: a short pan at the same zoom.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const rect = wrapper?.getBoundingClientRect();
    const node = [...linkedIds].map((id) => getNode(id)).find((n) => n?.width && n.height);
    if (!wrapper || !node || !rect || rect.width === 0) return;
    const covers = [...(wrapper.parentElement ?? wrapper).querySelectorAll<HTMLElement>('[data-canvas-cover], [data-testid="palette-dock"][data-floating], .pc-legend')]
      .map((el) => ((el.hasAttribute('data-canvas-cover') ? el.firstElementChild : el) ?? el).getBoundingClientRect())
      .filter((c) => c.width > 0 && c.height > 0);
    // The free area: the pane less the cards along a whole side (settings on the right, or at the bottom on a phone).
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

  const promptRename = async (node: Node) => {
    // Ask the parent straight away, which explains why a node from an imported file cannot be renamed.
    if (importedNodes.has(node.id)) return onRenameNode(node.id, '');
    const name = await prompt({ title: 'Rename', label: 'Display name', defaultValue: node.data?.name ?? node.id, confirmLabel: 'Rename' });
    if (name !== null) onRenameNode(node.id, name);
  };

  const deleteSelection = () => {
    if (playing || (selection.nodes.length === 0 && selection.edges.length === 0)) return;
    onDelete(
      selection.nodes.map((n) => n.id),
      selection.edges.map((e) => e.id).filter((id) => !id.startsWith('step:')),
    );
  };

  const duplicate = (ids: string[]) => {
    const added = onDuplicateNodes(ids);
    if (added?.length) setPendingSelect(added);
  };
  /** Ctrl/Cmd+C, V and D, and `/` or Ctrl/Cmd+F; false when the key is left to the browser (Ctrl+C with nothing selected). */
  const runCanvasKey = (key: CanvasKey): boolean => {
    const ids = selection.nodes.map((n) => n.id);
    if (key === 'copy') {
      if (ids.length === 0) return false;
      onCopyNodes(ids);
    } else if (key === 'paste') {
      const added = onPasteNodes();
      if (added?.length) setPendingSelect(added);
    } else if (key === 'duplicate') {
      if (ids.length > 0) duplicate(ids);
    } else setFinder({});
    return true;
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
      onSimulateDown:
        onSimulateDown && node.kind === 'component' && crumbs.length === 1
          ? () => {
              setClosedSettings(node.id);
              onSimulateDown(node.id);
            }
          : undefined,
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
  // The exception: playback, the splitter and the palette resize a pane that stays shown, and there the diagram glides to its new fit.
  // Below the top bar's buttons, tools and folded legend too, so no node of the fit sits under them.
  const barInset = useTopBarInset(wrapperRef, `${nodes.length > 0}:${playing}:${crumbs.length}:${canOverlay}:${!!overlay}:${hasPinnedNodes}:${!!diagram.legend}`);
  const narrow = useNarrow(wrapperRef);
  const fitInset = useMemo(() => (barInset > (inset?.top ?? 0) ? { top: barInset, bottom: inset?.bottom } : inset), [barInset, inset]);
  useFitOnChange(`${nodes.map((n) => n.id).join('|')}#${fitKey}`, { wrapper: wrapperRef, inset: fitInset, glide: `${playing ? 'playing' : ''}:${glideKey}:${paletteOpen}:${flowsOpen}` });

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => onEdgesChange((current) => applyEdgeChanges(changes, current)),
    [onEdgesChange],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => onNodesChange((current) => applyNodeChanges(changes, current)),
    [onNodesChange],
  );

  // With the palette docked, the settings take its place beside the canvas instead of covering the diagram.
  const dockSettings = showSettings && (paletteOpen || flowsOpen) && !phone;
  const toggleFlows = () => {
    setPick(null);
    if (!flowsOpen) {
      selectOnly();
      if (phone) setSheet(false);
      else setDocked(false);
    }
    setFlowsShown(!flowsOpen);
  };
  const pickNode = (id: string) => {
    if (!pick) return;
    if (!pick.from || (pick.to && pick.from !== id)) setPick({ from: id });
    else if (id !== pick.from) setPick({ ...pick, to: id });
  };
  const flowsPanel = flowsOpen && flows && (
    <FlowsPanel source={flows.source} diagram={flows.diagram} onChange={flows.onChange} pick={pick} onPick={setPick} useCase={flows.useCase} onUseCase={flows.onUseCase} onClose={toggleFlows} />
  );
  const inspector = showSettings && (
    <Inspector
      key={single.id}
      node={selectedNode}
      edge={selectedNode ? undefined : selectedEdge}
      capacity={selectedNode ? diagram.capacity?.find((c) => c.node === selectedNode.id) : undefined}
      importedFrom={selectedNode ? importedNodes.get(selectedNode.id) : selectedEdge?.loc.file}
      system={selectedNode ? (nodes.find((n) => n.id === selectedNode.id)?.data as SystemNodeData | undefined)?.system : undefined}
      docked={dockSettings}
      onEdit={onEdit}
      onDelete={deleteSelection}
      onClose={() => setClosedSettings(single.id)}
      // A long press does not open the right-click menu on every touch screen, so phones get Simulate down here.
      onSimulateDown={phone && onSimulateDown && selectedNode?.kind === 'component' && crumbs.length === 1 ? () => onSimulateDown(selectedNode.id) : undefined}
      down={!!selectedNode && !!downIds?.includes(selectedNode.id)}
    />
  );

  return (
    <div
      className="flex h-full"
      onKeyDown={(e) => {
        const step = playing ? null : historyKey(e);
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
      onAdd={(tech) => addComponent(tech)}
      onClose={closePalette}
      settings={dockSettings ? inspector : undefined}
    />
    <div
      ref={wrapperRef}
      // Focusable, so the keys above work after a drop from the palette.
      tabIndex={-1}
      className={`relative h-full min-w-0 flex-1 outline-hidden ${playing ? '' : 'pc-editable'}`}
      data-layout-busy={layoutBusy || undefined}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(TECH_DRAG_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(e) => {
        const tech = e.dataTransfer.getData(TECH_DRAG_TYPE);
        if (!tech || playing) return;
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
        if (key && runCanvasKey(key)) e.preventDefault();
      }}
    >
      <ReactFlow
        nodes={drawnNodes}
        edges={drawnEdges}
        nodeTypes={nodeTypes}
        edgeTypes={PLAYBACK_EDGE_TYPES}
        // Playing a use case shows it over this canvas, read-only.
        nodesDraggable={!playing}
        nodesConnectable={!playing}
        elementsSelectable={!playing && !picking}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onNodeDragStart={pinDrag.onNodeDragStart}
        onNodeDragStop={pinDrag.onNodeDragStop}
        // While a Flows step is picked, a click picks its end instead of selecting.
        onNodeClick={(_event, node) => picking && pickNode(node.id)}
        onConnect={(connection) => {
          if (!connection.source || !connection.target) return;
          dismissHint();
          onConnectNodes(connection.source, connection.target);
        }}
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
        edgesUpdatable={!playing}
        onReconnect={(edge, connection) => {
          if (playing || edge.id.startsWith('step:') || !connection.source || !connection.target) return;
          onReconnect(edge.id, connection.source, connection.target);
        }}
        // A system box opens its team design; renaming it stays in its settings and the selection bar.
        onNodeDoubleClick={(_event, node) => {
          if (playing) return;
          if (node.type === 'systemNode' || node.data?.system) onOpenSystem(node.id);
          else promptRename(node);
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
                  {/* While the settings stand in for the palette, the button brings the palette back. */}
                  <PaletteToggle open={paletteOpen && !dockSettings} onToggle={() => (dockSettings ? setClosedSettings(single.id) : togglePalette())} />
                  {flows && <FlowsToggle open={flowsOpen && !dockSettings} onToggle={() => (dockSettings ? setClosedSettings(single.id) : toggleFlows())} />}
                </>
              )
            ))
          }
          right={
            nodes.length > 0 &&
            (!playing || diagram.legend) && (
              <OverlayTools
                overlay={overlay}
                canOverlay={canOverlay}
                onToggleOverlay={onToggleOverlay}
                whatIfControl={whatIfControl}
                pinned={hasPinnedNodes}
                onResetLayout={onResetLayout}
                hideTools={playing}
                phone={phone}
                narrow={narrow}
                legend={diagram.legend}
              />
            )
          }
        />
        {canAdd && !hintSeen && nodes.length >= 2 && edges.length === 0 && (
          <Panel position="top-center" className="max-md:!top-12">
            <ConnectHint onDismiss={dismissHint} />
          </Panel>
        )}
        {/* With the settings card open, Delete is in its header; this bar covers several items or a closed card. */}
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
        {nodes.length > 0 && !playing && !miniMap && !(hasSelection && !showSettings) && (
          <Panel position="bottom-right" className="hidden md:block text-xs text-muted bg-paper/85 rounded-sm px-2 py-1">
            {narrow ? '? for shortcuts' : 'Drag to pin · select to edit · drag dot to dot to connect · right-click for more · ? for shortcuts'}
          </Panel>
        )}
      </ReactFlow>
      {showSettings && !dockSettings && (
        <div data-canvas-cover className="pointer-events-none absolute inset-x-2 bottom-2 z-10 flex max-h-[55%] max-md:[[data-keyboard]_&]:max-h-[calc(100%-1rem)] md:inset-x-auto md:bottom-auto md:right-2 md:top-14 md:max-h-[calc(100%-4.5rem)] md:w-72">
          {inspector}
        </div>
      )}
      {phone && flowsPanel && (
        <div data-testid="flows-sheet" className="absolute inset-x-0 bottom-0 z-20 flex max-h-[55%] flex-col overflow-hidden rounded-t-brutal border-t-bw-2 border-ink bg-surface shadow-brutal-lg">
          {flowsPanel}
        </div>
      )}
      {menu && <CanvasMenu menu={menu} onSettings={() => setClosedSettings(null)} onDelete={deleteSelection} onClose={closeMenu} actions={menuActions()} />}
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
    </div>
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
