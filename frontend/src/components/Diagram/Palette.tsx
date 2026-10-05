import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import { componentCatalog, techKey } from '../../catalog/componentCatalog';
import { getTechStackIcon } from '../../utils/iconMapping';
import { eyebrow, field, iconButton } from '../Playground/ui';

/** The drag-and-drop type a palette item carries: its tech stack. */
export const TECH_DRAG_TYPE = 'application/x-proschi-tech';

/** Categories shown first when nothing is searched; the rest follow in catalog order. */
const FIRST = ['Generic Components', 'Generic Shapes'];

// Groups need a block in the text, so they are written by hand.
const items = componentCatalog.filter((c) => c.type !== 'group');

interface PaletteProps {
  /** Adds the component; the canvas places it. */
  onAdd: (techStack: string) => void;
  onClose: () => void;
}

/**
 * A searchable list of the catalog's components. Click one to add it, or drag
 * it onto the canvas to add it where it is dropped.
 */
export default function Palette({ onAdd, onClose }: PaletteProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  // A press outside closes it, like a menu; the button that opened it toggles it itself.
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Element;
      if (!rootRef.current?.contains(target) && !target.closest?.('[aria-haspopup="dialog"]')) onClose();
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [onClose]);

  const groups = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matching = items.filter((c) => {
      if (words.length === 0) return true;
      const text = `${c.techStack} ${c.searchTerms} ${'aliases' in c ? c.aliases.join(' ') : ''}`.toLowerCase();
      const key = techKey(text);
      return words.every((w) => text.includes(w) || key.includes(techKey(w)));
    });
    const byCategory = new Map<string, typeof items>();
    for (const c of matching) byCategory.set(c.category, [...(byCategory.get(c.category) ?? []), c]);
    const order = [...FIRST.filter((c) => byCategory.has(c)), ...[...byCategory.keys()].filter((c) => !FIRST.includes(c))];
    return order.map((category) => ({ category, entries: byCategory.get(category)! }));
  }, [query]);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Add a component"
      className="flex max-h-[min(70vh,28rem)] w-[min(18rem,calc(100vw-2rem))] flex-col rounded border-bw-1 border-ink bg-surface shadow-brutal-md"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex items-center gap-1 border-b border-ink/15 p-2">
        <label className="relative flex-1">
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
            placeholder="Redis, queue, S3…"
            className={`${field} w-full pl-7`}
          />
        </label>
        <button type="button" aria-label="Close" onClick={onClose} className={iconButton}>
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {groups.length === 0 && <p className="px-2 py-3 text-sm text-muted">No component matches “{query}”.</p>}
        {groups.map(({ category, entries }) => (
          <section key={category} aria-label={category} className="pb-1">
            <h3 className={`${eyebrow} px-2 pb-0.5 pt-2`}>{category}</h3>
            <ul>
              {entries.map((c) => (
                <li key={c.techStack}>
                  <button
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(TECH_DRAG_TYPE, c.techStack);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={() => onAdd(c.techStack)}
                    className="group flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-ink hover:bg-ink/10 focus-visible:bg-ink/10"
                  >
                    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center [&_svg]:h-4 [&_svg]:w-4">{getTechStackIcon(c.techStack, c.type)}</span>
                    <span className="flex-1 truncate">{c.techStack}</span>
                    <Plus size={14} className="text-muted opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="hidden border-t border-ink/15 px-2 py-1.5 text-xs text-muted md:block">Click to add, or drag onto the canvas.</p>
    </div>
  );
}
