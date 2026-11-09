import type { Edit } from './contract';

/**
 * A change's find-and-replace edits on the page's side: whether they still
 * apply to the source as it is now, and the lines they change, for the
 * change card's diff. Pure.
 */

/** The source with every edit applied in order (each to the first match), or null when one no longer finds its text. */
export function applyEdits(source: string, edits: readonly Edit[]): string | null {
  let out = source;
  for (const { find, replace } of edits) {
    if (find === '') return null;
    const at = out.indexOf(find);
    if (at < 0) return null;
    out = out.slice(0, at) + replace + out.slice(at + find.length);
  }
  return out;
}

export type DiffLine = { kind: 'same' | 'add' | 'remove'; text: string };

export interface Hunk {
  /** The 1-based line in `source` the edit starts on, when it finds its text there. */
  line?: number;
  lines: DiffLine[];
}

const splitLines = (s: string) => s.replace(/\n$/, '').split('\n');

/** Line diff of two short texts (an edit's find and replace): longest common subsequence. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before === '' ? [] : splitLines(before);
  const b = after === '' ? [] : splitLines(after);
  const n = a.length;
  const m = b.length;
  // lcs[i][j]: the longest common subsequence of a[i..] and b[j..].
  const lcs = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] });
      i++;
      j++;
    } else if (j < m && (i === n || lcs[i][j + 1] >= lcs[i + 1][j])) {
      out.push({ kind: 'add', text: b[j++] });
    } else {
      out.push({ kind: 'remove', text: a[i++] });
    }
  }
  return out;
}

/** One hunk per edit, numbered against `source` (the source the edits apply to) where they find their text. */
export function editHunks(source: string | undefined, edits: readonly Edit[]): Hunk[] {
  let current = source;
  return edits.map(({ find, replace }) => {
    const at = current?.indexOf(find) ?? -1;
    const line = current !== undefined && at >= 0 ? current.slice(0, at).split('\n').length : undefined;
    if (current !== undefined && at >= 0) current = current.slice(0, at) + replace + current.slice(at + find.length);
    return { ...(line !== undefined ? { line } : {}), lines: diffLines(find, replace) };
  });
}

/** Lines added and removed over all hunks. */
export function countLines(hunks: readonly Hunk[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const h of hunks) {
    added += h.lines.filter((l) => l.kind === 'add').length;
    removed += h.lines.filter((l) => l.kind === 'remove').length;
  }
  return { added, removed };
}
