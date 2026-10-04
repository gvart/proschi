/**
 * Display names appear on the public leaderboard, so a few are refused: ones
 * that pass for the site or its staff, and a short list of slurs. Checked on
 * a folded form, so "Pr0schi  Admin" and "ADM1N" count too.
 */

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };

/** Compatibility forms folded (NFKC), lowercase, look-alike digits and symbols as letters, then letters only. */
export function normalizeForCheck(name: string): string {
  return [...name.normalize('NFKC').toLowerCase()]
    .map((c) => LEET[c] ?? c)
    .join('')
    .replace(/[^\p{L}]/gu, '');
}

const RESERVED = new Set(['admin', 'administrator', 'moderator', 'mod', 'support', 'staff', 'official', 'system', 'root', 'deleted', 'null']);
const IMPERSONATION = ['proschi', 'admin', 'moderator'];
// Substrings, so only words that are rarely part of an innocent name.
const BLOCKED = ['fuck', 'nigger', 'nigga', 'faggot', 'whore', 'hitler'];

/** Why `name` (already cleaned) cannot be a display name; undefined when it can. */
export function rejectName(name: string): string | undefined {
  const folded = normalizeForCheck(name);
  if (RESERVED.has(folded)) return 'That name is reserved; choose another';
  if (IMPERSONATION.some((word) => folded.includes(word))) return 'That name could pass for the site or its staff; choose another';
  if (BLOCKED.some((word) => folded.includes(word))) return 'That name is not allowed; choose another';
  return undefined;
}
