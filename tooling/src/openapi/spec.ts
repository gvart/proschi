/**
 * Loading OpenAPI 3.x documents (YAML or JSON) and validating payloads
 * against their schemas.
 */
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import { parse as parseYaml } from 'yaml';
import { serverPrefix } from '../../../frontend/src/dsl/importOpenApi';

type Json = Record<string, unknown>;

export const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

export interface Operation {
  /** The path template as written in the spec, e.g. `/orders/{orderId}`. */
  path: string;
  method: string;
  /** JSON pointer of the operation inside the document. */
  pointer: string;
  value: Json;
}

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Escapes one JSON pointer segment. */
const esc = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');

export class OpenApiSpec {
  /** The file name, for messages. */
  readonly name: string;
  /** Path prefix from `servers[0].url`, e.g. `/v1`; empty when there is none. */
  readonly prefix: string;
  private readonly doc: Json;
  private readonly ajv: Ajv2020;
  private readonly validators = new Map<string, ValidateFunction | null>();

  constructor(
    readonly file: string,
    doc: Json,
  ) {
    this.name = basename(file);
    const version = String(doc.openapi ?? '');
    if (!/^3\./.test(version)) {
      throw new Error(doc.swagger ? 'Swagger 2.0 is not supported; convert it to OpenAPI 3' : 'not an OpenAPI 3 document (no openapi: 3.x field)');
    }
    // 3.0 schemas are a dialect of draft 4; rewrite them as JSON Schema 2020-12, which 3.1 already is.
    this.doc = version.startsWith('3.0') ? (from30(structuredClone(doc)) as Json) : doc;
    this.prefix = serverPrefix(this.doc.servers);
    this.ajv = new Ajv2020({ strict: false, allErrors: true, validateSchema: false, validateFormats: false });
    this.ajv.addSchema(this.doc, 'openapi:spec');
  }

  /** Path templates the spec documents. */
  get templates(): string[] {
    return isObject(this.doc.paths) ? Object.keys(this.doc.paths) : [];
  }

  /** Methods (upper case) documented for a path template. */
  methods(path: string): string[] {
    const item = this.resolve(`/paths/${esc(path)}`)?.value;
    return isObject(item) ? METHODS.filter((m) => isObject(item[m])).map((m) => m.toUpperCase()) : [];
  }

  operation(path: string, method: string): Operation | undefined {
    const item = this.resolve(`/paths/${esc(path)}`);
    if (!item || !isObject(item.value)) return undefined;
    const m = method.toLowerCase();
    const value = item.value[m];
    return isObject(value) ? { path, method: method.toUpperCase(), pointer: `${item.pointer}/${m}`, value } : undefined;
  }

  /** Documented response keys of an operation: `201`, `4XX`, `default`. */
  statuses(op: Operation): string[] {
    const responses = op.value.responses;
    return isObject(responses) ? Object.keys(responses) : [];
  }

  /** The response key that covers a status code: exact, then a `4XX` range, then `default`. */
  responseKey(op: Operation, status: number): string | undefined {
    const keys = this.statuses(op);
    return keys.find((k) => k === String(status)) ?? keys.find((k) => k.toUpperCase() === `${String(status)[0]}XX`) ?? keys.find((k) => k === 'default');
  }

  /** Validates a request body; undefined when the operation has no JSON schema for it. */
  validateRequest(op: Operation, body: unknown): string[] | undefined {
    const requestBody = this.resolve(`${op.pointer}/requestBody`);
    return requestBody && this.validateContent(requestBody.pointer, body);
  }

  validateResponse(op: Operation, key: string, body: unknown): string[] | undefined {
    const response = this.resolve(`${op.pointer}/responses/${esc(key)}`);
    return response && this.validateContent(response.pointer, body);
  }

