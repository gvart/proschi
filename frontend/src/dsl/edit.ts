import { tokenizeLine, type Token } from './lexer';
import { parse } from './parser';
import type { DiagramNode } from './types';

/**
 * Source-to-source edits used when the diagram is changed on the canvas. Each
 * edit touches as little text as possible so comments and formatting survive.
 */

export function setNodePosition(source: string, id: string, position: { x: number; y: number }): string {
  const pos = `pos ${Math.round(position.x)},${Math.round(position.y)}`;
  const decl = findDeclaration(source, id);
  if (!decl) return insertDeclaration(source, `${id} ${pos}`);

  const { tokens, lineText, firstProp } = decl;
  const at = tokens.findIndex((t, i) => i >= firstProp && t.kind === 'ident' && t.value === 'pos');
  if (at !== -1 && tokens[at + 3]?.kind === 'number') {
    return replaceInLine(source, decl.line, tokens[at].col - 1, end(tokens[at + 3]), pos);
  }

  const brace = tokens.findIndex((t) => t.kind === 'lbrace');
  if (decl.node.kind === 'group' && brace !== -1) {
    return replaceInLine(source, decl.line, tokens[brace].col - 1, tokens[brace].col - 1, `${pos} `);
  }
  const last = end(tokens[tokens.length - 1]);
  return replaceInLine(source, decl.line, last, last, ` ${pos}`, lineText);
}

export function renameNode(source: string, id: string, name: string): string {
  const clean = name.replace(/[\r\n]+/g, ' ').trim();
  if (!clean) return source;
  const quoted = `"${clean.replace(/[\\"]/g, '\\$&')}"`;
  const decl = findDeclaration(source, id);
  if (!decl) return insertDeclaration(source, `${id} ${quoted}`);

  const { tokens, firstProp } = decl;
  const current = tokens[firstProp];
  if (current?.kind === 'string') return replaceInLine(source, decl.line, current.col - 1, end(current), quoted);
  const idToken = tokens[firstProp - 1];
  return replaceInLine(source, decl.line, end(idToken), end(idToken), ` ${quoted}`);
}

export function addConnection(source: string, from: string, to: string): string {
  if (from === to) return source;
  const { diagram } = parse(source);
  if (diagram.edges.some((e) => e.source === from && e.target === to)) return source;
  return insertDeclaration(source, `${from} -> ${to}`);
}

/** Removes every `pos x,y` so the whole diagram is auto-laid-out again. */
export function clearPositions(source: string): string {
  const { diagram } = parse(source);
  let result = source;
  const pinned = diagram.nodes.filter((n) => n.position && !n.implicit).sort((a, b) => b.loc.line - a.loc.line);
  for (const node of pinned) {
    const decl = findDeclaration(result, node.id);
    if (!decl) continue;
    const { tokens, firstProp } = decl;
    const at = tokens.findIndex((t, i) => i >= firstProp && t.kind === 'ident' && t.value === 'pos');
    if (at === -1 || tokens[at + 3]?.kind !== 'number') continue;
    const prev = tokens[at - 1];
    const next = tokens[at + 4];
    // Remove the space before `pos` too, unless `pos` sits right before `{`.
    const from = next?.kind === 'lbrace' ? tokens[at].col - 1 : end(prev);
    const to = next?.kind === 'lbrace' ? next.col - 1 : end(tokens[at + 3]);
    result = replaceInLine(result, decl.line, from, to, '');
  }
  return result;
}

interface Declaration {
  node: DiagramNode;
  line: number;
  lineText: string;
  tokens: Token[];
  /** Index of the first token after the id. */
  firstProp: number;
}

function findDeclaration(source: string, id: string): Declaration | null {
  const node = parse(source).diagram.nodes.find((n) => n.id === id && !n.implicit);
  if (!node) return null;
  const lineText = source.split('\n')[node.loc.line - 1] ?? '';
  const { tokens } = tokenizeLine(lineText, node.loc.line);
  const idIndex = tokens.findIndex((t) => t.kind === 'ident' && t.value === id && t.col === node.loc.col);
  if (idIndex === -1) return null;
  return { node, line: node.loc.line, lineText, tokens, firstProp: idIndex + 1 };
}

/** Adds a line before the first use case (they must stay last), or at the end. */
function insertDeclaration(source: string, text: string): string {
  const lines = source.split('\n');
  const useCaseLine = parse(source).diagram.useCases[0]?.loc.line;
  if (useCaseLine) {
    // Go above the blank lines that separate declarations from use cases.
    let at = useCaseLine - 1;
    while (at > 0 && lines[at - 1].trim() === '') at--;
    lines.splice(at, 0, text);
    return lines.join('\n');
  }
  if (source === '') return `${text}\n`;
  return source.endsWith('\n') ? `${source}${text}\n` : `${source}\n${text}\n`;
}

function replaceInLine(source: string, line: number, from: number, to: number, insert: string, lineText?: string): string {
  const lines = source.split('\n');
  const text = lineText ?? lines[line - 1];
  lines[line - 1] = text.slice(0, from) + insert + text.slice(to);
  return lines.join('\n');
}

function end(token: Token): number {
  return token.col - 1 + token.length;
}
