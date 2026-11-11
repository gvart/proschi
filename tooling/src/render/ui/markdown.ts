import type { Block, Column, Rich, Span } from './contract';

/**
 * Markdown as the UI kit's blocks: enough for the HLD that
 * frontend/src/hld/markdown.ts writes (headings, paragraphs, lists, tables,
 * code, quotes, rules; bold, code and links inline). Its Mermaid blocks name
 * the tab that draws them instead (views/hld.tsx shownMarkdown), and its
 * status emoji, which the fonts lack, become coloured marks.
 */

const MARKS: Record<string, Span> = {
  '✅': { text: '✓', tone: 'good', bold: true },
  '❌': { text: '✗', tone: 'bad', bold: true },
  '🔴': { text: '●', tone: 'bad' },
  '🟠': { text: '●', tone: 'warn' },
  '⚪': { text: '●', tone: 'muted' },
  '⚠️': { text: '⚠', tone: 'warn' },
};

/** Inline Markdown as spans. */
export function inline(text: string): Rich {
  const out: Span[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|(?<![\w*])\*(?!\s)(.+?)\*(?!\w)|(?<!\w)_(?!\s)(.+?)_(?!\w)|(✅|❌|🔴|🟠|⚪|⚠️)/gu;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ text: m[1], bold: true });
    else if (m[2] !== undefined) out.push({ text: m[2], mono: true });
    else if (m[3] !== undefined) out.push({ text: m[3], tone: 'info' });
    else if (m[5] !== undefined || m[6] !== undefined) out.push({ text: (m[5] ?? m[6])!, tone: 'muted' });
    else out.push({ ...MARKS[m[7]] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length === 1 && Object.keys(out[0]).length === 1 ? out[0].text : out;
}

const cellsOf = (row: string) =>
  row
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));

export function markdownBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ type: 'paragraph', text: inline(para.join(' ')) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const fence = /^```(\w*)/.exec(ln);
    if (fence) {
      flush();
      const code: string[] = [];
      while (++i < lines.length && !/^```/.test(lines[i])) code.push(lines[i]);
      if (fence[1] === 'mermaid') out.push({ type: 'paragraph', small: true, text: code[0]?.startsWith('sequenceDiagram') ? 'The Sequence tab draws this scenario.' : 'The Diagram tab draws the architecture.' });
      else out.push({ type: 'code', text: code.join('\n'), ...(fence[1] ? { language: fence[1] } : {}) });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(ln);
    if (heading) {
      flush();
      out.push({ type: 'heading', level: Math.min(3, heading[1].length) as 1 | 2 | 3, text: inline(heading[2]) });
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(ln)) {
      flush();
      out.push({ type: 'rule' });
      continue;
    }
    if (/^\s*\|/.test(ln) && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      flush();
      const head = cellsOf(ln);
      const aligns = cellsOf(lines[i + 1]).map((c) => (/^:?-+:$/.test(c) && c.endsWith(':') && !c.startsWith(':') ? 'right' : 'left'));
      const rows: string[][] = [];
      i += 1;
      while (i + 1 < lines.length && /^\s*\|/.test(lines[i + 1])) rows.push(cellsOf(lines[++i]));
      const columns: Column[] = head.map((title, k) => ({ title, ...(aligns[k] === 'right' ? { align: 'right' as const } : {}) }));
      out.push({ type: 'table', columns, rows: rows.map((r) => ({ cells: head.map((_, k) => (r[k] === undefined || r[k] === '—' ? [{ text: r[k] ?? '', tone: 'muted' as const }] : inline(r[k]))) })) });
      continue;
    }
    const item = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(ln);
    if (item) {
      flush();
      const ordered = /\d/.test(item[2]);
      const indent = Math.floor(item[1].length / 2) * 2;
      const items: Rich[] = [inline(item[3])];
      while (i + 1 < lines.length) {
        const next = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(lines[i + 1]);
        if (next && Math.floor(next[1].length / 2) * 2 === indent && /\d/.test(next[2]) === ordered) {
          items.push(inline(next[3]));
          i++;
        } else if (!next && /^\s{2,}\S/.test(lines[i + 1])) {
          items[items.length - 1] = inline(`${typeof items.at(-1) === 'string' ? items.at(-1) : ''} ${lines[++i].trim()}`);
        } else break;
      }
      out.push({ type: 'list', items, ordered, ...(indent ? { indent } : {}) });
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(ln);
    if (quote) {
      flush();
      const text = [quote[1]];
      while (i + 1 < lines.length && /^>/.test(lines[i + 1])) text.push(lines[++i].replace(/^>\s?/, ''));
      out.push({ type: 'quote', text: inline(text.join(' ')) });
      continue;
    }
    if (!ln.trim()) flush();
    else para.push(ln.trim());
  }
  flush();
  return out;
}
