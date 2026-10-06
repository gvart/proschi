import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { toolButton } from './ui';

interface MenuProps {
  trigger: ReactNode;
  label: string;
  /** A tooltip for the button, e.g. when it shows only an icon. */
  title?: string;
  align?: 'left' | 'right';
  /** The trigger's look; a borderless toolbar button by default. */
  buttonClassName?: string;
  children: (close: () => void) => ReactNode;
}

/**
 * Minimal dropdown: closes on outside click, Escape, or when an item calls
 * `close`. On phones (below 640px) the panel spans the screen under its
 * button, 16px from each edge, instead of hanging off it, so it never sticks
 * out past an edge; long lines wrap. Wider, a panel that would still cross
 * an edge (a button near the other side) is moved back inside.
 */
export default function Menu({ trigger, label, title, align = 'left', buttonClassName = toolButton, children }: MenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Before paint: shift the panel sideways by what it crosses an edge of the viewport (8px kept free).
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    // Measured without the pop-in animation, whose first frame scales the panel down.
    panel.style.animation = 'none';
    const r = panel.getBoundingClientRect();
    panel.style.animation = '';
    const width = document.documentElement.clientWidth;
    let dx = r.right > width - 8 ? width - 8 - r.right : 0;
    if (r.left + dx < 8) dx = 8 - r.left;
    panel.style.translate = dx ? `${Math.round(dx)}px 0` : '';
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as globalThis.Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={label}
        title={title}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`${buttonClassName} aria-expanded:border-ink aria-expanded:bg-surface aria-expanded:shadow-brutal-sm`}
      >
        {trigger}
      </button>
      {open && (
        <div
          ref={panelRef}
          role="menu"
          className={`absolute z-50 mt-2 min-w-[16rem] max-w-[calc(100vw-2rem)] max-sm:fixed max-sm:inset-x-4 max-sm:top-auto max-sm:min-w-0 max-sm:max-w-none break-words rounded-brutal border-bw-2 border-ink bg-surface text-ink py-1.5 shadow-brutal-md ${align === 'right' ? 'right-0 origin-top-right' : 'left-0 origin-top-left'} motion-safe:animate-[ps-pop_var(--d-spring)_var(--e-spring)]`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  onSelect,
  children,
  icon,
  disabled,
}: {
  onSelect: () => void;
  children: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      disabled={disabled}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm font-medium text-ink hover:bg-pop-yellow hover:text-on-accent focus-visible:bg-pop-yellow focus-visible:text-on-accent focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-ink"
    >
      {icon}
      {children}
    </button>
  );
}
