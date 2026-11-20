import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Zap } from 'lucide-react';
import { findTech } from '../../catalog/componentCatalog';
import type { ResolvedType } from '../../dsl';
import { getTechStackIcon } from '../../utils/iconMapping';
import { quickItems, type QuickAction, type QuickItem } from './quickItems';

interface QuickAddProps {
  /** The document's own types, offered first. */
  types: readonly ResolvedType[];
  actions: readonly QuickAction[];
  /** The name of the selected component a new one is connected from, if any. */
  connectFrom?: string;
  onAdd: (tech: string) => void;
  onClose: () => void;
}

/**
 * The canvas's command bar (A, or Ctrl/Cmd+K): plain words find a component to
 * add, connected from the selection as a palette click adds it, or an action
 * (New use case, Rename, Fit view…). Enter does the first.
 */
export default function QuickAdd({ types, actions, connectFrom, onAdd, onClose }: QuickAddProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const items = useMemo(() => quickItems(query, types, actions), [query, types, actions]);
  const index = Math.min(active, Math.max(items.length - 1, 0));

  useEffect(() => {
    listRef.current?.children[index]?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const run = (item: QuickItem | undefined) => {
    if (!item) return;
    onClose();
    if (item.kind === 'add') onAdd(item.choice.name);
    else item.action.run();
  };
  const key = (item: QuickItem) => (item.kind === 'add' ? `add:${item.choice.name}` : `action:${item.action.id}`);
  const domId = (item: QuickItem) => `quick-add-${key(item).replace(/\W+/g, '_')}`;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="Command bar"
        className="w-full max-w-lg overflow-hidden rounded-brutal border-bw-2 border-ink bg-surface text-ink shadow-brutal-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b-bw-1 border-ink px-3">
          <Zap size={16} className="text-muted" aria-hidden="true" />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="quick-add-list"
            aria-activedescendant={items[index] ? domId(items[index]) : undefined}
            aria-label="Add a component or run an action"
            placeholder="A component or an action: redis, rename…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive(Math.min(index + 1, items.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive(Math.max(index - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                run(items[index]);
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
        <ul id="quick-add-list" ref={listRef} role="listbox" aria-label="Results" className="max-h-[50vh] overflow-y-auto py-1">
          {items.map((item, i) => {
            const on = i === index;
            return (
              <li
                key={key(item)}
                id={domId(item)}
                role="option"
                aria-selected={on}
                onMouseEnter={() => setActive(i)}
                onClick={() => run(item)}
                className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 ${on ? 'bg-pop-yellow text-on-accent' : ''}`}
              >
                {item.kind === 'add' ? (
                  <>
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center [&_svg]:h-4 [&_svg]:w-4">
                      {getTechStackIcon(item.choice.icon ?? item.choice.name, item.choice.icon ? findTech(item.choice.icon)?.type : undefined)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      Add <span className="font-semibold">{item.choice.name}</span>
                      {item.choice.doc && <span className={`ml-2 text-xs ${on ? 'text-on-accent/80' : 'text-muted'}`}>{item.choice.doc}</span>}
                    </span>
                  </>
                ) : (
                  <>
                    <CornerDownLeft size={14} className="shrink-0 opacity-60" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{item.action.label}</span>
                    {item.action.keys && (
                      <kbd className={`shrink-0 rounded-sm border px-1.5 py-0.5 font-mono text-xs ${on ? 'border-on-accent/40' : 'border-ink/30 text-muted'}`}>{item.action.keys}</kbd>
                    )}
                  </>
                )}
              </li>
            );
          })}
          {items.length === 0 && <li className="px-3 py-2 text-sm text-muted">Nothing matches “{query.trim()}”.</li>}
        </ul>
        <p className="border-t border-ink/15 px-3 py-2 text-xs text-muted">
          {connectFrom ? `A component is added connected from ${connectFrom}.` : 'Type a component, like redis or queue, or an action.'} <kbd className="font-sans font-semibold text-ink">Enter</kbd> does the first.
        </p>
      </div>
    </div>
  );
}
