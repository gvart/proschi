import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Blocks, Cable, Code2, Copy, Pencil, PinOff, Power, PowerOff, Settings2, Trash2, Workflow, X } from 'lucide-react';
import { MenuItem } from '../Playground/Menu';
import { MOD_KEY } from '../Playground/modKey';
import { iconButton, toolButton } from '../Playground/ui';
import Palette from './Palette';

/**
 * The pieces of visual editing both editable canvases share (the editor's and
 * practice's): the component palette and its toggle, the right-click menu,
 * the connect hint and the empty canvas. Every edit they lead to goes through
 * dsl/edit.ts on the text, which stays the source of truth.
 */

/** The toolbar button that shows or hides the palette. */
export function PaletteToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label="Add component"
      aria-expanded={open}
      title={open ? 'Hide the components' : 'Show the components to drag onto the canvas'}
      className={`${toolButton} border-ink bg-surface shadow-brutal-sm aria-expanded:bg-pop-yellow aria-expanded:text-on-accent`}
    >
      <Blocks size={16} />
      <span className="whitespace-nowrap">
        Add<span className="hidden sm:inline"> component</span>
      </span>
    </button>
  );
}

/** The toolbar button that shows or hides the Flows builder (use cases and scenarios). */
export function FlowsToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label="Flows"
      aria-expanded={open}
      title={open ? 'Hide the flows' : 'Add use cases and their steps, without code'}
      className={`${toolButton} border-ink bg-surface shadow-brutal-sm aria-expanded:bg-pop-yellow aria-expanded:text-on-accent`}
    >
      <Workflow size={16} />
      <span className="whitespace-nowrap">Flows</span>
    </button>
  );
}

interface PaletteDockProps {
  open: boolean;
  phone: boolean;
  onAdd: (tech: string) => void;
  onClose: () => void;
  /** The palette was just opened by the reader, so its search takes the focus. */
  focus: boolean;
  /** The selection's settings (a docked Inspector): shown in the panel in place of the palette until closed. */
  settings?: ReactNode;
  /** The Flows builder: shown in the panel in place of the palette (the settings still come first). */
  flows?: ReactNode;
  /** Told whether the panel floats over the canvas (a narrow pane) instead of sitting beside it. */
  onFloatingChange?: (floating: boolean) => void;
  /** The name of the selected component a new one is connected from, if any. */
  connectFrom?: string;
}

/** Below this width, a panel docked beside the canvas would leave too little of it, so the panel floats over the canvas instead. */
const FLOAT_BELOW = 640;

/** Whether the row the dock sits in (dock and canvas) is narrow, measured on the row itself rather than the window. */
function useNarrowRow(open: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const row = ref.current?.parentElement;
    if (!open || !row || typeof ResizeObserver === 'undefined') return;
    const update = () => setNarrow(row.clientWidth < FLOAT_BELOW);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(row);
    return () => observer.disconnect();
  }, [open]);
  return [ref, narrow] as const;
}

/**
 * The palette docked to the left of the canvas; in a narrow pane (practice's
 * diagram column) a panel floating over the canvas's right side, so the canvas
 * keeps its width; on a phone a bottom sheet where a tap adds.
 */
export function PaletteDock({ open, phone, onAdd, onClose, focus, settings, flows, onFloatingChange, connectFrom }: PaletteDockProps) {
  const [ref, narrow] = useNarrowRow(open && !phone);
  useEffect(() => onFloatingChange?.(narrow), [narrow, onFloatingChange]);
  if (!open) return null;
  if (phone) {
    return (
      <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/40" onMouseDown={onClose}>
        <div
          role="dialog"
          aria-label="Add a component"
          className="flex h-[70dvh] flex-col overflow-hidden rounded-t-brutal border-t-bw-2 border-ink bg-surface shadow-brutal-lg"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Palette
            variant="sheet"
            autoFocus={false}
            connectFrom={connectFrom}
            onAdd={(tech) => {
              onAdd(tech);
              onClose();
            }}
            onClose={onClose}
          />
        </div>
      </div>
    );
  }
  return (
    // One panel, the selection's settings, else the palette (hidden, not unmounted, so it keeps its search and
    // does not take the focus again). Beside the canvas, so neither covers the diagram; in a narrow pane over its
    // right side, from a zero-width box placed after the canvas.
    <div ref={ref} className={narrow ? 'relative order-last w-0 shrink-0' : `${flows ? 'w-72' : 'w-60'} shrink-0 border-r-bw-1 border-ink`}>
      <div
        data-testid="palette-dock"
        data-floating={narrow || undefined}
        className={
          narrow
            ? `absolute right-2 top-2 z-20 flex max-h-[calc(100%-1rem)] ${flows ? 'w-72' : 'w-64'} flex-col overflow-hidden rounded-sm border-bw-1 border-ink bg-surface shadow-brutal-md ${settings ? '' : 'h-[calc(100%-1rem)]'}`
            : 'h-full'
        }
      >
        {settings}
        {flows && (
          <div className="h-full min-h-0" hidden={!!settings}>
            {flows}
          </div>
        )}
        <div className="h-full" hidden={!!settings || !!flows}>
          <Palette onAdd={onAdd} onClose={onClose} autoFocus={focus} connectFrom={connectFrom} />
        </div>
      </div>
    </div>
  );
}

export interface CanvasMenuState {
  x: number;
  y: number;
  /** What was right-clicked, for the menu's label. */
  label: string;
  /** The id of the node or connection right-clicked. */
  id?: string;
}

