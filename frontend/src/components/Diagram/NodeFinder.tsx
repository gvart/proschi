import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { findNodes, type FindItem } from './nodeSearch';

interface NodeFinderProps {
  items: FindItem[];
  /** The dialog's name, e.g. "Find a component" or "Connect API to". */
  label: string;
  placeholder: string;
  onPick: (id: string) => void;
  onClose: () => void;
}

/** `/` or Ctrl/Cmd+F on the canvas (and Connect to… in its menu): pick a node by name, id or tech, as Ctrl+P picks a diagram. */
export default function NodeFinder({ items, label, placeholder, onPick, onClose }: NodeFinderProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const found = useMemo(() => findNodes(items, query).slice(0, 50), [items, query]);
  const index = Math.min(active, Math.max(found.length - 1, 0));

  useEffect(() => {
    listRef.current?.children[index]?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const pick = (item: FindItem | undefined) => {
    onClose();
    if (item) onPick(item.id);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label={label}
        className="w-full max-w-lg overflow-hidden rounded-brutal border-bw-2 border-ink bg-surface text-ink shadow-brutal-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b-bw-1 border-ink px-3">
          <Search size={16} className="text-muted" />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="node-finder-list"
            aria-activedescendant={found[index] ? `node-finder-${found[index].id}` : undefined}
            aria-label="Component name"
            placeholder={placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive(Math.min(index + 1, found.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive(Math.max(index - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                pick(found[index]);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                // The canvas's own Escape handlers (its menu) must not see it.
                e.stopPropagation();
                onClose();
              }
            }}
            className="w-full bg-transparent py-3 text-base outline-hidden placeholder:text-muted"
          />
        </div>
        <ul id="node-finder-list" ref={listRef} role="listbox" aria-label="Components" className="max-h-[50vh] overflow-y-auto py-1">
          {found.map((item, i) => (
            <li
              key={item.id}
              id={`node-finder-${item.id}`}
              role="option"
              aria-selected={i === index}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(item)}
              className={`flex cursor-pointer items-baseline gap-2 px-3 py-1.5 ${i === index ? 'bg-pop-yellow text-on-accent' : ''}`}
            >
              <span className="min-w-0 truncate text-sm font-semibold">{item.name}</span>
              <span className={`ml-auto shrink-0 truncate font-mono text-xs ${i === index ? 'text-on-accent/80' : 'text-muted'}`}>
                {item.id}
                {item.tech && item.tech !== item.name ? ` · ${item.tech}` : ''}
              </span>
            </li>
          ))}
          {found.length === 0 && <li className="px-3 py-2 text-sm text-muted">No component matches.</li>}
        </ul>
      </div>
    </div>
  );
}
