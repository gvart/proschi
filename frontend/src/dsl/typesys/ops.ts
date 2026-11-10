import { editDistance } from '../../catalog/componentCatalog';
import type { ResolvedType, TypeOp } from './types';

/**
 * Typed operations in use case steps (docs/design/typed-components.md,
 * "Typed operations in steps"): a step label names one of its target type's
 * operations, its HTTP method or its first words.
 */

/**
 * The operation `text` starts with, ignoring case: an op name followed by the
 * end or a non-word character (`SELECT users`, `"GetItem" …`). Op names may be
 * several words (`op read "full scan"`); the longest match wins.
 */
export function findOp(type: Pick<ResolvedType, 'ops'>, text: string): TypeOp | undefined {
  const t = text.trimStart().replace(/^"/, '').toLowerCase();
  let best: TypeOp | undefined;
  for (const op of type.ops) {
    const name = op.name.toLowerCase();
    if (!t.startsWith(name) || /[A-Za-z0-9_]/.test(t.charAt(name.length))) continue;
    if (!best || op.name.length > best.name.length) best = op;
  }
  return best;
}

/** The first word of a label, after an opening quote: what a step names as its operation. */
export function opWord(text: string): string | undefined {
  return /^\s*"?([A-Za-z_][A-Za-z0-9_]*)/.exec(text)?.[1];
}

/** The op name closest to `word`, when it is close enough to be a typo. */
export function suggestOp(type: Pick<ResolvedType, 'ops'>, word: string): string | undefined {
  const w = word.toLowerCase();
  let best: string | undefined;
  let bestDistance = Math.max(1, Math.floor(w.length / 3)) + 1;
  for (const op of type.ops) {
    const d = editDistance(w, op.name.toLowerCase());
    if (d < bestDistance) [best, bestDistance] = [op.name, d];
  }
  return best;
}

/** The header of `type` named `name`, ignoring case. */
export function findHeader(type: Pick<ResolvedType, 'headers'>, name: string): string | undefined {
  const n = name.toLowerCase();
  return type.headers.find((h) => h.toLowerCase() === n);
}

/** The header name closest to `name`, when it is close enough to be a typo. */
export function suggestHeader(type: Pick<ResolvedType, 'headers'>, name: string): string | undefined {
  const n = name.toLowerCase();
  let best: string | undefined;
  let bestDistance = Math.max(1, Math.floor(n.length / 3)) + 1;
  for (const h of type.headers) {
    const d = editDistance(n, h.toLowerCase());
    if (d < bestDistance) [best, bestDistance] = [h, d];
  }
  return best;
}
