/**
 * The front matter of a problem's problem.md: a small, strict subset of YAML
 * between two `---` lines, then the Markdown body.
 *
 * ```
 * ---
 * title: URL Shortener
 * difficulty: easy
 * tags: [caching, read-heavy]
 * order: 2
 * hints:
 *   - A nudge
 *   - "Nearly the answer: quote values with ': ' or ' #' in them"
 * ---
 * Statement…
 * ```
 *
 * Values are plain strings, "double-quoted" (JSON escapes) or 'single-quoted'
 * ('' is a quote) strings, numbers, flow lists `[a, "b"]` and block lists of
 * `  - item` lines. Anything a YAML parser could read differently (a plain
 * value with `: ` or ` #`, starting with an indicator, or reading as a
 * boolean/null) is an error, so every file this accepts means the same in YAML.
 */

export type FrontMatterValue = string | number | string[];

export interface FrontMatter {
  data: Record<string, FrontMatterValue>;
  /** The Markdown after the closing `---`, without leading and trailing blank space. */
  body: string;
}

export class FrontMatterError extends Error {
  /** 1-based line in the file. */
  readonly line: number;
  constructor(message: string, line: number) {
    super(`line ${line}: ${message}`);
    this.name = 'FrontMatterError';
    this.line = line;
  }
}

const KEY = /^([A-Za-z][A-Za-z0-9_-]*):(?:[ \t]+(.*))?$/;
const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const AMBIGUOUS = /^(?:true|false|yes|no|on|off|null|~)$/i;
const INDICATORS = '-?:,[]{}#&*!|>\'"%@`';

/** Whether `s` can be written as a plain YAML scalar that reads back as this exact string. */
export function isPlainSafe(s: string, inFlow = false): boolean {
  if (s === '' || s !== s.trim() || /[\n\r\t]/.test(s)) return false;
  if (INDICATORS.includes(s[0]) || s.includes(': ') || s.includes(' #') || s.endsWith(':')) return false;
  if (NUMBER.test(s) || AMBIGUOUS.test(s)) return false;
  return !(inFlow && /[,[\]{}]/.test(s));
}

/** `s` as a front matter value: plain when that is safe, else double-quoted. */
export function frontMatterString(s: string): string {
  return isPlainSafe(s) ? s : JSON.stringify(s);
}

/** Reads one scalar (the whole of `text`). */
function scalar(text: string, line: number, inFlow: boolean): string | number {
  if (text.startsWith('"')) {
    if (!/^"(?:[^"\\]|\\.)*"$/.test(text)) throw new FrontMatterError(`Unterminated or malformed double-quoted string: ${text}`, line);
    try {
      return JSON.parse(text) as string;
    } catch {
      throw new FrontMatterError(`Invalid escape in double-quoted string: ${text}`, line);
    }
  }
  if (text.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(text)) throw new FrontMatterError(`Unterminated or malformed single-quoted string: ${text}`, line);
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (NUMBER.test(text)) return Number(text);
  if (!isPlainSafe(text, inFlow)) throw new FrontMatterError(`Ambiguous value ${JSON.stringify(text)}; put it in double quotes`, line);
  return text;
}

function stringItem(text: string, line: number, inFlow: boolean): string {
  const value = scalar(text, line, inFlow);
  if (typeof value !== 'string') throw new FrontMatterError(`List items must be strings; quote ${text}`, line);
  return value;
}

/** Splits the inside of `[a, "b, c"]` at top-level commas. */
function flowItems(inner: string, line: number): string[] {
  const items: string[] = [];
  let current = '';
  let quote: string | undefined;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quote) {
      current += c;
      if (quote === '"' && c === '\\') current += inner[++i] ?? '';
      else if (c === quote) {
        if (quote === "'" && inner[i + 1] === "'") current += inner[++i];
        else quote = undefined;
      }
    } else if (c === '"' || c === "'") {
      quote = c;
      current += c;
    } else if (c === ',') {
      items.push(current.trim());
      current = '';
    } else current += c;
  }
  if (quote) throw new FrontMatterError('Unterminated string in list', line);
  if (current.trim() !== '' || items.length > 0) items.push(current.trim());
  if (items.some((item) => item === '')) throw new FrontMatterError('Empty item in list', line);
  return items.map((item) => stringItem(item, line, true));
}

/** Parses `---` front matter and the body after it. Throws FrontMatterError with the line of the first problem. */
export function parseFrontMatter(text: string): FrontMatter {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines[0] !== '---') throw new FrontMatterError('The file must start with a line "---"', 1);
  const end = lines.indexOf('---', 1);
  if (end < 0) throw new FrontMatterError('No closing "---" line after the front matter', 1);

  const data: Record<string, FrontMatterValue> = {};
  let list: { key: string; items: string[] } | undefined;
  for (let i = 1; i < end; i++) {
    const raw = lines[i];
    const line = i + 1;
    if (raw.trim() === '' || /^\s*#/.test(raw)) continue;
    if (/\t/.test(raw.match(/^\s*/)![0])) throw new FrontMatterError('Indent with spaces, not tabs', line);
    const item = raw.match(/^ +- (.*)$/) ?? raw.match(/^ +-()$/);
    if (item) {
      if (!list) throw new FrontMatterError('A list item must follow a key with no value, e.g. "hints:"', line);
      const value = item[1].trim();
      if (value === '') throw new FrontMatterError('Empty list item', line);
      list.items.push(stringItem(value, line, false));
      continue;
    }
    if (/^\s/.test(raw)) throw new FrontMatterError(`Unexpected indented line: ${raw.trim()}`, line);
    list = undefined;
    const m = raw.match(KEY);
    if (!m) throw new FrontMatterError(`Expected "key: value", got: ${raw}`, line);
    const [, key, rest] = m;
    if (Object.prototype.hasOwnProperty.call(data, key)) throw new FrontMatterError(`Duplicate key '${key}'`, line);
    const value = (rest ?? '').trim();
    if (value === '') {
      list = { key, items: [] };
      data[key] = list.items;
    } else if (value.startsWith('[')) {
      if (!value.endsWith(']')) throw new FrontMatterError(`A list must close on the same line: ${value}`, line);
      data[key] = flowItems(value.slice(1, -1), line);
    } else {
      data[key] = scalar(value, line, false);
    }
  }
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value) && value.length === 0) {
      const line = lines.findIndex((l, i) => i > 0 && i < end && l.startsWith(`${key}:`)) + 1;
      throw new FrontMatterError(`'${key}' has no value`, line);
    }
  }
  return { data, body: lines.slice(end + 1).join('\n').trim() };
}
