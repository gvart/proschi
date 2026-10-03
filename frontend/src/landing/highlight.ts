/**
 * A tiny, display-only highlighter for Proschi snippets on the landing page.
 * It does not try to be the real lexer (that lives in ../dsl/lexer.ts and pulls
 * in the component catalog); it only needs to make short examples readable.
 */

export type TokenClass = 'keyword' | 'string' | 'tech' | 'team' | 'arrow' | 'comment' | 'status';

export interface Segment {
  text: string;
  cls?: TokenClass;
}

const TOKEN =
  /("(?:[^"\\]|\\.)*")|(\[[A-Za-z][^\]"]*\])|(@[A-Za-z_][\w-]*)|(-->|->>|->|-x(?!\w))|((?:^\s*|\}\s*)(?:title|import|group|usecase|par|alt)\b)|((?:^|\s)#.*$)|(\b[1-5]\d\d\b)/g;

const CLASSES: TokenClass[] = ['string', 'tech', 'team', 'arrow', 'keyword', 'comment', 'status'];

export function highlightLine(line: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of line.matchAll(TOKEN)) {
    const index = m.index ?? 0;
    const group = m.slice(1).findIndex((g) => g !== undefined);
    if (index > last) out.push({ text: line.slice(last, index) });
    out.push({ text: m[0], cls: CLASSES[group] });
    last = index + m[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last) });
  return out;
}

/** Replaces the text of a `<pre><code>` with one highlighted block per line. */
export function highlightElement(code: HTMLElement): string[] {
  const source = code.textContent ?? '';
  const lines = source.split('\n');
  const frag = document.createDocumentFragment();
  for (const line of lines) {
    const row = document.createElement('span');
    row.className = 'line';
    for (const seg of highlightLine(line)) {
      if (!seg.cls) {
        row.append(seg.text);
        continue;
      }
      const span = document.createElement('span');
      span.className = `tok-${seg.cls}`;
      span.textContent = seg.text;
      row.append(span);
    }
    frag.append(row);
  }
  code.replaceChildren(frag);
  return lines;
}
