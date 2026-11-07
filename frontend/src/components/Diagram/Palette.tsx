import { useEffect, useMemo, useRef, useState } from 'react';
import { GripVertical, Search, X } from 'lucide-react';
import { getTechStackIcon } from '../../utils/iconMapping';
import { eyebrow, field, iconButton } from '../Playground/ui';
import { GROUP_PREVIEW, paletteGroups } from './paletteGroups';

/** The drag-and-drop type a palette item carries: its tech stack. */
export const TECH_DRAG_TYPE = 'application/x-proschi-tech';

interface PaletteProps {
  /** Adds the component; the canvas places it. */
  onAdd: (techStack: string) => void;
  onClose: () => void;
  /** `panel`: docked beside the canvas, drag or click; `sheet`: a phone's bottom sheet, tap to add. */
  variant?: 'panel' | 'sheet';
  /** Focus the search when shown: when the reader opened it, never on page load. */
  autoFocus?: boolean;
}

/**
 * The catalog's components, grouped by what they do and searchable. Drag one
 * onto the canvas to add it where it is dropped, or click (tap) it to add it
 * where the layout puts it.
 */
export default function Palette({ onAdd, onClose, variant = 'panel', autoFocus = false }: PaletteProps) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);
  const groups = useMemo(() => paletteGroups(query), [query]);
  const searching = query.trim() !== '';
  const sheet = variant === 'sheet';

  return (
    <aside
      role="region"
      aria-label="Components"
      className={`flex min-h-0 flex-col bg-surface text-ink ${sheet ? 'max-h-full' : 'h-full'}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex items-center gap-1 border-b border-ink/15 p-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search components</span>
          <Search size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && groups[0]) onAdd(groups[0].entries[0].techStack);
            }}
            placeholder="Search"
            className={`${field} w-full pl-7`}
          />
        </label>
        <button type="button" aria-label="Hide components" title="Hide components" onClick={onClose} className={iconButton}>
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
        {groups.length === 0 && <p className="px-2 py-3 text-sm text-muted">No component matches “{query}”.</p>}
        {groups.map(({ id, label, entries }) => {
          const open = searching || expanded.has(id);
          const shown = open ? entries : entries.slice(0, GROUP_PREVIEW);
          const more = entries.length - shown.length;
          return (
            <section key={id} aria-label={label} className="pb-1">
              <h3 className={`${eyebrow} px-2 pb-0.5 pt-2`}>{label}</h3>
              <ul>
                {shown.map((c) => (
                  <li key={c.techStack}>
                    <button
                      type="button"
                      draggable={!sheet}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(TECH_DRAG_TYPE, c.techStack);
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                      onClick={() => onAdd(c.techStack)}
                      title={sheet ? undefined : `Drag onto the canvas, or click to add ${c.techStack}`}
                      className={`group flex w-full items-center gap-2 rounded-sm px-2 text-left text-sm text-ink hover:bg-ink/10 focus-visible:bg-ink/10 ${sheet ? 'py-2.5' : 'py-1.5 cursor-grab active:cursor-grabbing'}`}
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center [&_svg]:h-4 [&_svg]:w-4">{getTechStackIcon(c.techStack, c.type)}</span>
                      <span className="flex-1 truncate">{c.techStack}</span>
                      {!sheet && <GripVertical size={14} className="text-muted opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />}
                    </button>
                  </li>
                ))}
              </ul>
              {more > 0 && (
                <button
                  type="button"
                  onClick={() => setExpanded((s) => new Set(s).add(id))}
                  className="ml-2 mt-0.5 rounded-sm px-2 py-1 text-xs font-semibold text-ink/75 hover:bg-ink/10 hover:text-ink"
                >
                  {more} more
                </button>
              )}
            </section>
          );
        })}
      </div>
      <p className="border-t border-ink/15 px-3 py-2 text-xs text-muted">{sheet ? 'Tap a component to add it.' : 'Drag onto the canvas, or click to add.'}</p>
    </aside>
  );
}
