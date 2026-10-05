import { compareProblems, readProblemMd } from './problemFiles';
import type { Problem } from './types';

/**
 * What a list of practice problems shows (the practice page's list, the
 * landing page), read from the problem.md files alone. Both pages get the
 * entries prebuilt from `virtual:practice-listings` (plugins/practiceListings.ts),
 * so neither bundles the statements or the designs.
 */

export type ProblemListing = Pick<Problem, 'id' | 'title' | 'summary' | 'difficulty' | 'tags' | 'company' | 'order'>;

/** problem.md files keyed `<id>/problem.md`, in list order; folders that cannot be read are left out (the practice tests report them). */
export function listingsFrom(files: Record<string, string>): ProblemListing[] {
  const out: ProblemListing[] = [];
  for (const [path, text] of Object.entries(files)) {
    const id = path.split('/')[0];
    try {
      const { title, summary, difficulty, tags, company, order } = readProblemMd(id, text);
      out.push({ id, title, summary, difficulty, tags, ...(company !== undefined ? { company } : {}), ...(order !== undefined ? { order } : {}) });
    } catch {
      // Reported by the practice tests.
    }
  }
  return out.sort(compareProblems);
}
