/**
 * The small Markdown structure interview.md and guided.md share: headings
 * that start items, each item opened by a list of `- key: value` lines (its
 * settings) and followed by Markdown (its text). Headings inside fenced code
 * blocks do not count. Pure, like the rest of the practice file readers.
 *
 *   ### How many redirects a second at peak?
 *   - kind: good
 *   - fact: 10k rps
 *
 *   The text, any Markdown.
 */

/** A problem in one of these files, with its 1-based line when there is one. */
export interface FileIssue {
  message: string;
  line?: number;
}

export interface MetaLine {
  key: string;
  value: string;
  line: number;
}

export interface MdItem {
  /** The heading's text. */
  title: string;
  /** 1-based line of the heading. */
  line: number;
  /** The `- key: value` lines right under the heading, in order. */
  meta: MetaLine[];
  /** The Markdown after them, trimmed. */
  body: string;
}

export interface MdPart {
  title: string;
  line: number;
  /** The lines under the heading, up to the next heading of the same or a higher level. */
  lines: { text: string; line: number }[];
}

/** Splits lines at headings of `level` (2 for `##`); text before the first heading is `preamble`. Deeper headings stay inside a part. */
export function splitAt(lines: { text: string; line: number }[], level: number): { preamble: { text: string; line: number }[]; parts: MdPart[] } {
  const heading = new RegExp(`^#{${level}}\\s+(.*?)\\s*#*\\s*$`);
  const preamble: { text: string; line: number }[] = [];
  const parts: MdPart[] = [];
  let fence = false;
  for (const l of lines) {
    if (/^\s*```/.test(l.text)) fence = !fence;
    const m = fence ? null : heading.exec(l.text);
    if (m) parts.push({ title: m[1], line: l.line, lines: [] });
    else if (parts.length) parts[parts.length - 1].lines.push(l);
    else preamble.push(l);
  }
  return { preamble, parts };
}

/** The lines of a text with their 1-based numbers. */
export function numberedLines(text: string): { text: string; line: number }[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((t, i) => ({ text: t, line: i + 1 }));
}

const META = /^-\s+([a-z][a-z-]*)\s*:\s*(.*?)\s*$/;

/** An item: its heading, the `- key: value` lines that open it, and the Markdown after them. */
export function readItem(part: MdPart): MdItem {
  const meta: MetaLine[] = [];
  let i = 0;
  while (i < part.lines.length && part.lines[i].text.trim() === '') i++;
  for (; i < part.lines.length; i++) {
    const m = META.exec(part.lines[i].text);
    if (!m) break;
    meta.push({ key: m[1], value: m[2], line: part.lines[i].line });
  }
  const body = part.lines
    .slice(i)
    .map((l) => l.text)
    .join('\n')
    .trim();
  return { title: part.title, line: part.line, meta, body };
}

/** Whether a preamble holds anything but blank lines. */
export function hasText(lines: { text: string }[]): boolean {
  return lines.some((l) => l.text.trim() !== '');
}

/**
 * The settings of an item as a map, reporting keys that are not in `known`
 * and keys given twice (except those in `repeatable`, collected in order).
 */
export function metaOf(item: MdItem, known: readonly string[], issues: FileIssue[], repeatable: readonly string[] = []): Map<string, MetaLine[]> {
  const out = new Map<string, MetaLine[]>();
  for (const m of item.meta) {
    if (!known.includes(m.key)) {
      issues.push({ message: `"${item.title}": unknown setting "${m.key}" (use ${known.join(', ')})`, line: m.line });
      continue;
    }
    const list = out.get(m.key) ?? [];
    if (list.length && !repeatable.includes(m.key)) {
      issues.push({ message: `"${item.title}": "${m.key}" is given twice`, line: m.line });
      continue;
    }
    list.push(m);
    out.set(m.key, list);
  }
  return out;
}
