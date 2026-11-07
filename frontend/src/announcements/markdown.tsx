import { Fragment, type ReactNode } from 'react';

/**
 * The Markdown of a campaign (backend/src/campaignMarkdown.ts renders the
 * same subset for email) as React elements: paragraphs, `#`–`###`
 * headings, `-`/`*`/`1.` lists, **bold**, *italic* or _italic_, `code`, and
 * [links](https://…) (https: and mailto: only). No HTML is ever parsed:
 * everything is text React escapes. Placeholders ({{name}}, {{credits}}) are
 * filled in the text, after parsing, so a name can't add a link.
 */

export type Values = Record<'name' | 'credits', string>;

const SAFE_URL = /^(https:\/\/|mailto:)[^\s<>"']+$/i;
const INLINE = /\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|`([^`\n]+)`|(?<![\w*])\*([^*\n]+)\*(?!\w)|(?<!\w)_([^_\n]+)_(?!\w)/g;

const fill = (text: string, values: Values) => text.replace(/\{\{\s*(name|credits)\s*\}\}/g, (_, key: keyof Values) => values[key]);

function inline(raw: string, values: Values, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of raw.matchAll(INLINE)) {
    if (m.index > last) out.push(fill(raw.slice(last, m.index), values));
    const k = `${key}-${n++}`;
    if (m[1] !== undefined) {
      out.push(
        SAFE_URL.test(m[2]) ? (
          <a key={k} href={fill(m[2], values)} target="_blank" rel="noreferrer">
            {inline(m[1], values, k)}
          </a>
        ) : (
          fill(m[0], values)
        ),
      );
    } else if (m[3] !== undefined) out.push(<strong key={k}>{fill(m[3], values)}</strong>);
    else if (m[4] !== undefined) out.push(<code key={k}>{fill(m[4], values)}</code>);
    else out.push(<em key={k}>{fill(m[5] ?? m[6], values)}</em>);
    last = m.index + m[0].length;
  }
  if (last < raw.length) out.push(fill(raw.slice(last), values));
  return out;
}

type Block = { type: 'heading'; level: number; text: string } | { type: 'list'; ordered: boolean; items: string[] } | { type: 'para'; lines: string[] };

const ITEM = /^\s*(?:([-*])|(\d+)[.)])\s+(.*)$/;

function blocks(source: string): Block[] {
  const out: Block[] = [];
  for (const chunk of source.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    let para: string[] = [];
    let list: Extract<Block, { type: 'list' }> | undefined;
    const flush = () => {
      if (para.length) out.push({ type: 'para', lines: para });
      para = [];
      list = undefined;
    };
    for (const line of chunk.split('\n').filter((l) => l.trim() !== '')) {
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
      } else if (list) list.items[list.items.length - 1] += ` ${line.trim()}`;
      else para.push(line.trim());
    }
    flush();
  }
  return out;
}

/** The body as elements; `className` per kind of block comes from the caller's styles. */
export function Markdown({ source, values }: { source: string; values: Values }) {
  return (
    <>
      {blocks(source).map((b, i) => {
        const key = String(i);
        if (b.type === 'heading') return <p key={key} className="ann-md-heading">{inline(b.text, values, key)}</p>;
        if (b.type === 'list') {
          const items = b.items.map((item, j) => <li key={j}>{inline(item, values, `${key}-${j}`)}</li>);
          return b.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
        }
        return (
          <p key={key}>
            {b.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(line, values, `${key}-${j}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}
