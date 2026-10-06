import { examples, helloExample, type Example } from '../dsl/examples';

/**
 * Example links (`app/?example=<id>`, ids from dsl/examples.ts) and the first
 * visit's document. An example link opens that example like a share link
 * (initialState: the same example opened twice is one diagram); the share
 * hash, when there is one, wins, since it holds the edits made since.
 */

/** The query parameter that names an example. */
export const EXAMPLE_PARAM = 'example';

/**
 * What a first visit opens: small, with a use case to play and the traffic and
 * requirements the editor tour's "Will it scale?" step shows on Analysis and Tests.
 */
export const FIRST_RUN_SOURCE = helloExample;

/** The example `search` names: `null` without the parameter, `{ id }` alone for an unknown id. */
export function exampleFromSearch(search: string): { id: string; example?: Example } | null {
  const id = new URLSearchParams(search).get(EXAMPLE_PARAM);
  if (id === null) return null;
  const example = examples.find((e) => e.id === id);
  return example ? { id, example } : { id };
}

/** The editor's address for an example, with the way to the editor in front (`./` from the editor itself). */
export function exampleHref(id: string, appPath = './'): string {
  return `${appPath}?${EXAMPLE_PARAM}=${encodeURIComponent(id)}`;
}

/** `search` without the example parameter (`?` included when anything is left), for the address bar once the example is open. */
export function withoutExample(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(EXAMPLE_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}