/** The right-click menu's actions beyond Settings and Delete; each one is offered when given. */
export interface CanvasMenuActions {
  onRename?: () => void;
  onDuplicate?: () => void;
  onConnect?: () => void;
  onUnpin?: () => void;
  onJumpToCode?: () => void;
  /** Takes the node down in the live what-if, or brings it back up (`down`). */
  onSimulateDown?: () => void;
  down?: boolean;
}

/** The right-click menu of a node or connection: its settings, the actions given, and Delete (each when given; a view-only canvas has neither). */
export function CanvasMenu({
  menu,
  onSettings,
  onDelete,
  onClose,
  actions = {},
}: {
  menu: CanvasMenuState;
  onSettings?: () => void;
  onDelete?: () => void;
  onClose: () => void;
  actions?: CanvasMenuActions;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ left: menu.x, top: menu.y });
  useEffect(() => {
    const onPointer = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  // Kept on screen near the right and bottom edges, measured before paint.
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setPlace({ left: Math.max(8, Math.min(menu.x, window.innerWidth - box.width - 8)), top: Math.max(8, Math.min(menu.y, window.innerHeight - box.height - 8)) });
  }, [menu.x, menu.y]);
  const item = (icon: ReactNode, label: ReactNode, run: (() => void) | undefined) =>
    run && (
      <MenuItem
        icon={icon}
        onSelect={() => {
          onClose();
          run();
        }}
      >
        {label}
      </MenuItem>
    );
  const hint = (keys: string) => <span className="ml-auto pl-4 text-xs text-muted">{keys}</span>;
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`${menu.label} actions`}
      style={place}
      className="fixed z-50 min-w-[12rem] rounded-sm border-bw-1 border-ink bg-surface py-1 text-ink shadow-brutal-md"
    >
      {item(<Settings2 size={14} />, 'Settings', onSettings)}
      {item(<Pencil size={14} />, 'Rename…', actions.onRename)}
      {item(<Copy size={14} />, <>Duplicate {hint(`${MOD_KEY}+D`)}</>, actions.onDuplicate)}
      {item(<Cable size={14} />, 'Connect to…', actions.onConnect)}
      {item(<PinOff size={14} />, 'Unpin position', actions.onUnpin)}
      {item(<Code2 size={14} />, 'Jump to code', actions.onJumpToCode)}
      {item(actions.down ? <Power size={14} /> : <PowerOff size={14} />, actions.down ? 'Bring back up' : 'Simulate down', actions.onSimulateDown)}
      {onDelete && <div className="my-1 border-t border-ink/10" />}
      {item(<Trash2 size={14} />, <>Delete {hint('Del')}</>, onDelete)}
    </div>
  );
}

/** Shown once there are two components and none was connected yet: how to connect them. */
export function ConnectHint({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div role="note" className="pointer-events-auto flex max-w-[20rem] items-start gap-2 rounded-sm border-bw-1 border-ink bg-surface py-2 pl-3 pr-1 text-sm text-ink shadow-brutal-sm">
      <Cable size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">Connect two components:</span> drag from the dot under one to the other.
      </p>
      <button type="button" aria-label="Dismiss the hint" onClick={onDismiss} className={`${iconButton} !h-7 !w-7`}>
        <X size={14} />
      </button>
    </div>
  );
}

/** Where the type picker opens (screen pixels), and the component the new one is connected from. */
export interface AddAfterState {
  from: string;
  x: number;
  y: number;
}

/**
 * The type picker that a node's "+" (or a connection dropped on empty canvas) opens in place: the
 * palette's search and catalog in a small card. Choosing a type adds it, connected from `fromName`.
 */
export function AddAfterPicker({ at, fromName, onAdd, onClose }: { at: AddAfterState; fromName: string; onAdd: (tech: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ left: at.x + 12, top: at.y - 24 });
  useEffect(() => {
    const onPointer = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [onClose]);
  // Beside the point, kept on screen; to its left when there is no room on the right.
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const right = at.x + 12 + box.width <= window.innerWidth - 8;
    const left = right ? at.x + 12 : Math.max(8, at.x - 12 - box.width);
    setPlace({ left, top: Math.max(8, Math.min(at.y - 24, window.innerHeight - box.height - 8)) });
  }, [at.x, at.y]);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Add after ${fromName}`}
      style={place}
      className="fixed z-50 flex h-80 w-64 flex-col overflow-hidden rounded-sm border-bw-1 border-ink bg-surface shadow-brutal-md"
    >
      <p className="border-b border-ink/15 px-3 pb-1.5 pt-2 text-xs font-semibold text-ink">Add after {fromName}</p>
      <div className="min-h-0 flex-1">
        <Palette variant="picker" autoFocus onAdd={onAdd} onClose={onClose} connectFrom={fromName} />
      </div>
    </div>
  );
}

/** An empty canvas: where to start, with the mouse or in code. */
export function EmptyCanvas({ children, viewOnly = false }: { children?: ReactNode; viewOnly?: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
      <div className="max-w-xs rounded-sm border-bw-1 border-dashed border-ink/40 px-5 py-4 text-center text-sm text-muted">
        <p className="font-semibold text-ink">{viewOnly ? 'Describe your design in code' : 'Drag a component here or describe it in code'}</p>
        <p className="mt-1">{viewOnly ? 'The diagram draws itself as you type; switch to Visual to build it on the canvas.' : 'Components are under Add component, top left.'}</p>
        <p className="mt-1">
          For example <code className="rounded-sm bg-ink/5 px-1 font-mono">api -&gt; db</code>
        </p>
        {children}
      </div>
    </div>
  );
}

