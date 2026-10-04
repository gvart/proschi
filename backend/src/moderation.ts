/**
 * Display names appear on the public leaderboard, so a few are refused: ones
 * that pass for the site or its staff, and a short list of slurs. Checked on
 * a folded form, so "Pr0schi  Admin" and "ADM1N" count too. Staff words
 * count only as whole words, so "Badminton" is fine.
 */

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };

const lettersOnly = (text: string) => text.replace(/[^\p{L}]/gu, '');
const unleet = (text: string) => [...text].map((c) => LEET[c] ?? c).join('');

/** Compatibility forms folded (NFKC), lowercase, look-alike digits and symbols as letters, then letters only. */
export function normalizeForCheck(name: string): string {
  return lettersOnly(unleet(name.normalize('NFKC').toLowerCase()));
}

/**
 * The words of `name`, folded like normalizeForCheck: each both with its
 * look-alikes read as letters ("4dm1n") and with digits dropped ("admin42").
 */
export function wordsForCheck(name: string): string[] {
  const words = name.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}@$]+/u);
  return words.flatMap((w) => [lettersOnly(unleet(w)), lettersOnly(w)]).filter(Boolean);
}

const RESERVED = new Set(['admin', 'administrator', 'moderator', 'mod', 'support', 'staff', 'official', 'system', 'root', 'deleted', 'null']);
/** As a whole word anywhere in the name; not "system" or "root", common in innocent names here ("System Design Fan"). */
const STAFF_WORDS = new Set(['admin', 'administrator', 'moderator', 'mod', 'staff', 'official']);
/** Anywhere in the name, even inside a word. */
const SITE_NAME = 'proschi';
// Substrings, so only words that are rarely part of an innocent name.
const BLOCKED = ['fuck', 'nigger', 'nigga', 'faggot', 'whore', 'hitler'];

/** Why `name` (already cleaned) cannot be a display name; undefined when it can. */
export function rejectName(name: string): string | undefined {
  const folded = normalizeForCheck(name);
  if (RESERVED.has(folded)) return 'That name is reserved; choose another';
  if (folded.includes(SITE_NAME) || wordsForCheck(name).some((word) => STAFF_WORDS.has(word))) return 'That name could pass for the site or its staff; choose another';
  if (BLOCKED.some((word) => folded.includes(word))) return 'That name is not allowed; choose another';
  return undefined;
}
