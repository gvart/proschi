import { useEffect, useId, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { findTech } from '../../catalog/componentCatalog';
import { ROOT_TYPE, type ResolvedType } from '../../dsl';
import type { Diagram } from '../../dsl/types';
import { opsMostSpecificFirst, typeTableOf } from '../../dsl/typesys/vocabulary';
import { getTechStackIcon } from '../../utils/iconMapping';
import { eyebrow, field } from '../Playground/ui';
import { typeChoices, type TypeChoice } from './paletteGroups';
import { statusRank } from './stepLabel';

interface TypePickerProps {
  /** The document's own types, listed first. */
  types: readonly ResolvedType[];
  /** The component's type now, marked in the list. */
  current?: string;
  onPick: (name: string) => void;
  onClose: () => void;
}

/**
 * Changing a component's type, in the Selection tab: the document's own types
 * first ("In this design"), then the catalog as the palette groups it, each
 * with its doc line. A name nothing matches is taken as typed, as the text
 * would take it.
 */
export default function TypePicker({ types, current, onPick, onClose }: TypePickerProps) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const groups = useMemo(() => typeChoices(types, query), [types, query]);
  const choices = groups.flatMap((g) => g.choices);
  const index = Math.min(active, Math.max(choices.length - 1, 0));
  const optionId = (c: TypeChoice) => `${id}-${c.name.replace(/\W+/g, '_')}`;

  useEffect(() => {
    const el = choices[index] && document.getElementById(optionId(choices[index]));
    el?.scrollIntoView({ block: 'nearest' });
    // Once per move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, query]);

  const pick = (name: string | undefined) => {
    if (name) onPick(name);
    onClose();
  };

  return (
    <div role="group" aria-label="Change type" className="rounded-sm border-bw-1 border-ink bg-surface">
      <label className="relative block border-b border-ink/15 p-1.5">
        <span className="sr-only">Search types</span>
        <Search size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-activedescendant={choices[index] ? optionId(choices[index]) : undefined}
          value={query}
          placeholder="Search types, Enter picks"
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive(Math.min(index + 1, choices.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive(Math.max(index - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              pick(choices[index]?.name ?? (query.trim() || undefined));
            } else if (e.key === 'Escape') {
              e.preventDefault();
              // The canvas's Escape (its menu, the rail) must not see it.
              e.stopPropagation();
              onClose();
            }
          }}
          className={`${field} w-full pl-7`}
        />
      </label>
      <div id={`${id}-list`} role="listbox" aria-label="Types" className="max-h-64 overflow-y-auto overscroll-contain p-1">
        {choices.length === 0 && <p className="px-2 py-2 text-sm text-muted">No type matches; Enter uses “{query.trim()}”.</p>}
        {groups.map((g) => (
          <div key={g.id} role="group" aria-label={g.label}>
            <p className={`${eyebrow} px-2 pb-0.5 pt-2`}>{g.label}</p>
            {g.choices.map((c) => {
              const i = choices.indexOf(c);
              return (
                <div
                  key={c.name}
                  id={optionId(c)}
                  role="option"
                  aria-selected={i === index}
                  aria-current={c.name === current || undefined}
                  title={c.doc}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(c.name)}
                  className={`flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-sm ${i === index ? 'bg-pop-yellow text-on-accent' : 'text-ink'}`}
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center [&_svg]:h-4 [&_svg]:w-4">{getTechStackIcon(c.icon ?? c.name, c.icon ? findTech(c.icon)?.type : undefined)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{c.name}</span>
                    {c.doc && <span className={`block truncate text-xs ${i === index ? 'text-on-accent/80' : 'text-muted'}`}>{c.doc}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** How many operations (or statuses) a row of the type card shows before "more": its own come first. */
const CARD_PREVIEW = 8;

/**
 * What a component's type is, read from the type system: its doc, the types it
 * extends, the protocol it speaks, the operations a step to it may name (its
 * own first) and the statuses it answers with. Where a user learns what a
 * component can be asked.
 */
export function TypeCard({ type, diagram }: { type: ResolvedType; diagram: Diagram }) {
  const [all, setAll] = useState(false);
  const ops = opsMostSpecificFirst(type, typeTableOf(diagram));
  const chain = [type.name, ...type.parents.filter((p) => p !== ROOT_TYPE)];
  const rows: { label: string; values: string[] }[] = [
    { label: 'Reads', values: ops.filter((o) => o.access === 'read').map((o) => o.name) },
    { label: 'Writes', values: ops.filter((o) => o.access === 'write').map((o) => o.name) },
    { label: 'Passes on', values: ops.filter((o) => o.access === 'forward').map((o) => o.name) },
    { label: 'Answers', values: [...type.statuses].sort((a, b) => statusRank(a) - statusRank(b)).map(String) },
  ];
  return (
    <section aria-label={`${type.name} type`} className="space-y-1.5 rounded-sm border border-ink/20 bg-paper px-2.5 py-2 text-xs">
      <p className="font-semibold text-ink">{chain.join(' › ')}</p>
      {type.doc && <p className="text-ink/80">{type.doc}</p>}
      {type.protocol && (
        <p>
          <span className={eyebrow}>Protocol</span> <span className="font-mono text-ink">{type.protocol}</span>
        </p>
      )}
      {rows
        .filter((r) => r.values.length > 0)
        .map((r) => (
          <div key={r.label}>
            <span className={eyebrow}>{r.label}</span>
            <ul aria-label={r.label} className="mt-0.5 flex flex-wrap gap-1">
              {(all ? r.values : r.values.slice(0, CARD_PREVIEW)).map((v) => (
                <li key={v} className="rounded-sm border border-ink/25 bg-surface px-1.5 py-0.5 font-mono text-ink">
                  {v}
                </li>
              ))}
              {!all && r.values.length > CARD_PREVIEW && (
                <li>
                  <button type="button" onClick={() => setAll(true)} className="rounded-sm px-1.5 py-0.5 font-semibold text-ink/75 hover:bg-ink/10 hover:text-ink">
                    {r.values.length - CARD_PREVIEW} more
                  </button>
                </li>
              )}
            </ul>
          </div>
        ))}
      {ops.length === 0 && <p className="text-muted">It lists no operations, so a step to it may say anything.</p>}
    </section>
  );
}
