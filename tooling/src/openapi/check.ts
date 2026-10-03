/**
 * Checks use case steps against the OpenAPI specs of their target nodes:
 * the endpoint exists, the status code is documented, and JSON payloads
 * match the schemas. Every finding is a warning, so `check --strict` turns
 * documentation drift into a CI failure.
 */
import { isAbsolute, relative } from 'node:path';
import type { Diagnostic, Diagram, DiagramStep, SourceLoc } from '../proschi';
import { closestTemplate, matchTemplates, normalizePath, stripPrefix } from './paths';
import { loadSpec, type OpenApiSpec, type Operation } from './spec';

/** The spec file of each node id that has one (absolute paths). */
export type SpecMap = Record<string, string>;

const MAX_SCHEMA_ERRORS = 3;

export function checkOpenApi(diagram: Diagram, specFiles: SpecMap): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const add = (severity: Diagnostic['severity'], message: string, loc: SourceLoc) => {
    // Steps shared by several scenarios appear once per scenario; report each problem once.
    if (!diagnostics.some((d) => d.message === message && d.line === loc.line && d.col === loc.col)) diagnostics.push({ severity, message, ...loc });
  };

  const specs = new Map<string, OpenApiSpec | null>();
  const specOf = (nodeId: string): OpenApiSpec | null => {
    if (specs.has(nodeId)) return specs.get(nodeId)!;
    let spec: OpenApiSpec | null = null;
    try {
      spec = loadSpec(specFiles[nodeId]);
    } catch (e) {
      const node = diagram.nodes.find((n) => n.id === nodeId)!;
      add('error', `Cannot read OpenAPI spec '${displayPath(specFiles[nodeId])}' for '${nodeId}': ${(e as Error).message}`, node.loc);
    }
    specs.set(nodeId, spec);
    return spec;
  };

  for (const useCase of diagram.useCases) {
    for (const scenario of useCase.scenarios) {
      for (const step of scenario.steps) {
        if (!step.httpMethod || !Object.hasOwn(specFiles, step.toServiceId)) continue;
        const spec = specOf(step.toServiceId);
        if (spec) checkStep(spec, step, (message, loc) => add('warning', message, loc));
      }
    }
  }
  return diagnostics.sort((a, b) => a.line - b.line || a.col - b.col);
}

function checkStep(spec: OpenApiSpec, step: DiagramStep, warn: (message: string, loc: SourceLoc) => void) {
  const call = `${step.httpMethod} ${step.endpoint}`;
  const path = normalizePath(step.endpoint);
  // The step may be written with or without the server's base path.
  const candidates = [path, stripPrefix(path, spec.prefix)].filter((p): p is string => p !== undefined);
  const templates = [...new Set(candidates.flatMap((p) => matchTemplates(spec.templates, p)))];

  if (templates.length === 0) {
    const shown = stripPrefix(path, spec.prefix) ?? path;
    const near = closestTemplate(spec.templates, shown);
    const nearMethod = near && (spec.methods(near).includes(step.httpMethod) ? step.httpMethod : spec.methods(near)[0]);
    const hint = near ? `; did you mean ${nearMethod ? `${nearMethod} ` : ''}${near}?` : '';
    warn(`${call}: '${spec.name}' has no path ${shown}${hint}`, step.loc);
    return;
  }

  let op: Operation | undefined;
  for (const t of templates) op ??= spec.operation(t, step.httpMethod);
  if (!op) {
    const documented = templates.flatMap((t) => spec.methods(t).map((m) => `${m} ${t}`));
    const hint = documented.length === 1 ? `; did you mean ${documented[0]}?` : documented.length ? ` (documented: ${documented.join(', ')})` : '';
    warn(`${call}: '${spec.name}' has no ${step.httpMethod} ${templates[0]}${hint}`, step.loc);
    return;
  }
  // A failed call never got an answer, and its request may never have been complete.
  if (step.failed) return;

  const label = `${op.method} ${op.path}`;
  const request = jsonBody(step.requestFormat, step.requestBody);
  if (request !== undefined) {
    const errors = spec.validateRequest(op, request.value);
    if (errors?.length) warn(`Request body does not match the schema of ${label}: ${summarize(errors)}`, step.loc);
  }

  if (step.statusCode === undefined) return;
  const responseLoc = step.responseLoc ?? step.loc;
  const key = spec.responseKey(op, step.statusCode);
  if (!key) {
    const documented = spec.statuses(op);
    warn(`Status ${step.statusCode} is not documented for ${label} (documented: ${documented.join(', ') || 'none'})`, responseLoc);
    return;
  }
  const response = jsonBody(step.responseFormat, step.responseBody);
  if (response !== undefined) {
    const errors = spec.validateResponse(op, key, response.value);
    if (errors?.length) warn(`${step.statusCode} response body does not match the schema of ${label}: ${summarize(errors)}`, responseLoc);
  }
}

function displayPath(file: string): string {
  const rel = relative(process.cwd(), file);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : file;
}

/** The parsed payload, or undefined when there is none or it is not (valid) JSON. */
function jsonBody(format: string, body: string | undefined): { value: unknown } | undefined {
  if (format !== 'JSON' || !body) return undefined;
  try {
    return { value: JSON.parse(body) };
  } catch {
    return undefined;
  }
}

function summarize(errors: string[]): string {
  const shown = errors.slice(0, MAX_SCHEMA_ERRORS).join('; ');
  return errors.length > MAX_SCHEMA_ERRORS ? `${shown} (and ${errors.length - MAX_SCHEMA_ERRORS} more)` : shown;
}
