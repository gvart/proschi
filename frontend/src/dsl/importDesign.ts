import { componentCatalog, findTech, type CatalogEntry } from '../catalog/componentCatalog';
import { format } from './format';
import { kindFromName, kindOf } from './kinds';
import { bracketDepth } from './lexer';
import { parseSize } from './parser';
import type { Kind } from './types';

/**
 * What the importers (importMermaid.ts, importOpenApi.ts) build: a small
 * model of a Proschi document, written out as formatted source. Pure, shared
 * by the web editor's Import dialog and `proschi import`.
 */

/** A problem met while importing; the import still produces a document. */
export interface ImportWarning {
  /** 1-based line in the imported text, when the problem has one. */
  line?: number;
  message: string;
}

export interface ImportResult {
  /** Proschi source, in canonical format. */
  source: string;
  warnings: ImportWarning[];
}

export interface DesignNode {
  id: string;
  name: string;
  /** A tech stack; ignored for groups. */
  tech: string;
  description?: string;
  parent?: string;
  group?: boolean;
}

export interface DesignEdge {
  from: string;
  to: string;
  label?: string;
}

export type DesignArrow = '->' | '->>' | '-->' | '-x';

export type DesignStep =
  | { kind: 'step'; from: string; arrow: DesignArrow; to: string; label?: string }
  | { kind: 'par'; steps: DesignStep[] }
  | { kind: 'alt'; branches: { name: string; when?: string; steps: DesignStep[] }[] };

export interface DesignUseCase {
  name: string;
  description?: string;
  steps: DesignStep[];
}

export interface Design {
  title?: string;
  summary?: string;
  /** Nodes and groups, in the order they are written. */
  nodes: DesignNode[];
  edges: DesignEdge[];
  useCases: DesignUseCase[];
}

/** A Proschi string literal. */
export function quote(text: string): string {
  return `"${text.replace(/\s*\r?\n\s*/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"').trim()}"`;
}

// Words the parser reads as keywords where an id could stand.
const KEYWORDS = new Set(['title', 'import', 'group', 'usecase', 'par', 'alt', 'when', 'in', 'traffic', 'requirements', 'capacity', 'entity', 'decision', 'test', 'pos']);

/**
 * Maps foreign ids (Mermaid ids, participant names) to valid, unique Proschi
 * ids: letters, digits and `_`, not starting with a digit, never a keyword.
 */
export function idAllocator(): (raw: string) => string {
  const ids = new Map<string, string>();
  const taken = new Set<string>();
  return (raw) => {
    const known = ids.get(raw);
    if (known) return known;
    let id = raw
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!id) id = 'node';
    if (/^\d/.test(id)) id = `n${id}`;
    if (KEYWORDS.has(id.toLowerCase())) id = `${id}_`;
    let unique = id;
    for (let i = 2; taken.has(unique.toLowerCase()); i++) unique = `${id}${i}`;
    ids.set(raw, unique);
    taken.add(unique.toLowerCase());
    return unique;
  };
}

/** The generic tech of each kind: what a node gets when only its kind is known. */
export const GENERIC_TECH: Record<Kind, string> = {
  client: 'Actor',
  edge: 'WAF',
  cdn: 'CDN',
  loadbalancer: 'Load Balancer',
  gateway: 'API Gateway',
  dns: 'DNS',
  service: 'Service',
  function: 'Function',
  cache: 'Cache',
  database: 'Database',
  search: 'Search Engine',
  analytics: 'Data Warehouse',
  queue: 'Message Queue',
  storage: 'Object Storage',
  external: 'Third Party API',
  other: 'Service',
};

const entryKind = (c: CatalogEntry): Kind => kindOf({ kind: 'component', type: c.type, techStack: c.techStack });
const isGeneric = (c: CatalogEntry) => c.category === 'Generic Components' || c.techStack === 'REST API';
const USER_WORDS = /\b(users?|clients?|customers?|browsers?|mobile|person|people|visitors?|admins?|end.?users?)\b/i;

/**
 * A tech stack for a node known only by its label: a catalog tech the label
 * names (`Orders DB (Postgres)` → PostgreSQL, `Search Service` → Service: the
 * last word wins unless a product of the same kind is named, as in
 * `Redis Cache`), else the kind its words suggest (`Billing Store` →
 * Database), else a user or client (Actor), else `fallback`.
 */
