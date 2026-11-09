import {
  ASSERTIONS,
  CAPACITY_PARTS,
  DID_YOU_MEAN,
  KEYWORDS,
  addConnection,
  componentCatalog,
  costBreakdown,
  findUseCase,
  formatAvailability,
  formatMs,
  formatPercent,
  formatTraffic,
  formatUsd,
  kindName,
  parse,
  requirementFixes,
  setCapacity,
  setReplicas,
  tokenizeLine,
  type Constant,
  type Diagnostic,
  type Diagram,
  type DiagramNode,
  type ParseOptions,
  type ParseResult,
  type SourceLoc,
} from './proschi';
import { nodeSimulation, resultsOf, simulationOf, verdict, whatIfsOf } from './simulation';

/** 0-based position, as LSP uses. */
export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

/** Parser locations are 1-based; LSP ranges are 0-based. */
export function toRange(loc: SourceLoc): Range {
  const start = { line: loc.line - 1, character: loc.col - 1 };
  return { start, end: { line: start.line, character: start.character + Math.max(loc.length, 1) } };
}

export interface Analysis {
  /** Everything the document and its imports declare. */
  diagram: Diagram;
  /** Problems in the document and in the files it imports (those carry `file`). */
  diagnostics: Diagnostic[];
  lines: string[];
  result: ParseResult;
}

export function analyze(text: string, options?: ParseOptions): Analysis {
  const result = parse(text, options);
  return { diagram: result.diagram, diagnostics: result.diagnostics, lines: text.split('\n'), result };
}

const IDENT = /[A-Za-z0-9_]/;

/** The identifier under (or just before) the cursor, with its 0-based column span. */
export function wordAt(line: string, character: number): { word: string; start: number; end: number } | null {
  let start = character;
  let end = character;
  while (start > 0 && IDENT.test(line[start - 1])) start--;
  while (end < line.length && IDENT.test(line[end])) end++;
  if (start === end || !/[A-Za-z_]/.test(line[start])) return null;
  return { word: line.slice(start, end), start, end };
}

/** True when the cursor is in a step or connection label, which is free text. */
function inLabel(before: string): boolean {
  let quoted = false;
  for (const ch of before) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ':' && !quoted) return true;
    else if (ch === '#' && !quoted) return false;
  }
  return false;
}

/** Whether a line belongs to a multi-line JSON payload rather than a statement. */
function insidePayload(lines: string[], line: number): boolean {
  return payloadLines(lines.slice(0, line + 1))[line];
}

/** For each line, whether it belongs to a multi-line JSON payload. */
function payloadLines(lines: string[]): boolean[] {
  let depth = 0;
  return lines.map((text) => {
    const inside = depth > 0;
    const colon = inside ? -1 : labelStart(text);
    if (inside || colon >= 0) {
      for (const ch of text.slice(colon + 1)) {
        if (ch === '{' || ch === '[') depth++;
        else if (ch === '}' || ch === ']') depth = Math.max(0, depth - 1);
      }
    }
    return inside;
  });
}

export type TokenKind = 'node' | 'tech' | 'team' | 'tag' | 'constant';

export interface Token {
  line: number;
  character: number;
  length: number;
  kind: TokenKind;
}

// Strings, comments and labels (free text after `:`) are consumed so nothing inside them
// becomes a token; arrows so the `x` of `-x` is not taken for a node; a hex color after
// `color` so it is not read as a comment.
const TOKEN =
  /"(?:[^"\\]|\\.)*"?|(?<=\bcolor\s+)#[0-9a-fA-F]{3,6}(?![A-Za-z0-9_])|#.*|:.*|->>|-->|->|-x(?![A-Za-z0-9_])|\[[^\]\n]*\]|@[A-Za-z0-9_-]+|\.[A-Za-z_][A-Za-z0-9_]*|x?\$[A-Za-z_][A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_]*/g;

/**
 * Semantic tokens for what the TextMate grammar cannot tell apart: node ids
 * (only declared or implicit nodes), tech stacks (`[PostgreSQL]`), teams (`@orders`),
 * legend tags (`.planned`, and the entry ids of the legend block), and
 * constants (`$peak`, `x$n` and the name in `let peak = …`).
 */
export function semanticTokens(analysis: Analysis): Token[] {
  const nodes = new Set(analysis.diagram.nodes.map((n) => n.id));
  const legend = analysis.diagram.legend ?? [];
  const tags = new Set(legend.map((e) => e.id));
  // 0-based line → column of a legend entry id written in this document.
  const entryAt = new Map(legend.filter((e) => e.loc.file === undefined).map((e) => [e.loc.line - 1, e.loc.col - 1]));
  const payload = payloadLines(analysis.lines);
  const out: Token[] = [];
  const constants = new Set((analysis.diagram.constants ?? []).map((c) => c.name));
  analysis.lines.forEach((text, line) => {
    if (payload[line]) return;
    const definition = LET.exec(text);
    if (definition && constants.has(definition[2])) out.push({ line, character: definition[1].length, length: definition[2].length, kind: 'constant' });
    for (const m of text.matchAll(TOKEN)) {
      const word = m[0];
      const at = m.index ?? 0;
      const kind: TokenKind | null =
        /^x?\$/.test(word)
          ? 'constant'
          : word[0] === '['
          ? 'tech'
          : word[0] === '@'
            ? 'team'
            : word[0] === '.'
              ? tags.has(word.slice(1)) ? 'tag' : null
              : entryAt.get(line) === at
                ? 'tag'
                : /^[A-Za-z_]/.test(word) && nodes.has(word) && !(definition && at === definition[1].length)
                  ? 'node'
                  : null;
      if (kind) out.push({ line, character: at, length: word.length, kind });
    }
  });
  return out;
}

/** `let name =`: the start of a constant's definition, and its name. */
const LET = /^(\s*let\s+)([A-Za-z_][A-Za-z0-9_]*)\s*=/;

/**
 * The constant at `pos`: a `$name` or `x$name` use, or the name of a `let`
 * line, with the range of the name alone (no `$` or `x$`).
 */
export function constantAt(analysis: Analysis, pos: Position): { constant: Constant; range: Range } | null {
  const line = analysis.lines[pos.line] ?? '';
  if (insidePayload(analysis.lines, pos.line)) return null;
  const at = (start: number, name: string) => {
    const constant = (analysis.diagram.constants ?? []).find((c) => c.name === name);
    if (!constant || pos.character < start - 1 || pos.character > start + name.length) return null;
    return { constant, range: { start: { line: pos.line, character: start }, end: { line: pos.line, character: start + name.length } } };
  };
  const definition = LET.exec(line);
  if (definition) {
    const found = at(definition[1].length, definition[2]);
    if (found) return found;
  }
  for (const t of tokenizeLine(line, pos.line + 1).tokens) {
    if (t.kind !== 'const') continue;
    const name = t.value.replace(/^x?\$/, '');
    const found = at(t.col - 1 + t.length - name.length, name);
    if (found) return found;
  }
  return null;
}

