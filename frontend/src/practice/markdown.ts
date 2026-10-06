/**
 * A small Markdown reader for problem statements and lessons: headings (with
 * stable ids), paragraphs, bullet and numbered lists, fenced code (```proschi
 * is highlighted), GFM pipe tables, `>` blockquotes, inline code, bold,
 * italics and links. It produces a tree that Markdown.tsx (and the static
 * pages, plugins/practicePages.ts) render, so no HTML from a statement ever
 * reaches the page; anything else is text.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'link'; href: string; children: Inline[] };

export type Align = 'left' | 'center' | 'right' | undefined;

export type Block =
  /** `id` is a slug of the text, unique within one parse (`-1`, `-2` for repeats). */
  | { kind: 'heading'; level: 1 | 2 | 3 | 4; id: string; children: Inline[] }
  | { kind: 'paragraph'; children: Inline[] }
  | { kind: 'list'; ordered: boolean; items: ListItem[] }
  | { kind: 'code'; lang?: string; text: string }
  /** A GFM pipe table; every row has as many cells as the header. */
  | { kind: 'table'; align: Align[]; header: Inline[][]; rows: Inline[][][] }
  /** A `>` blockquote, shown as a callout. */
  | { kind: 'quote'; children: Block[] };

/** A list item, with at most one level of nested items. */
export interface ListItem {
  children: Inline[];
  sublist?: { ordered: boolean; items: Inline[][] };
}

interface RawItem {
  text: string;
  sub?: { ordered: boolean; items: string[] };
}

/** Links may go to the web, mail, an anchor or a relative path; `javascript:` and friends stay text. */
export function safeHref(href: string): string | undefined {
  const trimmed = href.trim();
  if (/^(https?:|mailto:)/i.test(trimmed) || /^[#./]/.test(trimmed)) return trimmed;
  return /^[^:]*$/.test(trimmed) && trimmed !== '' ? trimmed : undefined;
}

// Order matters: code spans first (nothing inside them is markup), then links, bold, italics.
const INLINE = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*(.+?)\*\*|__(.+?)__|\*([^*\s][^*]*?)\*|(?<![\w])_([^_\s][^_]*?)_(?![\w])/;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const pushText = (t: string) => {
    if (!t) return;
    const last = out.at(-1);
    if (last?.kind === 'text') last.text += t;
    else out.push({ kind: 'text', text: t });
  };
  let rest = text;
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) {
      pushText(rest);
      break;
    }
    pushText(rest.slice(0, m.index));
    const [whole, code, label, href, strong1, strong2, em1, em2] = m;
    if (code !== undefined) out.push({ kind: 'code', text: code });
    else if (label !== undefined) {
      const safe = safeHref(href);
      if (safe) out.push({ kind: 'link', href: safe, children: parseInline(label) });
      else pushText(label);
    } else if ((strong1 ?? strong2) !== undefined) out.push({ kind: 'strong', children: parseInline(strong1 ?? strong2) });
    else out.push({ kind: 'em', children: parseInline(em1 ?? em2) });
    rest = rest.slice(m.index + whole.length);
  }
  return out;
}

/** The plain text of inline nodes. */
export function inlineText(nodes: Inline[]): string {
  return nodes.map((n) => ('children' in n ? inlineText(n.children) : n.text)).join('');
}

/** The level-2 headings of parsed Markdown with their ids, for a table of contents. */
export function lessonToc(blocks: Block[]): { id: string; text: string }[] {
  return blocks.flatMap((b) => (b.kind === 'heading' && b.level === 2 ? [{ id: b.id, text: inlineText(b.children) }] : []));
}

/** The ids of every heading of a Markdown text, as the page gives them: what a link to a section of a lesson points at. */
export function headingIds(source: string): string[] {
  return parseMarkdown(source).flatMap((b) => (b.kind === 'heading' ? [b.id] : []));
}

/**
 * Heading ids, GitHub style (as the docs pages make them, plugins/docsSite.ts):
 * lowercase, punctuation dropped, spaces to `-`, a repeat gets `-1`, `-2`.
 * One slugger per page keeps its ids unique.
 */
export type Slugger = (text: string) => string;

export function slugger(): Slugger {
  const seen = new Map<string, number>();
  return (text) => {
    const base =
      text
        .toLowerCase()
        .trim()
        .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
        .replace(/\s/g, '-') || 'section';
    const n = seen.get(base);
    seen.set(base, (n ?? -1) + 1);
    return n === undefined ? base : `${base}-${n + 1}`;
  };
}

