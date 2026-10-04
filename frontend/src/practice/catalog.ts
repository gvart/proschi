import { catalogFromFiles } from './problemFiles';
import type { Problem } from './types';

/**
 * Every practice problem, found at build time: each folder in ./problems is
 * one problem (docs/PRACTICE.md). Nothing to register; add a folder.
 */

const files = {
  ...import.meta.glob<string>('./problems/*/*', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob<string>('./problems/*/wrong/*.proschi', { query: '?raw', import: 'default', eager: true }),
};

const catalog = catalogFromFiles(Object.fromEntries(Object.entries(files).map(([path, text]) => [path.replace(/^\.\/problems\//, ''), text])));

/** In list order: by difficulty (easy first), then `order`, then title. */
export const problems: Problem[] = catalog.problems;

/** Problem folders that could not be read (they are left out); the tests require none. */
export const catalogErrors = catalog.errors;

export function findProblem(id: string): Problem | undefined {
  return problems.find((p) => p.id === id);
}