/** Every place constant `name` is written in this document: its `let` name and each use (the name alone). */
function constantRefs(analysis: Analysis, name: string): Range[] {
  const out: Range[] = [];
  const payload = payloadLines(analysis.lines);
  const range = (line: number, character: number) => ({ start: { line, character }, end: { line, character: character + name.length } });
  analysis.lines.forEach((text, line) => {
    if (payload[line]) return;
    const definition = LET.exec(text);
    if (definition?.[2] === name) out.push(range(line, definition[1].length));
    for (const t of tokenizeLine(text, line + 1).tokens) {
      if (t.kind === 'const' && t.value.replace(/^x?\$/, '') === name) out.push(range(line, t.col - 1 + t.length - name.length));
    }
  });
  return out;
}

function labelStart(text: string): number {
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === '#' && !quoted) return -1;
    else if (ch === ':' && !quoted) return i;
  }
  return -1;
}

export type CompletionKind = 'keyword' | 'node' | 'tech' | 'usecase' | 'scenario' | 'constant';

export interface CompletionItem {
  label: string;
  kind: CompletionKind;
  detail?: string;
  /** LSP snippet syntax, for keywords. */
  snippet?: string;
  /** Text to insert when it differs from the label (tech stacks close their bracket). */
  insertText?: string;
  /** Text the client filters on when it differs from the label: a tech stack and its aliases. */
  filterText?: string;
  /** Range the item replaces. */
  range: Range;
}

/**
 * Completions at a position: tech stacks in [ ], use case and scenario names in
 * the quotes of traffic, requirements and tests, capacity parts after a node id
 * in `capacity`, keywords at line start, node ids elsewhere.
 */
export function complete(analysis: Analysis, pos: Position): CompletionItem[] {
  const line = analysis.lines[pos.line] ?? '';
  const before = line.slice(0, pos.character);
  if (insidePayload(analysis.lines, pos.line)) return [];

  const tech = before.match(/\[([^\]]*)$/);
  if (tech) {
    const closed = line[pos.character] === ']';
    const range = { start: { line: pos.line, character: pos.character - tech[1].length }, end: pos };
    return componentCatalog.map((c) => {
      const aliases: readonly string[] = 'aliases' in c ? c.aliases : [];
      return {
        label: c.techStack,
        kind: 'tech' as const,
        detail: aliases.length ? `${c.category} · also ${aliases.slice(0, 3).join(', ')}` : c.category,
        insertText: closed ? c.techStack : `${c.techStack}]`,
        ...(aliases.length ? { filterText: [c.techStack, ...aliases].join(' ') } : {}),
        range,
      };
    });
  }
  const names = quotedNames(analysis, pos);
  if (names) return names;
  if (inLabel(before)) return [];
  const constant = before.match(/x?\$(\w*)$/);
  if (constant) {
    const range = { start: { line: pos.line, character: pos.character - constant[1].length }, end: pos };
    return (analysis.diagram.constants ?? []).map((c) => ({ label: c.name, kind: 'constant' as const, detail: `${c.text} · ${kindName(c.unit)}`, range }));
  }

  if (sectionAt(analysis, pos.line) === 'requirements') {
    const scoped = costScopeCompletions(analysis, before, pos);
    if (scoped) return scoped;
  }
  const word = before.match(/[A-Za-z_]\w*$/)?.[0] ?? '';
  const range = { start: { line: pos.line, character: pos.character - word.length }, end: pos };
  const atLineStart = /^\s*(\}\s*)?$/.test(before.slice(0, before.length - word.length));
  if (sectionAt(analysis, pos.line) === 'capacity') return capacityCompletions(analysis, before.slice(0, before.length - word.length), range);
  if (sectionAt(analysis, pos.line) === 'traffic') return trafficCompletions(before.slice(0, before.length - word.length), range);
  // `when` is only valid right after an alt name: alt "Not found" when "…" {
  if (/^\s*(\}\s*)?alt\s+"[^"]*"\s+$/.test(before.slice(0, before.length - word.length))) {
    return [{ label: 'when', kind: 'keyword', detail: 'Condition of this scenario', snippet: 'when "${1:condition}" {\n\t$0\n}', range }];
  }
  const nodes: CompletionItem[] = analysis.diagram.nodes.map((n) => ({
    label: n.id,
    kind: 'node',
    detail: describeNode(n),
    range,
  }));
  if (!atLineStart) return nodes;
  // Inside a test block a line is an assertion, never a statement.
  if (inTestBlock(analysis.lines, pos.line) && !/\}/.test(before)) {
    const assertions: CompletionItem[] = ASSERTIONS.map((a) => ({ label: a.label, kind: 'keyword', detail: a.detail, snippet: a.snippet, range }));
    return [...assertions, ...nodes];
  }
  const afterBrace = /\}\s*$/.test(before.slice(0, before.length - word.length));
  const keywords: CompletionItem[] = KEYWORDS.filter((k) => !afterBrace || k.label === 'alt').map((k) => ({
    label: k.label,
    kind: 'keyword',
    detail: k.detail,
    snippet: k.snippet,
    range,
  }));
  return afterBrace ? keywords : [...keywords, ...nodes];
}

const PERCENTILE = 'p50|p90|p95|p99|p999';
const USE_CASE_REQUIREMENT = new RegExp(`^\\s*(?:${PERCENTILE}|availability|durable)\\s+$`);
const SCENARIO_REQUIREMENT = new RegExp(`^\\s*(?:${PERCENTILE})\\s+"([^"]*)"\\s+scenario\\s+$`);

/**
 * Use case names in an open quote where traffic, requirements and test
 * assertions name one, and scenario names after `mix`, `scenario` and
 * `has scenario`; null when the cursor is not in such a quote.
 */
