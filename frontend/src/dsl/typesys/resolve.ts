import { editDistance, findTech, suggestTech, techKey } from '../../catalog/componentCatalog';
import { kindOf } from '../kinds';
import type { Diagnostic, SourceLoc } from '../types';
import { ROOT_TYPE, type ResolvedType, type TypeDecl, type TypeOp, type TypeTable } from './types';

/** The key a type is found by: like tech stacks, ignoring case, spaces and punctuation. */
export const typeKey = techKey;

/**
 * The type `[name]` on a node refers to: a declared type of that name; else,
 * when the catalog knows the name, the type of that tech (`[Postgres]` is
 * the `PostgreSQL` type, and `[SQL Database]`, an alias of `Database`,
 * stays `Database` although a built-in `SqlDatabase` exists); else a
 * built-in type of that name. So a built-in type never changes what a
 * catalog name means (D6).
 */
export function lookupType(table: TypeTable, name: string): ResolvedType | undefined {
  const own = table.get(typeKey(name));
  if (own && !own.builtin) return own;
  const tech = findTech(name);
  return tech ? table.get(typeKey(tech.techStack)) : own;
}

/** The catalog tech a type is named after: same name, not just an alias of it. */
export function techNamed(name: string): string | undefined {
  const tech = findTech(name);
  return tech && typeKey(tech.techStack) === typeKey(name) ? tech.techStack : undefined;
}

export interface TypeResolution {
  /** `base` plus every type of `decls` that resolved. */
  table: TypeTable;
  /** The types of `decls`, in order (duplicates left out). */
  types: ResolvedType[];
  diagnostics: Diagnostic[];
}

/**
 * Merges each declaration with its ancestors (D3): props and single values
 * are inherited unless the type sets its own; ops, statuses and headers add
 * up. `base` holds types already resolved (the stdlib), which `decls` may
 * extend but not redeclare. Never throws: an unknown parent or a cycle is
 * reported and the type is resolved as if it extended `Component`.
 */