/** The cells of a table row: split on `|` (not `\|`), outer pipes optional. */
function splitRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  const cells: string[] = [];
  let cell = '';
  for (let i = 0; i < row.length; i++) {
    if (row[i] === '\\' && row[i + 1] === '|') {
      cell += '|';
      i++;
    } else if (row[i] === '|') {
      cells.push(cell.trim());
      cell = '';
    } else cell += row[i];
  }
  cells.push(cell.trim());
  return cells;
}

const DELIMITER_CELL = /^:?-+:?$/;

/** The alignments of a table's delimiter row (`| --- | :-: |`), or undefined when the line is not one. */
function delimiterRow(line: string): Align[] | undefined {
  if (!line.includes('-') || !/^[\s|:-]+$/.test(line)) return undefined;
  const cells = splitRow(line);
  if (!cells.every((c) => DELIMITER_CELL.test(c))) return undefined;
  return cells.map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : undefined));
}

const LIST_ITEM = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/;
const FENCE = /^\s*```\s*([\w-]*)(?:\s+[\w-]+)*\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;

/** Parses Markdown into blocks. Pass one `slug` to several parses that share a page, so their heading ids stay unique. */
export function parseMarkdown(source: string, slug: Slugger = slugger()): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: RawItem[] } | undefined;

  const flush = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', children: parseInline(paragraph.join(' ')) });
    if (list) {
      const items = list.items.map((item) => ({
        children: parseInline(item.text),
        ...(item.sub ? { sublist: { ordered: item.sub.ordered, items: item.sub.items.map(parseInline) } } : {}),
      }));
      blocks.push({ kind: 'list', ordered: list.ordered, items });
    }
    paragraph = [];
    list = undefined;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      while (++i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i]);
      blocks.push({ kind: 'code', ...(fence[1] ? { lang: fence[1] } : {}), text: body.join('\n') });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = /^(#{1,4})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      const children = parseInline(heading[2]);
      blocks.push({ kind: 'heading', level: heading[1].length as 1 | 2 | 3 | 4, id: slug(inlineText(children)), children });
      continue;
    }
    if (QUOTE.test(line)) {
      // The quote runs to the first line without `>`; inside it is Markdown again.
      flush();
      const body: string[] = [];
      for (; i < lines.length && QUOTE.test(lines[i]); i++) body.push(QUOTE.exec(lines[i])![1]);
      i--;
      blocks.push({ kind: 'quote', children: parseMarkdown(body.join('\n'), slug) });
      continue;
    }
    const align = line.includes('|') && i + 1 < lines.length ? delimiterRow(lines[i + 1]) : undefined;
    if (align && splitRow(line).length === align.length && !list) {
      // A GFM table: header, delimiter, then rows up to a blank line or the start of another block.
      flush();
      const width = align.length;
      const fit = (cells: string[]) => Array.from({ length: width }, (_, k) => parseInline(cells[k] ?? ''));
      const header = fit(splitRow(line));
      const rows: Inline[][][] = [];
      const endsTable = (l: string) => !l.trim() || FENCE.test(l) || QUOTE.test(l) || /^#{1,4}\s/.test(l);
      for (i += 2; i < lines.length && !endsTable(lines[i]); i++) rows.push(fit(splitRow(lines[i])));
      i--;
      blocks.push({ kind: 'table', align, header, rows });
      continue;
    }
    const item = LIST_ITEM.exec(line);
    const ordered = item?.[2] !== undefined;
    const last = list?.items.at(-1);
    if (item && last && line.search(/\S/) >= 2) {
      // An indented item nests under the previous one.
      last.sub ??= { ordered, items: [] };
      last.sub.items.push(item[3]);
      continue;
    }
    if (item) {
      if (paragraph.length || (list && list.ordered !== ordered)) flush();
      list ??= { ordered, items: [] };
      list.items.push({ text: item[3] });
      continue;
    }
    // A plain line continues the last item (or nested item), or the paragraph.
    if (last?.sub) last.sub.items[last.sub.items.length - 1] += ` ${line.trim()}`;
    else if (last) last.text += ` ${line.trim()}`;
    else paragraph.push(line.trim());
  }
  flush();
  return blocks;
}
