import type { ProblemListing } from '../practice/listing';

/**
 * The practice problems for the landing page, from the same folders as the
 * practice page (frontend/src/practice/problems/<id>/problem.md), rendered
 * into index.html at build time (plugins/practiceListings.ts replaces the
 * `<!--practice:…-->` placeholders), so the list and its count are complete
 * at first paint and never fall behind the folders.
 */

export { listingsFrom } from '../practice/listing';

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const DIFFICULTY_BADGE: Record<string, string> = { easy: 'ps-badge--pass', medium: 'ps-badge--yellow', hard: 'ps-badge--pink' };

/** The `<li>` items of the landing page's practice list. */
export function practiceListHtml(problems: Pick<ProblemListing, 'id' | 'title' | 'summary' | 'difficulty'>[]): string {
  return problems
    .map(
      (p) => `<li>
  <a class="ps-card ps-card--interactive tile" href="./practice/${encodeURIComponent(p.id)}/">
    <span class="tile__name">${escapeHtml(p.title)}</span>
    <span class="ps-badge ${DIFFICULTY_BADGE[p.difficulty] ?? ''}">${escapeHtml(p.difficulty)}</span>
    <span class="tile__desc">${escapeHtml(p.summary)}</span>
    <span class="tile__go" aria-hidden="true">Solve →</span>
  </a>
</li>`,
    )
    .join('\n');
}

type Listed = Pick<ProblemListing, 'id' | 'title' | 'summary' | 'difficulty'>;

const PLACEHOLDER = /<!--practice:([a-z-]+)-->/g;

/** `html` with every `<!--practice:…-->` placeholder filled (`list`, `problem-count`); an unknown name is an error. */
export function fillPracticePlaceholders(html: string, problems: Listed[]): string {
  const values: Record<string, string> = { list: practiceListHtml(problems), 'problem-count': String(problems.length) };
  return html.replace(PLACEHOLDER, (_, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`unknown placeholder <!--practice:${name}-->`);
    return value;
  });
}