function quotedNames(analysis: Analysis, pos: Position): CompletionItem[] | null {
  const line = analysis.lines[pos.line] ?? '';
  const before = line.slice(0, pos.character);
  if ((before.match(/"/g)?.length ?? 0) % 2 === 0) return null;
  const partial = before.slice(before.lastIndexOf('"') + 1);
  const head = before.slice(0, before.length - partial.length - 1);
  const section = sectionAt(analysis, pos.line);
  let useCases = false;
  let scenariosOf: string | undefined;
  if (section === 'traffic') {
    useCases = /^\s*$/.test(head);
    scenariosOf = head.match(/^\s*"([^"]*)"[^"]*\bmix\s+(?:"[^"]*"[^",]*,\s*)*$/)?.[1];
  } else if (section === 'requirements') {
    useCases = USE_CASE_REQUIREMENT.test(head);
    scenariosOf = head.match(SCENARIO_REQUIREMENT)?.[1];
  } else if (section === 'whatif') {
    useCases = /^\s*traffic\s+$/.test(head);
  } else if (section === 'test') {
    useCases = /^\s*(in\s+)?$/.test(head);
    scenariosOf = head.match(/^\s*(?:in\s+)?"([^"]*)"\s+(?:has\s+)?scenario\s+$/)?.[1];
  } else return null;
  const range = { start: { line: pos.line, character: pos.character - partial.length }, end: pos };
  const close = line[pos.character] === '"' ? '' : '"';
  if (useCases) {
    return analysis.diagram.useCases.map((u) => ({ label: u.name, kind: 'usecase' as const, detail: u.endpoint, insertText: `${u.name}${close}`, range }));
  }
  const u = scenariosOf === undefined ? undefined : analysis.diagram.useCases.find((x) => x.name === scenariosOf);
  return (u?.scenarios ?? [])
    .filter((s) => s.id !== 'main')
    .map((s) => ({ label: s.name, kind: 'scenario' as const, detail: s.outcome === 'error' ? 'error path' : undefined, insertText: `${s.name}${close}`, range }));
}

/** Node ids at the start of a capacity line; then the parts not yet on it, or the values of `size` and `consistency`. */
function capacityCompletions(analysis: Analysis, head: string, range: Range): CompletionItem[] {
  if (/^\s*$/.test(head)) return analysis.diagram.nodes.map((n) => ({ label: n.id, kind: 'node', detail: describeNode(n), range }));
  const value = head.match(/\b(size|consistency)\s+$/)?.[1];
  if (value) return (value === 'size' ? ['S', 'M', 'L'] : ['strong', 'eventual']).map((label) => ({ label, kind: 'keyword', range }));
  if (/\b(latency|availability|cost|timeout|reads|writes|shards|bandwidth|egress|hit)\s+$/.test(head)) return [];
  const used = new Set(head.trim().split(/\s+/));
  return CAPACITY_PARTS.filter((p) => !used.has(p.label)).map((p) => ({ label: p.label, kind: 'keyword', detail: p.detail, snippet: p.snippet, range }));
}

/**
 * After `cost` in requirements: the teams (`@Payments`), the tags (`.edge`)
 * and `group`; after `cost group`, the group ids. Null elsewhere.
 */
function costScopeCompletions(analysis: Analysis, before: string, pos: Position): CompletionItem[] | null {
  const { nodes } = analysis.diagram;
  const group = before.match(/^\s*cost\s+group\s+(\w*)$/);
  if (group) {
    const range = { start: { line: pos.line, character: pos.character - group[1].length }, end: pos };
    return nodes.filter((n) => n.kind === 'group').map((n) => ({ label: n.id, kind: 'node' as const, detail: n.name !== n.id ? n.name : 'group', range }));
  }
  const scope = before.match(/^\s*cost\s+([@.]?[\w-]*)$/);
  if (!scope) return null;
  const range = { start: { line: pos.line, character: pos.character - scope[1].length }, end: pos };
  const teams = [...new Set(nodes.map((n) => n.ownerTeam).filter((t): t is string => t !== undefined))];
  const tags = [...new Set(nodes.map((n) => n.tag).filter((t): t is string => t !== undefined))];
  return [
    ...teams.map((t) => ({ label: `@${t}`, kind: 'keyword' as const, detail: 'Budget for what the team owns', snippet: `@${t} <= \${1:500} usd/month`, range })),
    ...tags.map((t) => ({ label: `.${t}`, kind: 'keyword' as const, detail: 'Budget for the nodes with the tag', snippet: `.${t} <= \${1:500} usd/month`, range })),
    { label: 'group', kind: 'keyword' as const, detail: 'Budget for the nodes inside a group', snippet: 'group ${1:id} <= ${2:500} usd/month', range },
    { label: '<=', kind: 'keyword' as const, detail: 'Budget for the whole design', snippet: '<= ${1:3000} usd/month', range },
  ];
}

const RATE = String.raw`\S+(?:\s+(?:rps|rpm|rpd))?`;
const AFTER_RATE = new RegExp(String.raw`^\s*"[^"]*"\s+${RATE}\s+$`);
const AFTER_PEAK = new RegExp(String.raw`^\s*"[^"]*"\s+${RATE}\s+peak\s+${RATE}\s+$`);

/** After a traffic line's rate: `peak` and `mix`; after its peak: `mix`. */
function trafficCompletions(head: string, range: Range): CompletionItem[] {
  const peak: CompletionItem = { label: 'peak', kind: 'keyword', detail: 'The peak, as a multiple of this average rate', snippet: 'peak x${1:3}', range };
  const mix: CompletionItem = { label: 'mix', kind: 'keyword', detail: 'Shares of the scenarios', snippet: 'mix "${1:Scenario}" ${2:90%}', range };
  if (AFTER_RATE.test(head)) return [peak, mix];
  return AFTER_PEAK.test(head) ? [mix] : [];
}

type SectionKind = NonNullable<ParseResult['blocks']>[number]['kind'];

/**
 * The top-level section block that line `index` (0-based) is inside, not on
 * its opening or closing line. A block still being typed has no `}` yet, so
 * then it is found by its opening line.
 */
