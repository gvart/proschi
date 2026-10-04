/**
 * A small Markdown reader for problem statements: headings, paragraphs,
 * bullet and numbered lists, fenced code, inline code, bold, italics and
 * links. It produces a tree that Markdown.tsx renders as React elements, so
 * no HTML from a statement ever reaches the page; anything else is text.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'link'; href: string; children: Inline[] };

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4; children: Inline[] }
  | { kind: 'paragraph'; children: Inline[] }
  | { kind: 'list'; ordered: boolean; items: ListItem[] }
  | { kind: 'code'; lang?: string; text: string };

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

const LIST_ITEM = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/;

export function parseMarkdown(source: string): Block[] {
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
    const fence = /^\s*```\s*([\w-]*)\s*$/.exec(line);
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
      blocks.push({ kind: 'heading', level: heading[1].length as 1 | 2 | 3 | 4, children: parseInline(heading[2]) });
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
