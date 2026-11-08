import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { Copy, MessagesSquare } from 'lucide-react';

/**
 * Select any text on a stage (the brief, the lesson, your notes, a failing
 * test) and ask Design partner about it (docs/design/paid-plans.md P50): a
 * right-click on a selection opens a small menu with "Ask Design partner"
 * (and Copy, which the native menu it replaces had), and a selection shows a
 * small floating button under it, for touch. The code editor and the canvas
 * keep their own menus.
 */

interface Picked {
  text: string;
  /** Where the floating button goes (viewport px): under the selection's middle, or inside a text field's lower right corner. */
  x: number;
  y: number;
  /** From a text field (your notes): its native menu stays, only the button shows. */
  field: boolean;
}

const SKIP = '.cm-editor, .react-flow, [data-no-ask]';

function pick(root: HTMLElement | null): Picked | undefined {
  if (!root) return undefined;
  const active = document.activeElement;
  if ((active instanceof HTMLTextAreaElement || (active instanceof HTMLInputElement && active.type === 'text')) && root.contains(active) && !active.closest(SKIP)) {
    const { selectionStart: a, selectionEnd: b } = active;
    if (a === null || b === null || a === b) return undefined;
    const text = active.value.slice(a, b);
    if (!text.trim()) return undefined;
    const r = active.getBoundingClientRect();
    return { text, x: r.right - 8, y: r.bottom - 8, field: true };
  }
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return undefined;
  const range = sel.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const el = node instanceof Element ? node : node.parentElement;
  if (!el || !root.contains(el) || el.closest(SKIP)) return undefined;
  const text = sel.toString();
  if (!text.trim()) return undefined;
  const r = range.getBoundingClientRect();
  return { text, x: r.left + r.width / 2, y: r.bottom + 8, field: false };
}

export default function AskSelection({ enabled, onAsk, className, children }: { enabled: boolean; onAsk: (text: string) => void; className?: string; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [chip, setChip] = useState<Picked>();
  const [menu, setMenu] = useState<{ x: number; y: number; text: string }>();
  const menuRef = useRef<HTMLDivElement>(null);

  // The floating button follows the selection (settled for a beat, so dragging does not flicker it).
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setChip(pick(root.current)), 120);
    };
    document.addEventListener('selectionchange', update);
    // Text fields' selections do not always raise selectionchange on the document.
    const el = root.current;
    el?.addEventListener('mouseup', update);
    el?.addEventListener('keyup', update);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('selectionchange', update);
      el?.removeEventListener('mouseup', update);
      el?.removeEventListener('keyup', update);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [enabled]);

  const close = useCallback(() => setMenu(undefined), []);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu, close]);

  // Kept inside the viewport (8px free), and focused for the keyboard.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!menu || !el) return;
    const r = el.getBoundingClientRect();
    const dx = Math.min(0, window.innerWidth - 8 - r.right);
    const dy = Math.min(0, window.innerHeight - 8 - r.bottom);
    el.style.translate = dx || dy ? `${Math.round(dx)}px ${Math.round(dy)}px` : '';
    el.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [menu]);

  const onContextMenu = (e: ReactMouseEvent) => {
    if (!enabled) return;
    const picked = pick(root.current);
    if (!picked || picked.field) return;
    e.preventDefault();
    // From the keyboard (the context menu key) there is no pointer: open it under the selection.
    const keyboard = e.clientX === 0 && e.clientY === 0;
    setMenu({ x: keyboard ? picked.x : e.clientX, y: keyboard ? picked.y : e.clientY, text: picked.text });
  };

  const ask = (text: string) => {
    close();
    setChip(undefined);
    onAsk(text);
  };

  const onMenuKey = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
  };

  const item = 'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm font-medium text-ink hover:bg-pop-yellow hover:text-on-accent focus-visible:bg-pop-yellow focus-visible:text-on-accent focus-visible:outline-hidden';

  return (
    <div ref={root} className={className} onContextMenu={onContextMenu}>
      {children}
      {enabled && chip && !menu && (
        <button
          type="button"
          // Pressing it must not drop the selection first.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => ask(chip.text)}
          data-testid="ask-selection"
          className="fixed z-40 inline-flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-sm border-bw-1 border-ink bg-pop-lilac px-2.5 py-1.5 text-xs font-bold text-on-accent shadow-brutal-sm hover:shadow-brutal-md motion-safe:animate-[ps-pop_var(--d-spring)_var(--e-spring)] data-[field]:-translate-x-full data-[field]:-translate-y-full"
          data-field={chip.field || undefined}
          style={{ left: Math.max(8, Math.min(chip.x, window.innerWidth - 8)), top: Math.min(chip.y, window.innerHeight - 44) }}
        >
          <MessagesSquare size={14} aria-hidden="true" />
          Ask Design partner
        </button>
      )}
      {menu && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Selection"
          onKeyDown={onMenuKey}
          className="fixed z-50 min-w-[13rem] rounded-brutal border-bw-2 border-ink bg-surface py-1.5 text-ink shadow-brutal-md motion-safe:animate-[ps-pop_var(--d-spring)_var(--e-spring)]"
          style={{ left: menu.x, top: menu.y }}
        >
          <button type="button" role="menuitem" onClick={() => ask(menu.text)} className={item}>
            <MessagesSquare size={14} aria-hidden="true" />
            Ask Design partner
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void navigator.clipboard?.writeText(menu.text).catch(() => undefined);
              close();
            }}
            className={item}
          >
            <Copy size={14} aria-hidden="true" />
            Copy
          </button>
        </div>
      )}
    </div>
  );
}
