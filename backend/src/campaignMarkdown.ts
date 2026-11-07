import { COLORS, escapeHtml, SANS } from './emailLayout';

/**
 * The Markdown of a campaign email's body (src/campaigns.ts), rendered for
 * mail clients: every style inline, like src/emailLayout.ts. A small subset:
 * paragraphs (a single line break is kept), `#`–`###` headings, `-`/`*`/`1.`
 * lists, **bold**, *italic* or _italic_, `code`, and [links](https://…)
 * (https: and mailto: only; any other link stays as text). Everything is
 * escaped first: HTML in the source shows as text, never as markup.
 *
 * Placeholders ({{name}}, {{credits}}) are filled in after rendering, each
 * value escaped, so a display name can't add markup or links.
 */

export const PLACEHOLDERS = ['name', 'credits'] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];
export type Values = Record<Placeholder, string>;

/** The {{…}} in `text` that are not placeholders, e.g. ["{{nmae}}"]. */
export function unknownPlaceholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)].filter((m) => !(PLACEHOLDERS as readonly string[]).includes(m[1])).map((m) => m[0]);
}

/** `text` with each {{placeholder}} replaced by `escape(value)`. */
export function fill(text: string, values: Values, escape: (v: string) => string = (v) => v): string {
  return text.replace(/\{\{\s*(name|credits)\s*\}\}/g, (_, key: Placeholder) => escape(values[key]));
}

const SAFE_URL = /^(https:\/\/|mailto:)[^\s<>"']+$/i;
const LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

/** Bold, italic and code on already-escaped text. */
function format(escaped: string): string {
  return escaped
    .replace(/`([^`\n]+)`/g, `<code style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:14px;background:${COLORS.paper};padding:1px 4px;">$1</code>`)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
}

function inlineHtml(raw: string): string {
  let out = '';
  let last = 0;
  for (const m of raw.matchAll(LINK)) {
    out += format(escapeHtml(raw.slice(last, m.index)));
    out += SAFE_URL.test(m[2])
      ? `<a href="${escapeHtml(m[2])}" target="_blank" style="color:${COLORS.ink};font-weight:700;text-decoration:underline;">${format(escapeHtml(m[1]))}</a>`
      : format(escapeHtml(m[0]));
    last = m.index + m[0].length;
  }
  return out + format(escapeHtml(raw.slice(last)));
}

function inlineText(raw: string): string {
  return raw
    .replace(LINK, (whole, label: string, url: string) => (SAFE_URL.test(url) ? `${label} (${url})` : whole))
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1');
}

type Block = { type: 'heading'; level: number; text: string } | { type: 'list'; ordered: boolean; items: string[] } | { type: 'para'; lines: string[] };

const ITEM = /^\s*(?:([-*])|(\d+)[.)])\s+(.*)$/;

function blocks(source: string): Block[] {
  const out: Block[] = [];
  for (const chunk of source.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const lines = chunk.split('\n').filter((l) => l.trim() !== '');
    if (!lines.length) continue;
    let para: string[] = [];
    let list: Extract<Block, { type: 'list' }> | undefined;
    const flush = () => {
      if (para.length) out.push({ type: 'para', lines: para });
      para = [];
      list = undefined;
    };
    for (const line of lines) {
      const heading = /^(#{1,3})\s+(.*)$/.exec(line.trim());
      const item = ITEM.exec(line);
      if (heading) {
        flush();
        out.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      } else if (item) {
        if (para.length) flush();
        const ordered = item[2] !== undefined;
        if (!list || list.ordered !== ordered) {
          list = { type: 'list', ordered, items: [] };
          out.push(list);
        }
        list.items.push(item[3]);
      } else if (list) {
        // A continuation line belongs to the item above it.
        list.items[list.items.length - 1] += ` ${line.trim()}`;
      } else para.push(line.trim());
    }
    flush();
  }
  return out;
}

const P = `margin:0 0 14px;font-family:${SANS};font-size:16px;line-height:1.55;color:${COLORS.ink};`;

/** The body as email HTML and as plain text, placeholders filled in with `values`. */
export function renderMarkdown(source: string, values: Values): { html: string; text: string } {
  const html: string[] = [];
  const text: string[] = [];
  for (const b of blocks(source)) {
    if (b.type === 'heading') {
      const size = b.level === 1 ? 22 : b.level === 2 ? 19 : 17;
      html.push(`<p style="margin:18px 0 8px;font-family:${SANS};font-size:${size}px;line-height:1.3;font-weight:800;color:${COLORS.ink};">${inlineHtml(b.text)}</p>`);
      text.push(inlineText(b.text).toUpperCase());
    } else if (b.type === 'list') {
      const tag = b.ordered ? 'ol' : 'ul';
      html.push(
        `<${tag} style="margin:0 0 14px;padding:0 0 0 22px;font-family:${SANS};font-size:16px;line-height:1.55;color:${COLORS.ink};">` +
          b.items.map((i) => `<li style="margin:0 0 6px;">${inlineHtml(i)}</li>`).join('') +
          `</${tag}>`,
      );
      text.push(b.items.map((i, n) => `${b.ordered ? `${n + 1}.` : '-'} ${inlineText(i)}`).join('\n'));
    } else {
      html.push(`<p style="${P}">${b.lines.map(inlineHtml).join('<br>')}</p>`);
      text.push(b.lines.map(inlineText).join('\n'));
    }
  }
  return { html: fill(html.join(''), values, escapeHtml), text: fill(text.join('\n\n'), values) };
}
