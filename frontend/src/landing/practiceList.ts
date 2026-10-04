import type { ProblemListing } from '../practice/listing';

/**
 * The practice problems for the landing page, from the same folders as the
 * practice page (frontend/src/practice/problems/<id>/problem.md). The page
 * imports them prebuilt from `virtual:practice-listings`: only the list
 * entries are bundled, not the statements or designs.
 */

export { listingsFrom } from '../practice/listing';

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The `<li>` items of the landing page's practice list. */
export function practiceListHtml(problems: Pick<ProblemListing, 'id' | 'title' | 'summary' | 'difficulty'>[]): string {
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
