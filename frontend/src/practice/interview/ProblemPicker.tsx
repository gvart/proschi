import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { field, iconButton } from '../../components/Playground/ui';
import { DifficultyBadge } from '../Badges';
import type { ProblemListing } from '../listing';

/**
 * "Choose a problem": every problem, searchable by title, summary and tag,
 * in a dialog of the design system's look. Escape or the backdrop closes it.
 */
export default function ProblemPicker({ problems, done, chosen, onPick, onClose }: { problems: readonly ProblemListing[]; done: readonly string[]; chosen?: string; onPick: (id: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? problems.filter((p) => `${p.title} ${p.summary} ${p.tags.join(' ')} ${p.company ?? ''}`.toLowerCase().includes(q)) : problems;
  }, [problems, query]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-3 pt-[8dvh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose a problem"
        className="flex max-h-[80dvh] w-full max-w-lg flex-col overflow-hidden rounded-brutal border-bw-2 border-ink bg-surface text-ink shadow-brutal-lg"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="flex items-center gap-2 border-b-bw-1 border-ink p-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search problems</span>
            <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input ref={input} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or topic" className={`w-full ${field} !pl-8`} />
          </label>
          <button type="button" onClick={onClose} className={iconButton} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto p-1.5" aria-label="Problems">
          {shown.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onPick(p.id)}
                aria-current={p.id === chosen ? 'true' : undefined}
                className={`flex w-full items-start gap-3 rounded-sm px-2.5 py-2 text-left hover:bg-pop-yellow/25 focus-visible:bg-pop-yellow/25 focus-visible:outline-hidden ${p.id === chosen ? 'bg-ink/5' : ''}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-bold">{p.title}</span>
                    {done.includes(p.id) && <span className="shrink-0 text-xs text-muted">done before</span>}
                  </span>
                  <span className="block truncate text-xs text-muted">{p.summary}</span>
                </span>
                <DifficultyBadge difficulty={p.difficulty} />
                {p.id === chosen && <Check size={15} className="mt-0.5 shrink-0" aria-hidden="true" />}
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">No problem matches “{query}”.</li>}
        </ul>
      </div>
    </div>
  );
}
