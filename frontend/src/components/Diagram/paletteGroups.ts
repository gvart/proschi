import { componentCatalog, techKey } from '../../catalog/componentCatalog';
import { kindOf } from '../../dsl/kinds';
import type { Kind } from '../../dsl/types';

/**
 * The component palette's groups: the catalog sorted by what a component does
 * in a design (its simulation kind), not by vendor, so someone who does not
 * know the products still finds "a cache" or "a queue".
 */

export type PaletteEntry = (typeof componentCatalog)[number];

export interface PaletteGroup {
  id: string;
  label: string;
  entries: PaletteEntry[];
}

const GROUPS: { id: string; label: string; kinds: readonly Kind[] }[] = [
  { id: 'clients', label: 'Clients', kinds: ['client'] },
  { id: 'edge', label: 'Edge & CDN', kinds: ['edge', 'cdn', 'loadbalancer', 'gateway', 'dns'] },
  { id: 'compute', label: 'Compute & APIs', kinds: ['service', 'function'] },
  { id: 'data', label: 'Data stores', kinds: ['database', 'search', 'analytics', 'storage'] },
  { id: 'caches', label: 'Caches', kinds: ['cache'] },
  { id: 'queues', label: 'Queues & streams', kinds: ['queue', 'broker'] },
  { id: 'external', label: 'External', kinds: ['external'] },
];

/** Shapes that stand for a client; the other shapes (boxes, notes) go last. */
const CLIENT_SHAPES = new Set(['Actor', 'Browser', 'Mobile App']);
const SHAPES: PaletteGroup = { id: 'shapes', label: 'Shapes & notes', entries: [] };

// Groups need a block in the text, so they are written by hand.
const ENTRIES = componentCatalog.filter((c) => c.type !== 'group');

function groupOf(c: PaletteEntry): string {
  if (c.type === 'text' || (c.type === 'shape' && !CLIENT_SHAPES.has(c.techStack))) return SHAPES.id;
  const kind = kindOf({ kind: 'component', type: c.type, techStack: c.techStack });
  return GROUPS.find((g) => g.kinds.includes(kind))?.id ?? SHAPES.id;
}

/** Generic components (one per kind) come first in their group, then the products in catalog order. */
const rank = (c: PaletteEntry) => (c.category === 'Generic Components' || CLIENT_SHAPES.has(c.techStack) ? 0 : 1);

function matches(c: PaletteEntry, words: string[]): boolean {
  const text = `${c.techStack} ${c.searchTerms} ${'aliases' in c ? c.aliases.join(' ') : ''}`.toLowerCase();
  const key = techKey(text);
  return words.every((w) => text.includes(w) || key.includes(techKey(w)));
}

/** The palette's groups for a search (every word must match), without the empty ones. */
export function paletteGroups(query = ''): PaletteGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const all = [...GROUPS.map(({ id, label }) => ({ id, label, entries: [] as PaletteEntry[] })), { ...SHAPES, entries: [] as PaletteEntry[] }];
  for (const c of ENTRIES) if (words.length === 0 || matches(c, words)) all.find((g) => g.id === groupOf(c))!.entries.push(c);
  // A search puts the names that start with it first: "redis" finds Redis before AWS ElastiCache.
  const named = (c: PaletteEntry) => (words.length > 0 && c.techStack.toLowerCase().startsWith(words[0]) ? 0 : 1);
  for (const g of all) g.entries.sort((a, b) => named(a) - named(b) || rank(a) - rank(b));
  return all.filter((g) => g.entries.length > 0);
}

/** How many entries a group shows before "more", when nothing is searched. */
export const GROUP_PREVIEW = 6;