export function resolveTypes(decls: readonly TypeDecl[], base: TypeTable = new Map()): TypeResolution {
  const diagnostics: Diagnostic[] = [];
  const error = (message: string, loc: SourceLoc) => diagnostics.push({ severity: 'error', message, ...loc });
  const warning = (message: string, loc: SourceLoc) => diagnostics.push({ severity: 'warning', message, ...loc });

  const byKey = new Map<string, TypeDecl>();
  const order: TypeDecl[] = [];
  for (const decl of decls) {
    const key = typeKey(decl.name);
    const builtin = base.get(key);
    const first = byKey.get(key);
    if (builtin) error(`Type '${decl.name}' is built in${builtin.name === decl.name ? '' : ` as '${builtin.name}'`}; extend it under another name`, decl.loc);
    else if (first) error(`Duplicate type '${decl.name}' (first declared ${where(first.loc, decl.loc)})`, decl.loc);
    else {
      byKey.set(key, decl);
      order.push(decl);
    }
  }

  const table = new Map(base);
  const resolving: TypeDecl[] = [];
  /** Types whose chain is broken (an unknown parent or a cycle): their missing kind is not reported again. */
  const broken = new Set<string>();

  const resolve = (decl: TypeDecl): ResolvedType => {
    const key = typeKey(decl.name);
    // Declarations never share a key with `base` (that is the built-in error above).
    const done = table.get(key);
    if (done) return done;

    let parent: ResolvedType | undefined;
    const parentName = decl.parent ?? (typeKey(decl.name) === typeKey(ROOT_TYPE) ? undefined : ROOT_TYPE);
    if (parentName !== undefined) {
      const parentKey = typeKey(parentName);
      const parentDecl = byKey.get(parentKey);
      const cycleStart = !parentDecl ? -1 : parentDecl === decl ? resolving.length : resolving.indexOf(parentDecl);
      if (cycleStart !== -1) {
        const names = [...resolving.slice(cycleStart), decl, parentDecl!].map((d) => d.name);
        error(`Type cycle: ${names.join(' → ')}`, decl.parentLoc ?? decl.loc);
        parent = table.get(typeKey(ROOT_TYPE));
        broken.add(key);
      } else if (parentDecl) {
        resolving.push(decl);
        parent = resolve(parentDecl);
        resolving.pop();
        if (broken.has(parentKey)) broken.add(key);
      } else {
        // `extends` names a type exactly, then by catalog alias (`extends Postgres`), then any catalog tech.
        parent = base.get(parentKey) ?? lookupType(base, parentName) ?? catalogType(parentName, table);
        if (!parent) {
          broken.add(key);
          const suggestion = suggestType(parentName, [...table.values()].map((t) => t.name).concat([...byKey.values()].map((d) => d.name)));
          error(`Unknown parent type '${parentName}'${suggestion ? `. Did you mean '${suggestion}'?` : ''}`, decl.parentLoc ?? decl.loc);
          parent = table.get(typeKey(ROOT_TYPE));
        }
      }
    }

    let icon = decl.icon;
    if (icon !== undefined) {
      const tech = findTech(icon);
      if (!tech) {
        const suggestion = suggestTech(icon);
        warning(`Unknown icon '${icon}'${suggestion ? ` (did you mean '${suggestion}'?)` : ''}; the type keeps its inherited icon`, decl.loc);
      }
      icon = tech?.techStack;
    }
    // A built-in type named after a catalog tech is drawn as that tech.
    if (icon === undefined && decl.builtin) icon = techNamed(decl.name);
    const shadowed = decl.builtin ? undefined : findTech(decl.name);
    if (shadowed) warning(`Type '${decl.name}' has the name of the catalog tech '${shadowed.techStack}'; [${decl.name}] now means this type`, decl.loc);
    icon ??= parent?.icon;

    const kind = decl.kind ?? parent?.kind;
    if (!decl.abstract && !kind && !broken.has(key)) error(`Type '${decl.name}' needs a kind: declare one (kind database) or extend a type that has one`, decl.loc);

    // An own op replaces the inherited op of that name, ignoring case as step labels do.
    const ownOps = new Set(decl.ops.map((o) => o.name.toLowerCase()));
    const resolved: ResolvedType = {
      name: decl.name,
      abstract: decl.abstract,
      builtin: decl.builtin,
      parents: parent ? [parent.name, ...parent.parents] : [],
      ...(kind ? { kind } : {}),
      props: { ...parent?.props, ...decl.props },
      ops: [...(parent?.ops.filter((o) => !ownOps.has(o.name.toLowerCase())) ?? []), ...decl.ops].map((o): TypeOp => ({ ...o })),
      statuses: union(parent?.statuses ?? [], decl.statuses),
      headers: union(parent?.headers ?? [], decl.headers, (h) => h.toLowerCase()),
      ...pick('protocol', decl.protocol ?? parent?.protocol),
      ...pick('icon', icon),
      ...pick('doc', decl.doc ?? parent?.doc),
      loc: decl.loc,
    };
    table.set(key, resolved);
    return resolved;
  };

  const types = order.map(resolve);
  return { table, types, diagnostics };
}

/**
 * A catalog tech the stdlib has no type for yet, as a type to extend: its
 * catalog kind and icon, right under `Component`. Nodes of the tech itself
 * get no type from this; it only lets `extends DynamoDB` work today.
 */
function catalogType(name: string, table: TypeTable): ResolvedType | undefined {
  const tech = findTech(name);
  if (!tech) return undefined;
  const root = table.get(typeKey(ROOT_TYPE));
  return {
    name: tech.techStack,
    abstract: false,
    builtin: true,
    parents: root ? [root.name, ...root.parents] : [],
    kind: kindOf({ kind: 'component', type: tech.type, techStack: tech.techStack }),
    props: {},
    ops: [],
    statuses: [],
    headers: [],
    icon: tech.techStack,
    loc: { line: 1, col: 1, length: 0, file: 'catalog' },
  };
}

function pick<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}

function union<T>(inherited: readonly T[], own: readonly T[], key: (v: T) => unknown = (v) => v): T[] {
  const seen = new Set(inherited.map(key));
  return [...inherited, ...own.filter((v) => !seen.has(key(v)) && seen.add(key(v)))];
}

function where(first: SourceLoc, later: SourceLoc): string {
  return first.file === later.file ? `on line ${first.line}` : `in ${first.file ?? 'the root document'} on line ${first.line}`;
}

/** The closest type name, when it is close enough to be a typo. */
function suggestType(name: string, names: string[]): string | undefined {
  const key = typeKey(name);
  let best: string | undefined;
  let bestDistance = Math.max(2, Math.floor(key.length / 3)) + 1;
  for (const candidate of names) {
    const d = editDistance(key, typeKey(candidate));
    if (d < bestDistance) [best, bestDistance] = [candidate, d];
  }
  return best;
}
