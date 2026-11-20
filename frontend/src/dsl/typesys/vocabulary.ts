import { HTTP_METHODS, builtinTypes } from '../parser';
import type { Diagram } from '../types';
import { typeKey } from './resolve';
import type { OpAccess, ResolvedType, TypeTable } from './types';

/**
 * What a use case step between two components may say, read from the
 * components' types (docs/TYPES.md): the operations of the type it goes to,
 * the statuses of the type that answers, the headers it accepts and the
 * protocol it speaks. The Flows builder offers these, and so does the code
 * editor's completion, so neither offers a label the language would warn on.
 */

export type VocabularyKind = 'request' | 'response' | 'async' | 'failed';

export interface VocabularyOp {
  name: string;
  access: OpAccess;
  /** The type that declares it: the component's own type, or the ancestor it inherits it from. */
  from: string;
}

export interface StepVocabulary {
  /** The type the step's label is checked against: the target's, or on a response the responder's. Absent for an untyped component. */
  type?: ResolvedType;
  /** The type's operations, its own first, then each ancestor's. Empty for a response, or a type that takes any label. */
  ops: VocabularyOp[];
  /** The statuses the responder answers with, on a response; empty when it lists none (any status is fine). */
  statuses: number[];
  /** Headers the target accepts on an HTTP request; empty when it lists none. */
  headers: string[];
  protocol?: string;
  /** True when the type speaks HTTP, so a request names a method and a path (`GET /orders/{id}`). */
  http: boolean;
  /** HTTP methods to start a label with, for an HTTP type that lists no operations of its own (any label is fine there). */
  methods: string[];
  /** Labels the document already uses for steps of this kind between these components' types, most used first. */
  used: string[];
}

/** A step already in the document, as the builder reads it (dsl/edit.ts `OutlineStep`). */
export interface UsedStep {
  from: string;
  to: string;
  kind: VocabularyKind;
  label: string;
}

/** The built-in types with the document's own over them. */
export function typeTableOf(diagram: Diagram): TypeTable {
  const table = new Map(builtinTypes());
  for (const t of diagram.types ?? []) table.set(typeKey(t.name), t);
  return table;
}

/** `type`'s operations, own first, each with the type that declares it. */
export function opsMostSpecificFirst(type: ResolvedType, table: TypeTable): VocabularyOp[] {
  const chain = [type, ...type.parents.flatMap((p) => table.get(typeKey(p)) ?? [])];
  const seen = new Set<string>();
  const ops: VocabularyOp[] = [];
  chain.forEach((t, i) => {
    const parent = chain[i + 1];
    for (const op of t.ops) {
      const key = op.name.toLowerCase();
      if (seen.has(key) || parent?.ops.some((o) => o.name.toLowerCase() === key)) continue;
      seen.add(key);
      // The resolved type's own entry: a redeclared op keeps its latest access.
      const own = type.ops.find((o) => o.name.toLowerCase() === key) ?? op;
      ops.push({ name: own.name, access: own.access, from: t.name });
    }
  });
  return ops;
}

/**
 * What a `kind` step from `from` to `to` may say. `used` are the document's
 * steps (any use case), for the labels already written between components of
 * the same types: the only suggestions for a type without operations.
 */
export function stepVocabulary(diagram: Diagram, from: string, to: string, kind: VocabularyKind, used: readonly UsedStep[] = [], table: TypeTable = typeTableOf(diagram)): StepVocabulary {
  const node = (id: string) => diagram.nodes.find((n) => n.id === id);
  const responder = kind === 'response';
  const type = node(responder ? from : to)?.resolvedType;
  const connection = diagram.edges.find((e) => e.source === (responder ? to : from) && e.target === (responder ? from : to));
  const protocol = type?.protocol ?? (connection?.label || undefined);
  const typeName = (id: string) => node(id)?.resolvedType?.name ?? id;
  const counts = new Map<string, number>();
  for (const s of used) {
    if (s.kind !== kind || !s.label.trim()) continue;
    if (typeName(s.from) !== typeName(from) || typeName(s.to) !== typeName(to)) continue;
    counts.set(s.label.trim(), (counts.get(s.label.trim()) ?? 0) + 1);
  }
  const http = protocol?.toUpperCase() === 'HTTP' || protocol?.toUpperCase() === 'HTTPS';
  const ops = type && !responder ? opsMostSpecificFirst(type, table) : [];
  return {
    type,
    ops,
    statuses: type && responder ? [...type.statuses] : [],
    headers: type && !responder ? [...type.headers] : [],
    protocol,
    http,
    methods: http && !responder && ops.length === 0 ? [...HTTP_METHODS] : [],
    used: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label]) => label),
  };
}

/**
 * The start of a label that names `op`: an HTTP method on an HTTP type takes
 * a path next (`GET /`), a name with spaces or symbols goes in quotes.
 */
export function opLabel(op: string, vocabulary: Pick<StepVocabulary, 'http'>): string {
  const name = /^[A-Za-z_][A-Za-z0-9_]*$/.test(op) ? op : `"${op}"`;
  return vocabulary.http && HTTP_METHODS.includes(op.toUpperCase()) ? `${name} /` : `${name} `;
}
