import { readShareLink } from '../playground/share';
import { shareIdFromSearch } from '../services/shares';

/** What the embed page shows: a short link's diagram, a `#code=` link's, or why it cannot. */
export type EmbedTarget =
  | { kind: 'short'; id: string }
  | { kind: 'hash'; source: string; imports?: Record<string, string> }
  | { kind: 'error'; message: string };

export const NO_DIAGRAM_MESSAGE = 'No diagram here: the embed code needs ?s=<short link id> or #code=… from Proschi’s Share menu.';

/** Reads the embed page's address: `?s=<id>` wins over `#code=…`. */
export function embedTarget(search: string, hash: string): EmbedTarget {
  const id = shareIdFromSearch(search);
  if (id) return { kind: 'short', id };
  const link = readShareLink(hash);
  if (!link) return { kind: 'error', message: NO_DIAGRAM_MESSAGE };
  if ('error' in link) return { kind: 'error', message: link.error };
  return { kind: 'hash', source: link.source, ...(link.imports ? { imports: link.imports } : {}) };
}