  /** Validates against the `application/json` (or `+json`) schema of a request body or response object. */
  private validateContent(pointer: string, body: unknown): string[] | undefined {
    const owner = this.resolve(pointer)?.value;
    if (!isObject(owner) || !isObject(owner.content)) return undefined;
    const type = Object.keys(owner.content).find((t) => /^application\/([\w.-]+\+)?json\b/i.test(t));
    if (!type || !isObject(owner.content[type]) || !('schema' in owner.content[type])) return undefined;
    const schemaPointer = `${pointer}/content/${esc(type)}/schema`;
    let validate = this.validators.get(schemaPointer);
    if (validate === undefined) {
      try {
        validate = this.ajv.compile({ $ref: `openapi:spec#${schemaPointer}` });
      } catch {
        // A schema ajv cannot compile (e.g. a remote $ref) is not checked rather than reported.
        validate = null;
      }
      this.validators.set(schemaPointer, validate);
    }
    if (!validate) return undefined;
    return validate(body) ? [] : (validate.errors ?? []).map(describeError);
  }

  /** Follows local `$ref`s from the value at a JSON pointer; returns the final pointer and value. */
  private resolve(pointer: string): { pointer: string; value: unknown } | undefined {
    let value = this.at(pointer);
    for (let hops = 0; isObject(value) && typeof value.$ref === 'string' && hops < 20; hops++) {
      if (!value.$ref.startsWith('#')) return undefined;
      pointer = decodeURIComponent(value.$ref.slice(1));
      value = this.at(pointer);
    }
    return value === undefined ? undefined : { pointer, value };
  }

  private at(pointer: string): unknown {
    let value: unknown = this.doc;
    for (const raw of pointer.split('/').slice(1)) {
      const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
      if (Array.isArray(value)) value = value[Number(key)];
      else if (isObject(value)) value = value[key];
      else return undefined;
    }
    return value;
  }
}

function describeError(e: ErrorObject): string {
  const where = e.instancePath || '(root)';
  const p = e.params as Record<string, unknown>;
  let message = e.message ?? 'is invalid';
  if (e.keyword === 'additionalProperties' || e.keyword === 'unevaluatedProperties') message += ` ('${p.additionalProperty ?? p.unevaluatedProperty}')`;
  if (e.keyword === 'enum' && Array.isArray(p.allowedValues)) message += `: ${p.allowedValues.map((v) => JSON.stringify(v)).join(', ')}`;
  return `${where} ${message}`;
}

/**
 * Rewrites OpenAPI 3.0 schema keywords as JSON Schema 2020-12: `nullable`,
 * boolean `exclusiveMinimum`/`exclusiveMaximum`. Applied to the whole
 * document; neither keyword has a boolean value anywhere else in a spec.
 */
function from30(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(from30);
  if (!isObject(value)) return value;
  const out: Json = {};
  for (const [k, v] of Object.entries(value)) out[k] = from30(v);
  for (const [bool, bound] of [
    ['exclusiveMinimum', 'minimum'],
    ['exclusiveMaximum', 'maximum'],
  ] as const) {
    if (typeof out[bool] !== 'boolean') continue;
    if (out[bool] && typeof out[bound] === 'number') {
      out[bool] = out[bound];
      delete out[bound];
    } else delete out[bool];
  }
  if (typeof out.nullable === 'boolean') {
    const nullable = out.nullable;
    delete out.nullable;
    if (nullable) {
      if (typeof out.type === 'string' && !('$ref' in out)) {
        out.type = [out.type, 'null'];
        if (Array.isArray(out.enum) && !out.enum.includes(null)) out.enum = [...out.enum, null];
      } else return { anyOf: [out, { type: 'null' }] };
    }
  }
  return out;
}

/** Specs by file, re-read when the file's modification time changes. */
const cache = new Map<string, { mtimeMs: number; spec: OpenApiSpec }>();

/** Reads and parses a spec; throws an Error with a readable message on failure. */
export function loadSpec(file: string): OpenApiSpec {
  const { mtimeMs } = statSync(file);
  const cached = cache.get(file);
  if (cached?.mtimeMs === mtimeMs) return cached.spec;
  const text = readFileSync(file, 'utf8');
  const doc: unknown = file.endsWith('.json') ? JSON.parse(text) : parseYaml(text);
  if (!isObject(doc)) throw new Error('not an OpenAPI document');
  const spec = new OpenApiSpec(file, doc);
  cache.set(file, { mtimeMs, spec });
  return spec;
}
