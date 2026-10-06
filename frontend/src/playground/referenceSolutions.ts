/**
 * The practice problems' given designs and reference solutions, for the
 * editor's gallery. Import it lazily, and only when this browser has solved a
 * problem: it holds every answer.
 */

const files = import.meta.glob<string>(['../practice/problems/*/given.proschi', '../practice/problems/*/solution.proschi'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** The given and solution sources of a problem, or undefined for an unknown id. */
export function referenceSolution(id: string): { given: string; solution: string } | undefined {
  const given = files[`../practice/problems/${id}/given.proschi`];
  const solution = files[`../practice/problems/${id}/solution.proschi`];
  return given !== undefined && solution !== undefined ? { given, solution } : undefined;
}
