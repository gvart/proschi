/** The longest quote "Ask Design partner" puts in the composer; longer selections are cut. */
export const MAX_QUOTE = 600;

/**
 * Selected text as a quote for Design partner's composer: each line behind
 * `> `, blank lines dropped, cut at MAX_QUOTE characters, and an empty line
 * after it for the question. Undefined when nothing but spaces was selected.
 */
export function quoteForPartner(text: string): string | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const cut = t.length > MAX_QUOTE ? `${t.slice(0, MAX_QUOTE).trimEnd()}…` : t;
  const lines = cut
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return `${lines.map((l) => `> ${l}`).join('\n')}\n\n`;
}
