import { useEffect, useRef, useState, type ReactNode } from 'react';
import { toolButton } from './ui';

interface MenuProps {
  trigger: ReactNode;
  label: string;
  align?: 'left' | 'right';
  children: (close: () => void) => ReactNode;
}

/** Minimal dropdown: closes on outside click, Escape, or when an item calls `close`. */
export default function Menu({ trigger, label, align = 'left', children }: MenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`${toolButton} aria-expanded:border-ink aria-expanded:bg-surface aria-expanded:shadow-brutal-sm`}
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute z-50 mt-2 min-w-[16rem] max-w-[calc(100vw-2rem)] rounded-brutal border-bw-2 border-ink bg-surface text-ink py-1.5 shadow-brutal-md ${align === 'right' ? 'right-0 origin-top-right' : 'left-0 origin-top-left'} motion-safe:animate-[ps-pop_var(--d-spring)_var(--e-spring)]`}
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
