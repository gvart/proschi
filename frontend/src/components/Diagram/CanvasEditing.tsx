import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Blocks, Cable, Settings2, Trash2, X } from 'lucide-react';
import { MenuItem } from '../Playground/Menu';
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

interface PaletteDockProps {
  open: boolean;
  phone: boolean;
  onAdd: (tech: string) => void;
  onClose: () => void;
  /** The palette was just opened by the reader, so its search takes the focus. */
  focus: boolean;
  /** The selection's settings (a docked Inspector): shown in the panel in place of the palette until closed. */
  settings?: ReactNode;
  /** Told whether the panel floats over the canvas (a narrow pane) instead of sitting beside it. */
  onFloatingChange?: (floating: boolean) => void;
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
export function PaletteDock({ open, phone, onAdd, onClose, focus, settings, onFloatingChange }: PaletteDockProps) {
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
    <div ref={ref} className={narrow ? 'relative order-last w-0 shrink-0' : 'w-60 shrink-0 border-r-bw-1 border-ink'}>
      <div
        data-testid="palette-dock"
        data-floating={narrow || undefined}
        className={
          narrow
            ? `absolute right-2 top-2 z-20 flex max-h-[calc(100%-1rem)] w-64 flex-col overflow-hidden rounded-sm border-bw-1 border-ink bg-surface shadow-brutal-md ${settings ? '' : 'h-[calc(100%-1rem)]'}`
            : 'h-full'
        }
      >
        {settings}
        <div className="h-full" hidden={!!settings}>
          <Palette onAdd={onAdd} onClose={onClose} autoFocus={focus} />
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
}

/** The right-click menu of a node or connection: open its settings, or delete it. */
export function CanvasMenu({ menu, onSettings, onDelete, onClose }: { menu: CanvasMenuState; onSettings: () => void; onDelete: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
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
  // Kept on screen near the right and bottom edges.
  const left = Math.min(menu.x, window.innerWidth - 200);
  const top = Math.min(menu.y, window.innerHeight - 100);
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`${menu.label} actions`}
      style={{ left, top }}
      className="fixed z-50 min-w-[11rem] rounded-sm border-bw-1 border-ink bg-surface py-1 text-ink shadow-brutal-md"
    >
      <MenuItem
        icon={<Settings2 size={14} />}
        onSelect={() => {
          onClose();
          onSettings();
        }}
      >
        Settings
      </MenuItem>
      <MenuItem
        icon={<Trash2 size={14} />}
        onSelect={() => {
          onClose();
          onDelete();
        }}
      >
        Delete <span className="ml-auto text-xs text-muted">Del</span>
      </MenuItem>
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

/** An empty canvas: where to start, with the mouse or in code. */
export function EmptyCanvas({ children }: { children?: ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
      <div className="max-w-xs rounded-sm border-bw-1 border-dashed border-ink/40 px-5 py-4 text-center text-sm text-muted">
        <p className="font-semibold text-ink">Drag a component here or describe it in code</p>
        <p className="mt-1">Components are under Add component, top left.</p>
        <p className="mt-1">
          For example <code className="rounded-sm bg-ink/5 px-1 font-mono">api -&gt; db</code>
        </p>
        {children}
      </div>
    </div>
  );
}