function sectionAt(analysis: Analysis, index: number): SectionKind | undefined {
  const line = index + 1;
  const closed = (analysis.result.blocks ?? []).find((b) => b.start < line && line < b.end);
  if (closed) return closed.kind;
  for (let i = index - 1; i >= 0; i--) {
    const text = analysis.lines[i];
    if (/^\s*\}/.test(text)) return undefined;
    const open = text.match(/^\s*(traffic|requirements|capacity|test|whatif)\b.*\{\s*(?:#.*)?$/);
    if (open) return open[1] as SectionKind;
    if (/\{\s*(?:#.*)?$/.test(text)) return undefined;
  }
  return undefined;
}

/**
 * True when line `index` is inside a `test "…" {` block: the nearest line
 * above that opens a block is a test header, and no line in between closes one.
 */
export function inTestBlock(lines: string[], index: number): boolean {
  for (let i = index - 1; i >= 0; i--) {
    const line = lines[i];
    if (/^\s*\}/.test(line)) return false;
    if (/\{\s*(?:#.*)?$/.test(line)) return /^\s*test\s+"/.test(line);
  }
  return false;
}

function describeNode(n: DiagramNode): string {
  return [n.name !== n.id ? n.name : '', n.techStack, n.ownerTeam ? `@${n.ownerTeam}` : ''].filter(Boolean).join(' · ');
}

/** The node whose id is under the cursor, if any, outside labels and strings. */
export function nodeAt(analysis: Analysis, pos: Position): { node: DiagramNode; range: Range } | null {
  const line = analysis.lines[pos.line] ?? '';
  if (insidePayload(analysis.lines, pos.line)) return null;
  const word = wordAt(line, pos.character);
  if (!word) return null;
  const before = line.slice(0, word.start);
  if (inLabel(before) || (before.match(/"/g)?.length ?? 0) % 2 === 1 || /\[[^\]]*$/.test(before) || /@[\w-]*$/.test(before)) return null;
  const node = analysis.diagram.nodes.find((n) => n.id === word.word);
  if (!node) return null;
  return { node, range: { start: { line: pos.line, character: word.start }, end: { line: pos.line, character: word.end } } };
}

/** Where a node is declared, in this document or (with `file`) an imported one; implicit nodes have no declaration. */
export function declaration(analysis: Analysis, pos: Position): { file?: string; range: Range } | null {
  const constant = constantAt(analysis, pos);
  if (constant) return { file: constant.constant.loc.file, range: toRange(constant.constant.loc) };
  const hit = nodeAt(analysis, pos);
  if (!hit || hit.node.implicit) return null;
  return { file: hit.node.loc.file, range: toRange(hit.node.loc) };
}

/** Where a node is declared, if that is in this document. */
export function definition(analysis: Analysis, pos: Position): Range | null {
  const found = declaration(analysis, pos);
  return found && found.file === undefined ? found.range : null;
}

/** Every place a node id is used as a node: its declaration, connections and steps. */
export function references(analysis: Analysis, pos: Position): Range[] {
  const constant = constantAt(analysis, pos);
  if (constant) return constantRefs(analysis, constant.constant.name);
  const hit = nodeAt(analysis, pos);
  return hit ? referencesTo(analysis, hit.node.id) : [];
}

/** Every place node `id` is used as a node in this document. */
function referencesTo(analysis: Analysis, id: string): Range[] {
  const out: Range[] = [];
  analysis.lines.forEach((line, i) => {
    const re = new RegExp(`(?<![\\w"@\\[])${id}(?![\\w"])`, 'g');
    for (const m of line.matchAll(re)) {
      const character = m.index ?? 0;
      const found = nodeAt(analysis, { line: i, character });
      if (found?.node.id === id && found.range.start.character === character) {
        out.push({ start: { line: i, character }, end: { line: i, character: character + id.length } });
      }
    }
  });
  return out;
}

type LineToken = ReturnType<typeof tokenizeLine>['tokens'][number];

/** A quoted use case or scenario name in this document, where it is declared or named. */
interface NameRef {
  kind: 'usecase' | 'scenario';
  /** The use case it names or belongs to. */
  useCase: string;
  /** A use case: its name. A scenario: its alt names, outermost first. */
  path: string[];
  /** 0-based. */
  line: number;
  /** Where each name of `path` starts (0-based), when it is written here; an alt header writes only the last. */
  starts: (number | undefined)[];
  /** `expose … -> "Use case"`: the system whose team file has the use case. */
  system?: string;
}

/**
 * Every quoted use case and scenario name in the document: `usecase` and
 * `alt` headers, the use cases and `mix` of traffic lines, requirements, test
 * assertions with their `scenario` names, `traffic "…"` in a `whatif`, and the
 * team use cases of `expose … -> "…"`. Names with escapes are left out.
 */
function nameRefs(analysis: Analysis): NameRef[] {
  const out: NameRef[] = [];
  const blocks = analysis.result.blocks ?? [];
  const payload = payloadLines(analysis.lines);
  const str = (t: LineToken | undefined) => (t?.kind === 'string' && t.length === t.value.length + 2 ? t : undefined);
  const word = (t: LineToken | undefined, w: string) => t?.kind === 'ident' && t.value === w;
  const useCase = (t: LineToken, line: number, system?: string) =>
    out.push({ kind: 'usecase', useCase: t.value, path: [t.value], line, starts: [t.col], ...(system === undefined ? {} : { system }) });
  const named = (useCase: string, t: LineToken, line: number) => {
    const path = t.value.split(' › ');
    let at = t.col;
    out.push({ kind: 'scenario', useCase, path, line, starts: path.map((p) => ((at += p.length + 3), at - p.length - 3)) });
  };
  const scenarioAfter = (useCase: string, tokens: LineToken[], line: number) => {
    tokens.forEach((t, k) => {
      const s = word(t, 'scenario') ? str(tokens[k + 1]) : undefined;
      if (s) named(useCase, s, line);
    });
  };
  // `whatif "Name" { traffic "Use case" x3; … }`
  const whatifTraffic = (tokens: LineToken[], k: number, line: number) => {
    const name = word(tokens[k], 'traffic') ? str(tokens[k + 1]) : undefined;
    if (name) useCase(name, line);
  };
  type Frame = { kind: 'usecase' | 'alt' | 'system' | 'whatif' | 'other'; name?: string };
  const frames: Frame[] = [];
  analysis.lines.forEach((text, line) => {
    if (payload[line]) return;
    const tokens = tokenizeLine(text, line + 1).tokens;
    const block = blocks.find((b) => b.start <= line + 1 && line + 1 <= b.end);
    if (block) {
      if (block.kind === 'whatif') tokens.forEach((_, k) => whatifTraffic(tokens, k, line));
      if (line + 1 === block.start || line + 1 === block.end) return;
      const [first, second] = tokens;
      if (block.kind === 'traffic' && str(first)) {
        useCase(first, line);
        const mix = tokens.findIndex((t) => word(t, 'mix'));
        if (mix > 0) tokens.slice(mix + 1).forEach((t) => str(t) && named(first.value, t, line));
      } else if (block.kind === 'requirements' && first?.kind === 'ident' && USE_CASE_REQUIREMENT.test(`${first.value} `) && str(second)) {
        useCase(second, line);
        scenarioAfter(second.value, tokens, line);
      } else if (block.kind === 'test') {
        const name = str(first) ?? (word(first, 'in') ? str(second) : undefined);
        if (name) {
          useCase(name, line);
          scenarioAfter(name.value, tokens, line);
        }
      }
      return;
    }
    let pending: Frame | undefined;
    const inside = (kind: Frame['kind']) => pending?.kind === kind || frames.some((f) => f.kind === kind);
    tokens.forEach((t, k) => {
      const next = tokens[k + 1];
      if (t.kind === 'lbrace') {
        frames.push(pending ?? { kind: 'other' });
        pending = undefined;
      } else if (t.kind === 'rbrace') frames.pop();
      else if (k === 0 && frames.length === 0 && word(t, 'usecase') && (next?.kind === 'string' || next?.kind === 'ident')) {
        pending = { kind: 'usecase', name: next.value };
        if (str(next)) useCase(next, line);
      } else if (word(t, 'alt') && frames.length > 0 && frames[0].kind === 'usecase' && (next?.kind === 'string' || next?.kind === 'ident')) {
        pending = { kind: 'alt', name: next.value };
        const path = [...frames.filter((f) => f.kind === 'alt').map((f) => f.name!), next.value];
        if (str(next)) out.push({ kind: 'scenario', useCase: frames[0].name!, path, line, starts: [...path.slice(1).map(() => undefined), next.col] });
      } else if (k === 0 && word(t, 'system') && next?.kind === 'ident') pending = { kind: 'system', name: next.value };
      else if (k === 0 && frames.length === 0 && word(t, 'whatif')) pending = { kind: 'whatif' };
      else if (inside('whatif')) whatifTraffic(tokens, k, line);
      else if (t.kind === 'arrow' && word(tokens[0], 'expose') && str(next)) {
        const system = [...frames].reverse().find((f) => f.kind === 'system');
        if (system) useCase(next!, line, system.name);
      }
    });
  });
  return out;
}

/** The name of `path` under the cursor, with the refs it covers: `path` up to that name. */
function nameAt(analysis: Analysis, pos: Position): { ref: NameRef; index: number; range: Range } | null {
  for (const ref of nameRefs(analysis)) {
    if (ref.line !== pos.line) continue;
    for (let index = 0; index < ref.path.length; index++) {
      const start = ref.starts[index];
      if (start === undefined || pos.character < start || pos.character > start + ref.path[index].length) continue;
      return { ref, index, range: { start: { line: pos.line, character: start }, end: { line: pos.line, character: start + ref.path[index].length } } };
    }
  }
  return null;
}

/** What a rename changes: a node id, a use case name, or a scenario (its alt names up to the renamed one). */
export type RenameSymbol =
  | { kind: 'node'; id: string }
  | { kind: 'usecase'; name: string }
  | { kind: 'scenario'; useCase: string; path: string[] }
  | { kind: 'constant'; name: string };

/**
 * The symbol at `pos`, the range a rename replaces, and the file that
 * declares it as this analysis knows it (undefined: this document, or not
 * declared anywhere, like an implicit node).
 */
function symbolAt(analysis: Analysis, pos: Position): { symbol: RenameSymbol; range: Range; placeholder: string; file?: string } | null {
  const constant = constantAt(analysis, pos);
  if (constant) {
    const c = constant.constant;
    return { symbol: { kind: 'constant', name: c.name }, range: constant.range, placeholder: c.name, file: c.loc.file };
  }
  const name = nameAt(analysis, pos);
  if (name) {
    const { ref, index, range } = name;
    const placeholder = ref.path[index];
    if (ref.system !== undefined) {
      const team = analysis.diagram.systems?.find((s) => s.id === ref.system)?.resolved;
      return { symbol: { kind: 'usecase', name: ref.useCase }, range, placeholder, file: team };
    }
    const file = analysis.diagram.useCases.find((u) => u.name === ref.useCase)?.loc.file;
    const symbol: RenameSymbol = ref.kind === 'usecase' ? { kind: 'usecase', name: ref.useCase } : { kind: 'scenario', useCase: ref.useCase, path: ref.path.slice(0, index + 1) };
    return { symbol, range, placeholder, file };
  }
  const hit = nodeAt(analysis, pos);
  if (!hit || (analysis.lines[pos.line] ?? '')[hit.range.start.character - 1] === '.') return null;
  return { symbol: { kind: 'node', id: hit.node.id }, range: hit.range, placeholder: hit.node.id, file: hit.node.implicit ? undefined : hit.node.loc.file };
}

/** Where a rename at `pos` applies, or null when nothing renameable is there. */
export function renameTarget(analysis: Analysis, pos: Position): { range: Range; placeholder: string } | null {
  const found = symbolAt(analysis, pos);
  return found && { range: found.range, placeholder: found.placeholder };
}

/**
 * The edits in this document for renaming `symbol` declared in `file`
 * (undefined: declared in this document). Uses that resolve elsewhere, like a
 * use case of the same name from another file, are left alone; the
 * `expose … -> "…"` of a system whose team file is `file` follows it.
 */
export function renameEdits(analysis: Analysis, symbol: RenameSymbol, newName: string, file?: string): TextEdit[] {
  if (symbol.kind === 'constant') {
    const constant = (analysis.diagram.constants ?? []).find((c) => c.name === symbol.name);
    if (!constant || constant.loc.file !== file) return [];
    return constantRefs(analysis, symbol.name).map((range) => ({ range, newText: newName }));
  }
  if (symbol.kind === 'node') {
    const node = analysis.diagram.nodes.find((n) => n.id === symbol.id);
    if (!node || (node.implicit ? file !== undefined : node.loc.file !== file)) return [];
    // `.id` after a system is one of its entry points, not this node.
    return referencesTo(analysis, symbol.id)
      .filter((r) => (analysis.lines[r.start.line] ?? '')[r.start.character - 1] !== '.')
      .map((range) => ({ range, newText: newName }));
  }
  const name = symbol.kind === 'usecase' ? symbol.name : symbol.useCase;
  const own = analysis.diagram.useCases.some((u) => u.name === name && u.loc.file === file);
  const team = (system: string) => file !== undefined && analysis.diagram.systems?.find((s) => s.id === system)?.resolved === file;
  const path = symbol.kind === 'usecase' ? [symbol.name] : symbol.path;
  const index = path.length - 1;
  return nameRefs(analysis)
    .filter((r) => r.kind === symbol.kind && r.useCase === name && (r.system === undefined ? own : team(r.system)))
    .filter((r) => r.path.length > index && path.every((p, i) => r.path[i] === p) && r.starts[index] !== undefined)
    .map((r) => ({
      range: { start: { line: r.line, character: r.starts[index]! }, end: { line: r.line, character: r.starts[index]! + path[index].length } },
      newText: newName,
    }));
}

export interface RenameResult {
  /** What is renamed, so the same rename can be made in other documents with renameEdits. */
  symbol: RenameSymbol;
  edits: TextEdit[];
  /** The file that declares it, when that is not this document: rename it there too. */
  declaredIn?: string;
}

/**
 * Renames the node id, use case or scenario name at `pos` everywhere this
 * document uses it. A use case or scenario keeps its references in traffic,
 * requirements, tests and what-ifs; a scenario's nested names follow it. An
 * error explains a name that cannot be used.
 */
export function rename(analysis: Analysis, pos: Position, newName: string): RenameResult | { error: string } | null {
  const found = symbolAt(analysis, pos);
  if (!found) return null;
  const { symbol, file } = found;
  if (symbol.kind === 'node') {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(newName)) return { error: `'${newName}' is not a node id; use letters, digits and _` };
    if (newName !== symbol.id && analysis.diagram.nodes.some((n) => n.id === newName)) return { error: `There is already a node '${newName}'` };
  } else if (symbol.kind === 'constant') {
    const name = newName.replace(/^\$/, '');
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return { error: `'${newName}' is not a constant name; use letters, digits and _` };
    if (name !== symbol.name && (analysis.diagram.constants ?? []).some((c) => c.name === name)) return { error: `There is already a constant '$${name}'` };
    const edits = renameEdits(analysis, symbol, name, file);
    return file === undefined ? { symbol, edits } : { symbol, edits, declaredIn: file };
  } else {
    if (!newName.trim() || /["\\\n]/.test(newName) || newName.includes(' › ')) return { error: `'${newName}' cannot be a name; leave out quotes, backslashes and ' › '` };
    if (symbol.kind === 'usecase' && newName !== symbol.name && analysis.diagram.useCases.some((u) => u.name === newName)) return { error: `There is already a use case named "${newName}"` };
  }
  const edits = renameEdits(analysis, symbol, newName, file);
  return file === undefined ? { symbol, edits } : { symbol, edits, declaredIn: file };
}

/** Markdown hover text for the node under the cursor. */
export function hover(analysis: Analysis, pos: Position): { markdown: string; range: Range } | null {
  const constant = constantAt(analysis, pos);
  if (constant) {
    const c = constant.constant;
    const lines = [`**$${c.name}** = \`${c.text}\``, '', `Constant, ${kindName(c.unit)}`];
    if (c.loc.file) lines.push('', `_Defined in ${c.loc.file.split(/[\\/]/).pop()}_`);
    return { markdown: lines.join('\n'), range: constant.range };
  }
  const name = nameAt(analysis, pos);
  if (name?.ref.kind === 'usecase' && sectionAt(analysis, pos.line) === 'traffic') {
    const u = simulationOf(analysis.diagram).useCases.find((x) => x.name === name.ref.useCase);
    if (!u) return null;
    const lines = [`**${u.name}** · ${formatTraffic(u.rps, u.avgRps)}`];
    if (u.avgRps !== undefined) lines.push('', 'Capacity, latency and requirements are taken at the peak, egress cost at the average.');
    if (Number.isFinite(u.percentiles.p99)) lines.push('', `p99 ${formatMs(u.percentiles.p99)} · availability ${formatAvailability(u.availability)}`);
    return { markdown: lines.join('\n'), range: name.range };
  }
  const team = teamAt(analysis, pos);
  if (team) return teamHover(analysis, team.team, team.range);
  const hit = nodeAt(analysis, pos);
  if (!hit) return null;
  const n = hit.node;
  const useCases = analysis.diagram.useCases.filter((u) =>
    u.scenarios.some((s) => s.steps.some((step) => step.fromServiceId === n.id || step.toServiceId === n.id)),
  );
  const lines = [
    `**${n.name}** \`${n.id}\``,
    '',
    [`\`${n.techStack}\``, n.kind !== 'component' ? n.kind : '', n.ownerTeam ? `owned by @${n.ownerTeam}` : ''].filter(Boolean).join(' · '),
  ];
  if (n.description) lines.push('', n.description);
  if (n.parent) lines.push('', `In group \`${n.parent}\``);
  if (n.implicit) lines.push('', '_Not declared; created because it is referenced._');
  else if (n.loc.file) lines.push('', `_Declared in ${n.loc.file.split(/[\\/]/).pop()}_`);
  if (useCases.length) lines.push('', `Used in: ${useCases.map((u) => `“${u.name}”`).join(', ')}`);
  const load = nodeSimulation(analysis.diagram, n.id);
  if (load) lines.push('', load);
  return { markdown: lines.join('\n'), range: hit.range };
}

/** The `@team` under the cursor, outside labels and strings, with its range (the `@` included). */
export function teamAt(analysis: Analysis, pos: Position): { team: string; range: Range } | null {
  if (insidePayload(analysis.lines, pos.line)) return null;
  for (const t of tokenizeLine(analysis.lines[pos.line] ?? '', pos.line + 1).tokens) {
    if (t.kind !== 'team' || pos.character < t.col - 1 || pos.character > t.col - 1 + t.length) continue;
    return { team: t.value, range: { start: { line: pos.line, character: t.col - 1 }, end: { line: pos.line, character: t.col - 1 + t.length } } };
  }
  return null;
}

/** A team's nodes and, with traffic, what they cost a month against its budget. */
function teamHover(analysis: Analysis, team: string, range: Range): { markdown: string; range: Range } {
  const { diagram } = analysis;
  const owned = diagram.nodes.filter((n) => n.ownerTeam === team);
  const lines = [`**@${team}** · team`, '', owned.length ? `Owns ${owned.map((n) => `\`${n.id}\``).join(', ')}` : '_Owns no node in this design._'];
  if ((diagram.traffic ?? []).length > 0 && owned.length) {
    const sim = simulationOf(diagram);
    const share = costBreakdown(diagram, sim).teams.find((t) => t.id === `@${team}`);
    if (share) {
      const of = sim.totalCostUsd > 0 ? ` (${formatPercent(share.costUsd / sim.totalCostUsd)} of ${formatUsd(sim.totalCostUsd)})` : '';
      lines.push('', `Costs ${formatUsd(share.costUsd)}${of}`);
      const budget = (diagram.requirements ?? []).find((r) => r.kind === 'cost' && r.scope && 'team' in r.scope && r.scope.team === team);
      if (budget?.kind === 'cost') lines.push('', `Budget ${formatUsd(budget.maxUsdPerMonth)}: ${share.costUsd <= budget.maxUsdPerMonth ? 'within it' : '**over it**'}`);
    }
  }
  return { markdown: lines.join('\n'), range };
}

export interface OutlineSymbol {
  name: string;
  detail?: string;
  kind: 'node' | 'group' | 'usecase' | 'scenario' | 'section' | 'traffic' | 'requirement' | 'entity' | 'decision' | 'test';
  range: Range;
  children: OutlineSymbol[];
}

/**
 * Groups with their members, then use cases with their scenarios, then the
 * high-level design sections (traffic, requirements, entities, decisions,
 * tests); only what this document declares.
 */
export function outline(analysis: Analysis): OutlineSymbol[] {
  const declared = analysis.diagram.nodes.filter((n) => !n.implicit && !n.loc.file);
  const symbolOf = (n: DiagramNode): OutlineSymbol => ({
    name: n.id,
    detail: describeNode(n),
    kind: n.kind === 'group' ? 'group' : 'node',
    range: toRange(n.loc),
    children: declared.filter((c) => c.parent === n.id).map(symbolOf),
  });
  const top = declared.filter((n) => !n.parent).map(symbolOf);
  const useCases = analysis.diagram.useCases.filter((u) => !u.loc.file).map((u) => ({
    name: u.name,
    detail: [u.endpoint, u.scenarios.length > 1 ? `${u.scenarios.length} scenarios` : ''].filter(Boolean).join(' · '),
    kind: 'usecase' as const,
    range: toRange(u.loc),
    children:
      u.scenarios.length > 1
        ? u.scenarios.map((s) => ({
            name: s.name,
            detail: s.outcome === 'error' ? 'error path' : undefined,
            kind: 'scenario' as const,
            range: toRange(s.loc),
            children: [],
          }))
        : [],
  }));
  return [...top, ...useCases, ...sections(analysis)];
}

/** One symbol per high-level design section that has entries in this document, spanning them. */
function sections(analysis: Analysis): OutlineSymbol[] {
  const { diagram, lines } = analysis;
  const own = <T extends { loc: SourceLoc }>(items: T[] | undefined) => (items ?? []).filter((i) => !i.loc.file);
  const item = (kind: OutlineSymbol['kind'], name: string, loc: SourceLoc, detail?: string): OutlineSymbol => ({ name, detail: detail || undefined, kind, range: toRange(loc), children: [] });
  const sourceOf = (loc: SourceLoc) => (lines[loc.line - 1] ?? '').slice(loc.col - 1, loc.col - 1 + loc.length);
  const count = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'}`;

  const groups: [string, OutlineSymbol[]][] = [
    ['traffic', own(diagram.traffic).map((t) => item('traffic', t.useCase, t.loc, [`${t.rps} rps`, t.mix ? count(t.mix.length, 'scenario') : ''].filter(Boolean).join(' · ')))],
    ['requirements', own(diagram.requirements).map((r) => item('requirement', sourceOf(r.loc), r.loc))],
    ['entities', own(diagram.entities).map((e) => item('entity', e.name, e.loc, [e.store ? `in ${e.store}` : '', count(e.fields.length, 'field')].filter(Boolean).join(' · ')))],
    ['decisions', own(diagram.decisions).map((d) => item('decision', d.title, d.loc, d.because))],
    ['tests', own(diagram.tests).map((t) => item('test', t.name, t.loc, count(t.assertions.length, 'assertion')))],
  ];
  return groups
    .filter(([, children]) => children.length)
    .map(([name, children]) => ({
      name,
      kind: 'section' as const,
      range: { start: children[0].range.start, end: children.reduce((end, c) => (c.range.end.line >= end.line ? c.range.end : end), children[0].range.end) },
      children,
    }));
}

export interface TextEdit {
  range: Range;
  newText: string;
}

const MISSING_CONNECTION = /^No connection between '\w+' and '\w+' in the architecture; add '(\w+) -> (\w+)'$/;
const REPEATED_PART = /^.+ is given twice for '\w+'$/;

/**
 * A quick fix for a parser diagnostic, if it has one: the missing-connection
 * warning adds the connection; an unknown tech stack with a "did you mean"
 * replaces the text in its brackets (`range` is the diagnostic's, which
 * covers `[…]`); a capacity part given twice is removed (`range` starts at
 * the second one).
 */
export function quickFix(analysis: Analysis, message: string, range?: Range): { title: string; edit: TextEdit } | null {
  if (REPEATED_PART.test(message) && range) return removeCapacityPart(analysis, range.start);
  const tech = message.match(DID_YOU_MEAN);
  if (tech && range) {
    const line = analysis.lines[range.start.line] ?? '';
    const open = line.indexOf('[', range.start.character);
    const close = open < 0 ? -1 : line.indexOf(']', open);
    if (open < 0 || close < 0) return null;
    return {
      title: `Change to '${tech[2]}'`,
      edit: { range: { start: { line: range.start.line, character: open + 1 }, end: { line: range.start.line, character: close } }, newText: tech[2] },
    };
  }
  const m = message.match(MISSING_CONNECTION);
  if (!m) return null;
  const [, from, to] = m;
  const text = analysis.lines.join('\n');
  // addConnection is what the canvas uses too, so the line lands where a drag-to-connect would put it.
  const updated = addConnection(text, from, to);
  if (updated === text) return null;
  return { title: `Add connection '${from} -> ${to}'`, edit: diffEdit(text, updated) };
}

/** Removes the capacity part that starts at `at`: a keyword and its value, or a rate, `durable` or `volatile` alone. */
function removeCapacityPart(analysis: Analysis, at: Position): { title: string; edit: TextEdit } | null {
  const text = analysis.lines[at.line] ?? '';
  const tokens = tokenizeLine(text, at.line + 1).tokens;
  const k = tokens.findIndex((t) => t.col - 1 === at.character);
  if (k < 1) return null;
  const t = tokens[k];
  const alone = t.kind === 'quantity' || t.kind === 'number' || (t.kind === 'ident' && (t.value === 'durable' || t.value === 'volatile'));
  const last = tokens[Math.min(k + (alone ? 1 : 2), tokens.length) - 1];
  const from = tokens[k - 1].col - 1 + tokens[k - 1].length;
  const to = last.col - 1 + last.length;
  return {
    title: `Remove the repeated '${text.slice(t.col - 1, to)}'`,
    edit: { range: { start: { line: at.line, character: from }, end: { line: at.line, character: to } }, newText: '' },
  };
}

/**
 * The fix a failing requirement suggests (`x2` on a node, `shards N` in its
 * capacity line), for the warning at `range`, which is the requirement's.
 */
export function testQuickFix(analysis: Analysis, range: Range): { title: string; edit: TextEdit } | null {
  const fix = requirementFixes(analysis.diagram).find(
    ({ loc }) => loc.file === undefined && loc.line - 1 === range.start.line && loc.col - 1 === range.start.character,
  )?.fix;
  if (!fix) return null;
  const node = analysis.diagram.nodes.find((n) => n.id === fix.node);
  const text = analysis.lines.join('\n');
  let updated: string;
  let title: string;
  if (fix.kind === 'replicas') {
    // The declaration of a node from an imported file is not this document's to change.
    if (!node || node.loc.file !== undefined) return null;
    updated = setReplicas(text, fix.node, fix.replicas);
    title = `Add x${fix.replicas} to '${fix.node}'`;
  } else {
    updated = setCapacity(text, fix.node, 'shards', fix.shards);
    title = `Add shards ${fix.shards} to the capacity of '${fix.node}'`;
  }
  return updated === text ? null : { title, edit: diffEdit(text, updated) };
}

/**
 * Fixes offered where the cursor is, without a diagnostic: on a use case
 * header with no traffic line, a line for it in `traffic` (adding the block
 * when there is none).
 */
export function cursorFixes(analysis: Analysis, range: Range): { title: string; edit: TextEdit }[] {
  const u = analysis.diagram.useCases.find((x) => x.loc.file === undefined && x.loc.line - 1 === range.start.line);
  if (!u || (analysis.diagram.traffic ?? []).some((t) => t.useCase === u.name)) return [];
  const entry = `"${u.name.replace(/["\\]/g, '\\$&')}" 100 rps`;
  const title = `Add a traffic line for "${u.name}"`;
  const block = analysis.result.blocks?.find((b) => b.kind === 'traffic');
  if (block) {
    const first = analysis.lines[block.start] ?? '';
    const indent = block.end - block.start > 1 ? (/^\s*/.exec(first)?.[0] ?? '  ') : '  ';
    const at = { line: block.end - 1, character: 0 };
    return [{ title, edit: { range: { start: at, end: at }, newText: `${indent}${entry}\n` } }];
  }
  const last = analysis.lines.length - 1;
  const at = { line: last, character: analysis.lines[last].length };
  const gap = analysis.lines[last] === '' ? '' : '\n';
  return [{ title, edit: { range: { start: at, end: at }, newText: `${gap}\ntraffic {\n  ${entry}\n}\n` } }];
}

/** The smallest single edit that turns `before` into `after`. */
function diffEdit(before: string, after: string): TextEdit {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  return { range: { start: positionAt(before, start), end: positionAt(before, before.length - end) }, newText: after.slice(start, after.length - end) };
}

function positionAt(text: string, offset: number): Position {
  const before = text.slice(0, offset).split('\n');
  return { line: before.length - 1, character: before[before.length - 1].length };
}

/** `62% · $400/mo` after a node declaration; `saturated` when the node is at or past capacity. */
export interface InlayHint {
  position: Position;
  label: string;
  saturated: boolean;
  /** The hover's load, latency and cost lines. */
  tooltip?: string;
}

const perMonth = (usd: number) => formatUsd(usd).replace('/month', '/mo');

/**
 * Utilisation and monthly cost after each node declared in the document
 * (within `range`, when given); none when the document has no traffic.
 */
export function inlayHints(analysis: Analysis, range?: Range): InlayHint[] {
  const { diagram, lines } = analysis;
  if ((diagram.traffic ?? []).length === 0) return [];
  const sim = new Map(simulationOf(diagram).nodes.map((n) => [n.id, n]));
  return diagram.nodes.flatMap((node) => {
    const n = sim.get(node.id);
    const line = node.loc.line - 1;
    if (node.implicit || node.loc.file !== undefined || !n || n.kind === 'client' || n.kind === 'other') return [];
    if (range && (line < range.start.line || line > range.end.line)) return [];
    return [
      {
        position: { line, character: (lines[line] ?? '').trimEnd().length },
        label: `${formatPercent(n.utilization)}${n.saturated ? ' saturated' : ''} · ${perMonth(n.costUsd)}`,
        saturated: n.saturated,
        tooltip: nodeSimulation(diagram, node.id),
      },
    ];
  });
}

/** A line of simulation results above a use case, a `whatif` block or `requirements`. */
export interface CodeLens {
  range: Range;
  title: string;
}

type Requirement = NonNullable<Diagram['requirements']>[number];
type LatencyRequirement = Extract<Requirement, { kind: 'latency' }>;
const percentileLabel = (r: LatencyRequirement) => (r.percentile === 99.9 ? 'p99.9' : `p${r.percentile}`);

/**
 * `p99 38 ms ✓` above each use case (✗ with the limit it breaks), the
 * requirements and headline numbers of each `whatif` block, and how many
 * requirements pass above each `requirements` block. Only for what the
 * document itself declares.
 */
export function codeLenses(analysis: Analysis): CodeLens[] {
  const { diagram, lines } = analysis;
  const lenses: CodeLens[] = [];
  const at = (line: number, title: string) => lenses.push({ range: { start: { line, character: 0 }, end: { line, character: 0 } }, title });
  const sim = simulationOf(diagram);
  const results = resultsOf(diagram);
  const requirements = diagram.requirements ?? [];
  const resultOf = (i: number) => results.find((r) => r.id === `req:${i + 1}`);

  for (const u of diagram.useCases) {
    const ua = sim.useCases.find((x) => x.id === u.id);
    if (u.loc.file !== undefined || !ua || !Number.isFinite(ua.percentiles.p99)) continue;
    const checks = requirements.flatMap((r, i) => {
      // Only requirements that name the use case: their result is the simulator's verdict on it alone.
      // One without a use case (`p99 < 200ms`) counts on the `requirements` lens only.
      if (r.kind !== 'latency' || r.useCase === undefined || findUseCase(diagram, r.useCase) !== u) return [];
      return [{ r, passed: resultOf(i)?.passed ?? true }];
    });
    const failed = checks.find((c) => !c.passed)?.r;
    const limit = failed && `${failed.percentile === 99 ? '' : `${percentileLabel(failed)} `}< ${formatMs(failed.maxMs)}${failed.scenario !== undefined ? ` in "${failed.scenario}"` : ''}`;
    at(u.loc.line - 1, `p99 ${formatMs(ua.percentiles.p99)}${failed ? ` ✗ (req ${limit})` : checks.length ? ' ✓' : ''}`);
  }

  for (const w of diagram.whatifs?.length ? whatIfsOf(diagram) : []) {
    if (!w.loc || w.loc.file !== undefined) continue;
    const reqs = w.results.filter((r) => !r.id.startsWith('test:'));
    const mark = reqs.length ? `${w.passed ? '✓' : '✗'} ` : '';
    at(w.loc.line - 1, `${mark}${verdict(w.results)} · worst p99 ${formatMs(w.headline.p99Ms)} · ${formatAvailability(w.headline.availability)} · ${perMonth(w.headline.costUsd)}`);
  }

  // Each `requirements {` header of the document, with the requirements up to the next one.
  const headers = lines.flatMap((text, line) => (/^\s*requirements\s*\{/.test(text) ? [line] : []));
  headers.forEach((line, h) => {
    const end = headers[h + 1] ?? Infinity;
    const own = requirements.flatMap((r, i) => (r.loc.file === undefined && r.loc.line - 1 > line && r.loc.line - 1 < end ? [resultOf(i)] : []));
    if (own.length === 0) return;
    const passed = own.filter((r) => r?.passed).length;
    at(line, `${passed === own.length ? '✓' : '✗'} ${passed}/${own.length} requirements pass`);
  });
  return lenses;
}
