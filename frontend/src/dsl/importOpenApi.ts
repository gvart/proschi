import { renderDesign, type DesignStep, type DesignUseCase, type ImportResult, type ImportWarning } from './importDesign';

/**
 * OpenAPI to Proschi: a starter design with a client, the API and a use case
 * per operation (`client -> api : GET /orders/{id}`, answered with its main
 * status code). With more than `MAX_USE_CASES` operations, a use case per tag
 * holds one `alt` branch per operation. Pure: the caller parses the text
 * (`openApiFromText` takes a YAML parser, so the web editor loads one only
 * for YAML). Shared by the editor's Import dialog and `proschi import`.
 */

export const MAX_USE_CASES = 20;
/** The parser keeps at most 32 scenarios per use case. */
const MAX_BRANCHES = 32;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Methods in the order OpenAPI lists them; `trace` is not an HTTP method a step can carry. */
const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch'] as const;

/** The path part of `servers[0].url`, with `{variables}` replaced by their defaults (also used by `proschi check`). */
export function serverPrefix(servers: unknown): string {
  const server = Array.isArray(servers) ? servers[0] : undefined;
  if (!isObject(server) || typeof server.url !== 'string') return '';
  const vars = isObject(server.variables) ? server.variables : {};
  const url = server.url.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const v = vars[name];
    return isObject(v) && v.default !== undefined ? String(v.default) : '';
  });
  const path = url.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]*(\/.*)?$/i)?.[1] ?? (url.startsWith('/') ? url : '');
  return path.replace(/[?#].*$/, '').replace(/\/+$/, '');
}

interface Operation {
  method: string;
  path: string;
  name: string;
  description?: string;
  status?: string;
  tag: string;
}

/** The status a use case answers with: the first 2xx, else the first documented code; none for `default` only. */
function mainStatus(responses: unknown): string | undefined {
  if (!isObject(responses)) return undefined;
  const keys = Object.keys(responses);
  const exact = keys.filter((k) => /^\d{3}$/.test(k)).sort();
  const ok = exact.find((k) => k.startsWith('2'));
  if (ok) return ok;
  const range = keys.find((k) => /^2xx$/i.test(k));
  if (range) return '200';
  return exact[0];
}

/** First line, cut to `max` characters. */
function firstLine(text: unknown, max = 160): string | undefined {
  if (typeof text !== 'string') return undefined;
  const line = text.trim().split(/\r?\n\s*\r?\n|\r?\n/)[0].replace(/\s+/g, ' ').trim();
  if (!line) return undefined;
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

function operations(doc: Json, prefix: string, warn: (message: string) => void): Operation[] {
  const out: Operation[] = [];
  if (!isObject(doc.paths)) return out;
  let traces = 0;
  for (const [path, item] of Object.entries(doc.paths)) {
    if (!isObject(item)) continue;
    if (typeof item.$ref === 'string') {
      warn(`Path '${path}' is a $ref; left out`);
      continue;
    }
    if (isObject(item.trace)) traces++;
    for (const method of METHODS) {
      const op = item[method];
      if (!isObject(op)) continue;
      const fullPath = `${prefix}${path}`.replace(/\s/g, '%20');
      const tags = Array.isArray(op.tags) ? op.tags.filter((t): t is string => typeof t === 'string') : [];
      out.push({
        method: method.toUpperCase(),
        path: fullPath,
        name: firstLine(op.summary, 80) ?? (typeof op.operationId === 'string' ? op.operationId : `${method.toUpperCase()} ${fullPath}`),
        description: firstLine(op.description),
        status: mainStatus(op.responses),
        tag: tags[0] ?? 'Other',
      });
    }
  }
  if (traces) warn(`${traces} TRACE operation(s) left out`);
  return out;
}

const steps = (op: Operation): DesignStep[] => [
  { kind: 'step', from: 'client', arrow: '->', to: 'api', label: `${op.method} ${op.path}` },
  { kind: 'step', from: 'api', arrow: '-->', to: 'client', ...(op.status ? { label: op.status } : {}) },
];

/** Converts a parsed OpenAPI 3 (or Swagger 2.0) document to a Proschi starter design. */
export function fromOpenApi(doc: unknown): ImportResult {
  const warnings: ImportWarning[] = [];
  const warn = (message: string) => warnings.push({ message });
  if (!isObject(doc)) {
    warn('Not an OpenAPI document: expected an object with openapi and paths');
    return { source: renderDesign({ title: 'Imported API', nodes: [], edges: [], useCases: [] }), warnings };
  }
  const version = String(doc.openapi ?? '');
  let prefix = serverPrefix(doc.servers);
  if (doc.swagger) {
    warn('Swagger 2.0: the paths are imported, but proschi check needs OpenAPI 3; convert the spec to check steps against it');
    prefix = typeof doc.basePath === 'string' ? doc.basePath.replace(/\/+$/, '') : '';
  } else if (!/^3\./.test(version)) {
    warn('No openapi: 3.x field; reading it as OpenAPI 3 anyway');
  }
  if (isObject(doc.webhooks) && Object.keys(doc.webhooks).length) warn('Webhooks are not imported');

  const info = isObject(doc.info) ? doc.info : {};
  const title = firstLine(info.title, 80) ?? 'Imported API';
  const ops = operations(doc, prefix, warn);
  if (!ops.length) warn('The spec has no operations under paths');

  let useCases: DesignUseCase[];
  if (ops.length <= MAX_USE_CASES) {
    useCases = ops.map((op) => ({ name: op.name, ...(op.description ? { description: op.description } : {}), steps: steps(op) }));
  } else {
    const tagDescriptions = new Map(
      (Array.isArray(doc.tags) ? doc.tags : []).filter(isObject).map((t) => [String(t.name), firstLine(t.description)] as const),
    );
    const byTag = new Map<string, Operation[]>();
    for (const op of ops) byTag.set(op.tag, [...(byTag.get(op.tag) ?? []), op]);
    const tags = [...byTag.keys()];
    if (tags.length > MAX_USE_CASES) warn(`${ops.length} operations in ${tags.length} tags: only the first ${MAX_USE_CASES} tags are imported`);
    useCases = tags.slice(0, MAX_USE_CASES).map((tag) => {
      const tagged = byTag.get(tag)!;
      if (tagged.length > MAX_BRANCHES) warn(`Tag '${tag}' has ${tagged.length} operations: only the first ${MAX_BRANCHES} are imported`);
      const names = new Set<string>();
      const branches = tagged.slice(0, MAX_BRANCHES).map((op) => {
        let name = op.name;
        for (let n = 2; names.has(name); n++) name = `${op.name} ${n}`;
        names.add(name);
        return { name, steps: steps(op) };
      });
      const description = tagDescriptions.get(tag);
      return { name: tag, ...(description ? { description } : {}), steps: tagged.length === 1 ? branches[0].steps : [{ kind: 'alt', branches }] };
    });
    warn(`${ops.length} operations: grouped into one use case per tag, with a scenario per operation`);
  }

  const source = renderDesign({
    title,
    summary: firstLine(info.summary) ?? firstLine(info.description),
    nodes: [
      { id: 'client', name: 'Client', tech: 'Actor' },
      { id: 'api', name: title, tech: 'REST API', ...(typeof info.version === 'string' ? { description: `Version ${info.version}` } : {}) },
    ],
    edges: [{ from: 'client', to: 'api', label: 'HTTPS' }],
    useCases,
  });
  return { source, warnings };
}

/**
 * Parses spec text (JSON, or YAML with `parseYaml`) and converts it. A text
 * that cannot be parsed gives an empty design and a warning.
 */
export function openApiFromText(text: string, parseYaml?: (text: string) => unknown): ImportResult {
  let doc: unknown;
  try {
    doc = /^\s*[{[]/.test(text) || !parseYaml ? JSON.parse(text) : parseYaml(text);
  } catch (e) {
    return { source: renderDesign({ title: 'Imported API', nodes: [], edges: [], useCases: [] }), warnings: [{ message: `Could not read the spec: ${(e as Error).message}` }] };
  }
  return fromOpenApi(doc);
}