export function techFromLabel(label: string, fallback = 'Service'): string {
  const words = label.split(/[\s()[\]{},:;|"'`]+/).filter(Boolean);
  const matches: { entry: CatalogEntry; end: number; length: number }[] = [];
  for (let n = Math.min(3, words.length); n >= 1; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const entry = findTech(words.slice(i, i + n).join(' '));
      // Shapes (Actor, Cylinder…), groups and notes say nothing about what a node does.
      if (!entry || entry.type === 'shape' || entry.type === 'group' || entry.type === 'text') continue;
      matches.push({ entry, end: i + n, length: n });
    }
  }
  if (matches.length) {
    const products = matches.filter((m) => !isGeneric(m.entry));
    const head = matches.filter((m) => m.end === words.length).sort((a, b) => b.length - a.length)[0];
    if (head) {
      const sameKind = isGeneric(head.entry) && products.find((p) => entryKind(p.entry) === entryKind(head.entry));
      return (sameKind || head).entry.techStack;
    }
    return (products[0] ?? matches[0]).entry.techStack;
  }
  const kind = kindFromName(label);
  if (kind) return GENERIC_TECH[kind];
  if (USER_WORDS.test(label)) return 'Actor';
  return fallback;
}

/** Every generic tech is in the catalog (importDesign.test.ts). */
export const genericTechsKnown = () => Object.values(GENERIC_TECH).every((t) => componentCatalog.some((c) => c.techStack === t));

function nodeLine(node: DesignNode): string {
  const parts = [node.id];
  if (node.group) {
    parts.unshift('group');
    if (node.name !== node.id) parts.push(quote(node.name));
    return `${parts.join(' ')} {`;
  }
  if (node.name !== node.id || node.tech === 'Text Note') parts.push(quote(node.name));
  parts.push(`[${node.tech}]`);
  if (node.description) parts.push(quote(node.description));
  return parts.join(' ');
}

function stepLines(steps: DesignStep[], indent: string, out: string[]) {
  for (const step of steps) {
    if (step.kind === 'step') {
      out.push(`${indent}${step.from} ${step.arrow} ${step.to}${step.label ? ` : ${step.label}` : ''}`);
    } else if (step.kind === 'par') {
      out.push(`${indent}par {`);
      stepLines(step.steps, `${indent}  `, out);
      out.push(`${indent}}`);
    } else {
      step.branches.forEach((branch, i) => {
        out.push(`${indent}${i === 0 ? '' : '} '}alt ${quote(branch.name)}${branch.when ? ` when ${quote(branch.when)}` : ''} {`);
        stepLines(branch.steps, `${indent}  `, out);
      });
      out.push(`${indent}}`);
    }
  }
}

/** Writes a design as Proschi source, formatted like `proschi fmt`. */
export function renderDesign(design: Design): string {
  const out: string[] = [];
  if (design.title) out.push(`title ${quote(design.title)}${design.summary ? ` ${quote(design.summary)}` : ''}`, '');

  const ids = new Set(design.nodes.map((n) => n.id));
  const children = new Map<string | undefined, DesignNode[]>();
  for (const node of design.nodes) {
    const parent = node.parent && ids.has(node.parent) ? node.parent : undefined;
    children.set(parent, [...(children.get(parent) ?? []), node]);
  }
  const write = (parent: string | undefined, indent: string) => {
    for (const node of children.get(parent) ?? []) {
      out.push(indent + nodeLine(node));
      if (node.group) {
        write(node.id, `${indent}  `);
        out.push(`${indent}}`);
      }
    }
  };
  write(undefined, '');

  if (design.edges.length) out.push('');
  for (const edge of design.edges) out.push(`${edge.from} -> ${edge.to}${edge.label ? ` : ${edge.label}` : ''}`);

  for (const useCase of design.useCases) {
    out.push('', `usecase ${quote(useCase.name)}${useCase.description ? ` ${quote(useCase.description)}` : ''} {`);
    stepLines(useCase.steps, '  ', out);
    out.push('}');
  }
  return format(`${out.join('\n')}\n`);
}

/**
 * Makes free text safe as a connection or step label: one line, no `#`
 * comment starts, no prefix the parser would misread (`~size`, `x0`).
 */
export function plainLabel(text: string): string {
  let label = text.replace(/(^|\s)#+/g, '$1').replace(/\s+/g, ' ').trim();
  const size = /^~(\S*)\s*/.exec(label);
  if (size && 'error' in parseSize(size[1])) label = label.slice(size[0].length);
  return label.replace(/^x0+\b\s*/, '');
}

const HTTP_START = /^(?:(?:x\d+|~\S+)\s+)*(?:(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\S+\s*)?/;

/**
 * A step label from free text: `plainLabel`, and a payload (`{…}`, `[…]`,
 * `<…>`) that does not close on the line is cut, since the parser would read
 * the following lines into it. `cut` says whether that happened.
 */
export function stepLabel(text: string): { label: string; cut: boolean } {
  const label = plainLabel(text);
  const start = HTTP_START.exec(label)?.[0].length ?? 0;
  const at = label.slice(start).search(/[{[<]/);
  if (at < 0) return { label, cut: false };
  const payload = label.slice(start + at);
  const closed = payload[0] === '<' ? payload.endsWith('>') : bracketDepth(payload) === 0 && balancedQuotes(payload);
  return closed ? { label, cut: false } : { label: label.slice(0, start + at).trim(), cut: true };
}

/** Whether the double quotes of a JSON-ish payload pair up (backslash escapes aside). */
function balancedQuotes(text: string): boolean {
  return (text.replace(/\\./g, '').match(/"/g)?.length ?? 0) % 2 === 0;
}
