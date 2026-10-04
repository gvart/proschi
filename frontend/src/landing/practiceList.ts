import { compareProblems, readProblemMd, type ProblemMeta } from '../practice/problemFiles';

/**
 * The practice problems for the landing page, from the same folders as the
 * practice page (frontend/src/practice/problems/<id>/problem.md). Only the
 * problem.md files are bundled here, not the designs.
 */

export type ProblemListing = Pick<ProblemMeta, 'title' | 'summary' | 'difficulty' | 'order'> & { id: string };

/** problem.md files keyed `<id>/problem.md`, in list order; folders that cannot be read are left out (the practice tests report them). */
export function listingsFrom(files: Record<string, string>): ProblemListing[] {
  const out: ProblemListing[] = [];
  for (const [path, text] of Object.entries(files)) {
    const id = path.split('/')[0];
    try {
      const { title, summary, difficulty, order } = readProblemMd(id, text);
      out.push({ id, title, summary, difficulty, ...(order !== undefined ? { order } : {}) });
    } catch {
      // Reported by the practice tests.
    }
  }
  return out.sort(compareProblems);
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The `<li>` items of the landing page's practice list. */
export function practiceListHtml(problems: ProblemListing[]): string {
  return problems
    .map(
      (p) => `<li>
  <a class="example" href="./practice/#/${encodeURIComponent(p.id)}">
    <span class="example__name">${escapeHtml(p.title)} <span class="tag${p.difficulty === 'hard' ? ' tag--error' : ''}">${p.difficulty}</span></span>
    <span class="example__desc">${escapeHtml(p.summary)}</span>
    <span class="example__go" aria-hidden="true">Solve →</span>
  </a>
</li>`,
    )
    .join('\n');
}
