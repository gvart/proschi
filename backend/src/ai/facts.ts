import type { ProblemContext, Topic } from './context';

/**
 * What the candidate of an AI interview already knows (docs/design/paid-plans.md
 * P38): the statement they were shown, and every clarify topic's fact that was
 * asked for (`covered`) or revealed (`revealed`) in the session. The
 * interviewer and the hint are both given this list and told never to ask, or
 * suggest asking, for anything on it.
 *
 * A fact is revealed when the interviewer's reply states it: the hint model
 * says so, and the numbers check below catches the ones with numbers even when
 * the hint call fails.
 */

const SUFFIX: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, t: 1e12, thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };

/** The numbers in a text, as values ("10k" and "10,000" are both 10000; "p99" and "v2" are not numbers). */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(?<![a-z\d.])\$?(\d[\d,]*(?:\.\d+)?)\s?([kmbt](?![a-z])|thousand|million|billion|trillion)?/gi)) {
    const value = Number(m[1].replace(/,/g, '')) * (m[2] ? SUFFIX[m[2].toLowerCase()] : 1);
    if (Number.isFinite(value)) out.push(value);
  }
  return out;
}

/** The clarify topics whose numbers all appear in `reply`; a fact without numbers is left to the hint model. */
export function revealedIn(topics: readonly Topic[], reply: string): string[] {
  const said = new Set(numbersIn(reply));
  return topics
    .filter((t) => t.kind === 'clarify' && t.source)
    .filter((t) => {
      const needed = numbersIn(t.source!);
      return needed.length > 0 && needed.every((n) => said.has(n));
    })
    .map((t) => t.id);
}

/** The clarify topics the candidate knows: asked for or revealed. */
export function knownTopics(context: ProblemContext, state: { covered: readonly string[]; revealed?: readonly string[] }): Topic[] {
  const known = new Set([...state.covered, ...(state.revealed ?? [])]);
  return context.topics.filter((t) => t.kind === 'clarify' && known.has(t.id));
}

/** The <known_facts> block both models get. */
export function knownFactsBlock(context: ProblemContext, state: { covered: readonly string[]; revealed?: readonly string[] }): string {
  const known = knownTopics(context, state);
  // The areas only, not the reference answers: a topic can hold more than the
  // reply gave (a smoke run had the model "recall" a number it never said).
  const list = known.length ? known.map((t) => `- [${t.id}] ${t.label}`).join('\n') : '- none yet, beyond the statement';
  return `<known_facts>\nThe candidate already knows everything in <statement_shown> and these areas, asked about or answered earlier in this session. Never ask them about one of these again, ask them to confirm it, or suggest they ask about it. What they know of an area is exactly what the interviewer said about it in the transcript, nothing more: never claim you told them something you did not.\n${list}\n</known_facts>`;
}
