import type { Diagnostic } from './types';

export type TokenKind =
  | 'ident'   // gateway, group, usecase
  | 'string'  // "API Gateway"
  | 'tech'    // [AWS Lambda]
  | 'team'    // @Platform
  | 'arrow'   // -> ->> --> -x
  | 'label'   // everything after ':' on an edge/step line
  | 'number'  // 120, -40
  | 'quantity' // 50ms, 99.9%, 100k rps, 2.5: a number with a fraction or a unit (see quantity.ts)
  | 'op'      // < <= > >=
  | 'comma'
  | 'lbrace'
  | 'rbrace';

export interface Token {
  kind: TokenKind;
  /** Unquoted / unbracketed value. */
  value: string;
  /** 1-based column of the token's first character. */
  col: number;
  /** Length of the token in the source. */
  length: number;
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;
const TEAM_PART = /[A-Za-z0-9_-]/;
const DIGIT = /[0-9]/;
const LETTER = /[A-Za-z]/;
/** Units that may follow a number after a space: `50 ms`, `100k rps`, `99.9 %`, `500 MB/s`, `0.05 usd/GB`. */
const SEPARATE_UNIT = /^[ \t]+(rps|rpm|rpd|ms|s|%|usd\/month|usd\/GB|MB\/s|GB\/s)(?![A-Za-z0-9_/])/;

/**
 * Tokenizes a single source line. The language is line-oriented, so each line
 * is lexed independently; an error on one line never affects the next.
 */
export function tokenizeLine(text: string, line: number): { tokens: Token[]; diagnostics: Diagnostic[] } {
  const tokens: Token[] = [];
  const diagnostics: Diagnostic[] = [];
  let i = 0;

  const error = (message: string, col: number, length: number) =>
    diagnostics.push({ severity: 'error', message, line, col, length });

  while (i < text.length) {
    const ch = text[i];

    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i++;
      continue;
    }

    // A comment starts wherever a token could start.
    if (ch === '#') break;

    const start = i;

    if (ch === ':') {
      const raw = stripTrailingComment(text.slice(i + 1));
      tokens.push({ kind: 'label', value: raw.trim(), col: start + 1, length: text.length - start });
      break;
    }

    if (ch === '"') {
      const { value, end, closed } = readString(text, i);
      if (!closed) error('Unterminated string', start + 1, text.length - start);
      tokens.push({ kind: 'string', value, col: start + 1, length: end - start });
      i = end;
      continue;
    }

    if (ch === '[') {
      const close = text.indexOf(']', i + 1);
      if (close === -1) {
        error('Missing ] after tech stack', start + 1, text.length - start);
        tokens.push({ kind: 'tech', value: text.slice(i + 1).trim(), col: start + 1, length: text.length - start });
        break;
      }
      tokens.push({ kind: 'tech', value: text.slice(i + 1, close).trim(), col: start + 1, length: close + 1 - start });
      i = close + 1;
      continue;
    }

    if (ch === '-') {
      const arrow = ['->>', '-->', '->'].find((a) => text.startsWith(a, i));
      // `-x` (a failed call) must not swallow the start of an id such as `-xray`.
      const failed = text.startsWith('-x', i) && !IDENT_PART.test(text[i + 2] ?? '');
      if (arrow || failed) {
        const value = arrow ?? '-x';
        tokens.push({ kind: 'arrow', value, col: start + 1, length: value.length });
        i += value.length;
        continue;
      }
      if (DIGIT.test(text[i + 1] ?? '')) {
        i++;
        while (i < text.length && DIGIT.test(text[i])) i++;
        tokens.push({ kind: 'number', value: text.slice(start, i), col: start + 1, length: i - start });
        continue;
      }
    }

    if (DIGIT.test(ch)) {
      i = readQuantity(text, i);
      const value = text.slice(start, i).replace(/[ \t]+/g, '');
      // Plain integers stay numbers, so `pos 10,-20` reads as before.
      const kind = /^\d+$/.test(value) ? 'number' : 'quantity';
      tokens.push({ kind, value, col: start + 1, length: i - start });
      continue;
    }

    if (ch === '<' || ch === '>') {
      const value = text[i + 1] === '=' ? ch + '=' : ch;
      tokens.push({ kind: 'op', value, col: start + 1, length: value.length });
      i += value.length;
      continue;
    }

    if (ch === '@') {
      i++;
      while (i < text.length && TEAM_PART.test(text[i])) i++;
      if (i === start + 1) error('Expected a team name after @', start + 1, 1);
      tokens.push({ kind: 'team', value: text.slice(start + 1, i), col: start + 1, length: i - start });
      continue;
    }

    if (IDENT_START.test(ch)) {
      while (i < text.length && IDENT_PART.test(text[i])) i++;
      tokens.push({ kind: 'ident', value: text.slice(start, i), col: start + 1, length: i - start });
      continue;
    }

    if (ch === '{' || ch === '}' || ch === ',') {
      const kind = ch === '{' ? 'lbrace' : ch === '}' ? 'rbrace' : 'comma';
      tokens.push({ kind, value: ch, col: start + 1, length: 1 });
      i++;
      continue;
    }

    error(`Unexpected character '${ch}'`, start + 1, 1);
    i++;
  }

  return { tokens, diagnostics };
}

/**
 * Reads a number starting at `start` with an optional fraction and unit:
 * `120`, `2.5`, `50ms`, `99.9%`, `100krps`, `3000usd/month`, `500MB/s`, or with the unit
 * one space away (`100k rps`). Returns the index after it. What the unit means
 * is checked by the parser (quantity.ts), so `5xyz` is one token it can name.
 */
function readQuantity(text: string, start: number): number {
  let i = start;
  while (i < text.length && DIGIT.test(text[i])) i++;
  if (text[i] === '.' && DIGIT.test(text[i + 1] ?? '')) {
    i++;
    while (i < text.length && DIGIT.test(text[i])) i++;
  }
  const suffixStart = i;
  if (text[i] === '%') return i + 1;
  while (i < text.length && LETTER.test(text[i])) i++;
  if (i > suffixStart && text[i] === '/' && LETTER.test(text[i + 1] ?? '')) {
    i++;
    while (i < text.length && LETTER.test(text[i])) i++;
  }
  // Only a bare number or a magnitude (`100k`) can take a unit after a space.
  if (/^[kmb]?$/.test(text.slice(suffixStart, i))) {
    const unit = SEPARATE_UNIT.exec(text.slice(i));
    if (unit) i += unit[0].length;
  }
  return i;
}

function readString(text: string, start: number): { value: string; end: number; closed: boolean } {
  let value = '';
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\' && i + 1 < text.length) {
      value += text[i + 1];
      i += 2;
      continue;
    }
    if (ch === '"') return { value, end: i + 1, closed: true };
    value += ch;
    i++;
  }
  return { value, end: text.length, closed: false };
}

/**
 * Removes a trailing `# comment` from a label. A '#' only starts a comment when
 * it follows whitespace and sits outside quotes and JSON brackets, so payloads
 * such as `{"tag": "#1"}` survive.
 */
export function stripTrailingComment(text: string): string {
  let depth = 0;
  let quote: '"' | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"') quote = ch;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === '#' && depth === 0 && (i === 0 || /\s/.test(text[i - 1]))) return text.slice(0, i);
  }
  return text;
}

/** Net count of unclosed `{` / `[` outside string literals. */
export function bracketDepth(text: string): number {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
  }
  return depth;
}
