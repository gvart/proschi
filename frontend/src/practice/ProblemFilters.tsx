import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';
import { eyebrow, field, outlineButton } from '../components/Playground/ui';
import { DIFFICULTIES } from './types';
import type { Status } from './progress';
import { activeFilters, capitalize, NO_FILTERS, STATUS_LABEL, type Filters } from './listFilters';

interface ProblemFiltersProps {
  query: string;
  onQuery: (query: string) => void;
  filters: Filters;
  onFilters: (filters: Filters) => void;
  tags: string[];
  companies: string[];
}

/**
 * A search box and a "Filters" button that opens the selects, so the
 * collapsed bar is one row even on a phone. Active filters show as removable
 * chips under it.
 */
export default function ProblemFilters({ query, onQuery, filters, onFilters, tags, companies }: ProblemFiltersProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const active = activeFilters(filters);
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => onFilters({ ...filters, [key]: value });

  // Opening the panel moves focus to its first select.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) panel.current?.querySelector<HTMLElement>('select')?.focus();
    wasOpen.current = open;
  }, [open]);

  const onPanelKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    setOpen(false);
    button.current?.focus();
  };

  return (
    <div className="mt-7">
      <div className="flex items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search</span>
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search problems"
            className={`w-full ${field} pl-8 placeholder:text-muted`}
          />
        </label>
        <button
          ref={button}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={active.length > 0 ? `Filters, ${active.length} active` : 'Filters'}
          onClick={() => setOpen(!open)}
          className={`flex-shrink-0 whitespace-nowrap ${outlineButton} ${active.length > 0 ? 'bg-pop-yellow/40' : ''}`}
        >
          <SlidersHorizontal size={14} aria-hidden="true" />
          Filters
          {active.length > 0 && <span className="tabular-nums">· {active.length}</span>}
          <ChevronDown size={14} aria-hidden="true" className={`transition-transform duration-d1 ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      <div
        ref={panel}
        id={panelId}
        role="group"
        aria-label="Filters"
        hidden={!open}
        onKeyDown={onPanelKey}
        className="mt-2 rounded-brutal border-bw-2 border-ink bg-surface p-3 shadow-brutal-sm sm:p-4"
      >
        <div className="grid gap-4 sm:grid-cols-[3fr_1fr]">
          <fieldset className="min-w-0">
            <legend className={eyebrow}>Problem</legend>
            <div className="mt-1.5 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 sm:grid-cols-3">
              <select
                aria-label="Difficulty"
                value={filters.difficulty}
                onChange={(e) => set('difficulty', e.target.value as Filters['difficulty'])}
                className={`w-full ${field}`}
              >
                <option value="">All difficulties</option>
                {DIFFICULTIES.map((d) => (
                  <option key={d} value={d}>
                    {capitalize(d)}
                  </option>
                ))}
              </select>
              <select aria-label="Tag" value={filters.tag} onChange={(e) => set('tag', e.target.value)} className={`w-full ${field}`}>
                <option value="">All tags</option>
                {tags.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              {companies.length > 0 && (
                <select
                  aria-label="Company"
                  value={filters.company}
                  onChange={(e) => set('company', e.target.value)}
                  className={`w-full ${field}`}
                  title="The company whose published system a problem is based on"
                >
                  <option value="">All companies</option>
                  {companies.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </fieldset>
          <fieldset className="min-w-0">
            <legend className={eyebrow}>Your progress</legend>
            <select
              aria-label="Status"
              value={filters.status}
              onChange={(e) => set('status', e.target.value as Filters['status'])}
              className={`mt-1.5 w-full ${field}`}
            >
              <option value="">Any status</option>
              {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </fieldset>
        </div>
      </div>

      {active.length > 0 && (
        // A group, not a list: the problem list stays the page's first list.
        <div role="group" aria-label="Active filters" className="mt-2 flex flex-wrap items-center gap-1.5">
          {active.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => set(f.key, '')}
              aria-label={`Remove filter ${f.label}`}
              className="inline-flex items-center gap-1 rounded-full border-bw-1 border-ink bg-pop-yellow/30 py-1 pl-2.5 pr-1.5 text-xs font-semibold text-ink transition-[background-color] duration-d1 hover:bg-pop-yellow/60"
            >
              {f.label}
              <X size={12} aria-hidden="true" />
            </button>
          ))}
          <button
            type="button"
            onClick={() => onFilters(NO_FILTERS)}
            className="rounded px-1.5 py-1 text-xs font-semibold text-ink underline underline-offset-2 hover:text-ink/70"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
