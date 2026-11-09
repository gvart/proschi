/** A node the canvas's finder can jump to (NodeFinder.tsx). */
export interface FindItem {
  id: string;
  name: string;
  tech?: string;
}

/** How well `text` matches `query` (both lower case): whole, start, start of a word, anywhere, its letters in order; 0 when not at all. */
function scoreText(text: string, query: string): number {
  if (!text) return 0;
  if (text === query) return 100;
  if (text.startsWith(query)) return 80;
  const at = text.indexOf(query);
  if (at > 0) return /[\s_\-.]/.test(text[at - 1]) ? 60 : 40;
  let from = 0;
  for (const ch of query) {
    from = text.indexOf(ch, from) + 1;
    if (from === 0) return 0;
  }
  return 20;
}

/** The items matching `query` by name, id or tech, best first (then by name); all of them by name for an empty query. */
export function findNodes<T extends FindItem>(items: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  const byName = (a: T, b: T) => a.name.localeCompare(b.name);
  if (!q) return [...items].sort(byName);
  return items
    .map((item) => ({ item, score: Math.max(scoreText(item.name.toLowerCase(), q), scoreText(item.id.toLowerCase(), q), scoreText(item.tech?.toLowerCase() ?? '', q) - 5) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || byName(a.item, b.item))
    .map((s) => s.item);
}
