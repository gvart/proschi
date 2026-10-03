/**
 * Matching the paths written in use case steps (`/orders/42`, `/orders/{id}`)
 * against OpenAPI path templates (`/orders/{orderId}`).
 */

/** Drops the query string, fragment, scheme and host, and a trailing slash. */
export function normalizePath(endpoint: string): string {
  let path = endpoint.trim().replace(/[?#].*$/, '');
  const absolute = path.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]*(\/.*)?$/i);
  if (absolute) path = absolute[1] ?? '/';
  if (!path.startsWith('/')) path = `/${path}`;
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

const PARAM = /^\{[^/{}]*\}$/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A template segment such as `{id}` or `{name}.json` as a regex over one concrete segment. */
function segmentPattern(segment: string): RegExp {
  const source = segment
    .split(/(\{[^/{}]*\})/)
    .map((part) => (PARAM.test(part) ? '[^/]+' : escapeRegExp(part)))
    .join('');
  return new RegExp(`^${source}$`);
}

/**
 * How well a concrete path matches a template: the number of literal
 * segments, or -1 for no match. A `{x}` placeholder in the step matches only
 * a parameter segment of the template, since it stands for any value.
 */
export function matchScore(template: string, path: string): number {
  const t = normalizePath(template).split('/');
  const p = path.split('/');
  if (t.length !== p.length) return -1;
  let literal = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === p[i]) {
      literal++;
      continue;
    }
    if (!t[i].includes('{')) return -1;
    if (PARAM.test(p[i])) {
      if (!PARAM.test(t[i])) return -1;
      continue;
    }
    if (!segmentPattern(t[i]).test(p[i])) return -1;
  }
  return literal;
}

/** Templates that match the path, best (most literal segments) first. */
export function matchTemplates(templates: string[], path: string): string[] {
  return templates
    .map((template) => ({ template, score: matchScore(template, path) }))
    .filter((m) => m.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((m) => m.template);
}

/** The path with the prefix (e.g. `/v1`) removed, or undefined when it does not start with it. */
export function stripPrefix(path: string, prefix: string): string | undefined {
  if (!prefix) return undefined;
  if (path === prefix) return '/';
  return path.startsWith(`${prefix}/`) ? path.slice(prefix.length) : undefined;
}

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

/** The template closest to a path that matches none, if one is close enough to be a likely typo. */
export function closestTemplate(templates: string[], path: string): string | undefined {
  // Compare shapes, so `/orders/42` is as close to `/orders/{orderId}` as `/orders/{id}` is.
  const shape = (p: string) => p.replace(/\{[^/{}]*\}/g, '{}');
  const segments = path.split('/');
  const target = shape(path);
  let best: { template: string; distance: number } | undefined;
  for (const template of templates) {
    const t = normalizePath(template).split('/');
    // Put the step's concrete values where the template has parameters, then compare.
    const filled = t.map((seg, i) => (seg.includes('{') && segments[i] !== undefined && !segments[i].includes('{') ? segments[i] : seg)).join('/');
    const distance = Math.min(levenshtein(filled, path), levenshtein(shape(template), target));
    if (!best || distance < best.distance) best = { template, distance };
  }
  return best && best.distance <= Math.max(2, Math.floor(path.length / 4)) ? best.template : undefined;
}
