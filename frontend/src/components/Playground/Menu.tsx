import { useEffect, useRef, useState, type ReactNode } from 'react';

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
        className="inline-flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded-md text-gray-700 hover:bg-gray-100"
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute z-50 mt-1 min-w-[16rem] max-w-[calc(100vw-2rem)] rounded-lg border border-gray-200 bg-white py-1 shadow-lg ${align === 'right' ? 'right-0' : 'left-0'}`}
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
      className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
    >
      {icon}
      {children}
    </button>
  );
}
