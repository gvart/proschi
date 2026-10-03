import {
  KEYWORDS,
  addConnection,
  componentCatalog,
  parse,
  type Diagnostic,
  type Diagram,
  type DiagramNode,
  type ParseOptions,
  type ParseResult,
  type SourceLoc,
} from './proschi';

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
  let depth = 0;
  for (let i = 0; i < line; i++) {
    const text = lines[i];
    const colon = depth > 0 ? -1 : labelStart(text);
    if (depth === 0 && colon < 0) continue;
    for (const ch of text.slice(colon + 1)) {
      if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') depth = Math.max(0, depth - 1);
    }
  }
  return depth > 0;
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

export type CompletionKind = 'keyword' | 'node' | 'tech';

export interface CompletionItem {
  label: string;
  kind: CompletionKind;
  detail?: string;
  /** LSP snippet syntax, for keywords. */
  snippet?: string;
  /** Text to insert when it differs from the label (tech stacks close their bracket). */
  insertText?: string;
  /** Range the item replaces. */
  range: Range;
}

/** Completions at a position: tech stacks in [ ], keywords at line start, node ids elsewhere. */
export function complete(analysis: Analysis, pos: Position): CompletionItem[] {
  const line = analysis.lines[pos.line] ?? '';
  const before = line.slice(0, pos.character);
  if (insidePayload(analysis.lines, pos.line)) return [];

  const tech = before.match(/\[([^\]]*)$/);
  if (tech) {
    const closed = line[pos.character] === ']';
    const range = { start: { line: pos.line, character: pos.character - tech[1].length }, end: pos };
    return componentCatalog.map((c) => ({
      label: c.techStack,
      kind: 'tech' as const,
      detail: c.category,
      insertText: closed ? c.techStack : `${c.techStack}]`,
      range,
    }));
  }
  if (inLabel(before)) return [];

  const word = before.match(/[A-Za-z_]\w*$/)?.[0] ?? '';
  const range = { start: { line: pos.line, character: pos.character - word.length }, end: pos };
  const atLineStart = /^\s*(\}\s*)?$/.test(before.slice(0, before.length - word.length));
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
  const hit = nodeAt(analysis, pos);
  if (!hit) return [];
  const id = hit.node.id;
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

/** Markdown hover text for the node under the cursor. */
export function hover(analysis: Analysis, pos: Position): { markdown: string; range: Range } | null {
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
  return { markdown: lines.join('\n'), range: hit.range };
}

export interface OutlineSymbol {
  name: string;
  detail?: string;
  kind: 'node' | 'group' | 'usecase' | 'scenario';
  range: Range;
  children: OutlineSymbol[];
}

/** Groups with their members, then use cases with their scenarios; only what this document declares. */
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
  return [...top, ...useCases];
}

export interface TextEdit {
  range: Range;
  newText: string;
}

const MISSING_CONNECTION = /^No connection between '\w+' and '\w+' in the architecture; add '(\w+) -> (\w+)'$/;

/** A quick fix for a parser diagnostic, if it has one: the missing-connection warning adds the connection. */
export function quickFix(analysis: Analysis, message: string): { title: string; edit: TextEdit } | null {
  const m = message.match(MISSING_CONNECTION);
  if (!m) return null;
  const [, from, to] = m;
  const text = analysis.lines.join('\n');
  // addConnection is what the canvas uses too, so the line lands where a drag-to-connect would put it.
  const updated = addConnection(text, from, to);
  if (updated === text) return null;
  return { title: `Add connection '${from} -> ${to}'`, edit: diffEdit(text, updated) };
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
