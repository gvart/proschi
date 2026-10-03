/**
 * Path templates: endpoints may name variable segments, as in
 * `GET /orders/{id}`. These helpers decide which concrete calls such as
 * `GET /orders/42` belong to the same endpoint.
 */

const PARAM = /^\{[^{}/]+\}$/;
const ID_SEGMENT = /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function segments(path: string): string[] {
  // A query string is not part of the path.
  return path.split('?')[0].split('/');
}

/** True when the path (or `METHOD /path`) has a `{param}` segment. */
export function isTemplate(path: string): boolean {
  return segments(path).some((s) => PARAM.test(s));
}

/** Whether a path matches a template; `{x}` matches exactly one non-empty segment. */
export function matchesTemplate(template: string, path: string): boolean {
  const t = segments(template);
  const p = segments(path);
  return t.length === p.length && t.every((seg, i) => (PARAM.test(seg) ? p[i] !== '' : seg === p[i]));
}

/** Replaces segments that are all digits or a UUID with `{id}`. */
export function templatize(path: string): string {
  return segments(path)
    .map((s) => (ID_SEGMENT.test(s) ? '{id}' : s))
    .join('/');
}

function split(endpoint: string): { method: string; path: string } {
  const space = endpoint.indexOf(' ');
  return space === -1 ? { method: '', path: endpoint } : { method: endpoint.slice(0, space), path: endpoint.slice(space + 1) };
}

/**
 * The grouping key of an endpoint (`METHOD /path`), given every endpoint in the
 * document: the endpoint itself if it is a template; else a template endpoint
 * with the same method that matches it; else the path with ids folded to `{id}`.
 */
export function endpointGroupKey(endpoint: string, all: readonly string[]): string {
  if (isTemplate(endpoint)) return endpoint;
  const { method, path } = split(endpoint);
  const template = all.find((other) => {
    const o = split(other);
    return o.method === method && isTemplate(o.path) && matchesTemplate(o.path, path);
  });
  if (template) return template;
  return method ? `${method} ${templatize(path)}` : templatize(path);
}
