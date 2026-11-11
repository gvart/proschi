import { r } from '../svg';
import type { Block, Cell, Column, Control, Item, Rich, Select, SweepChart, Tone } from './contract';
import { CELL, CONTROL, Surface, buttonColumns, chip, drawButton, drawLaid, drawSelect, icon, layoutRich, line, paragraph, plain, rect, selectColumns, spansOf, toneColor, txt, width, type Box, type TextStyle } from './kit';
import { clip, measure } from './metrics';
import { alpha, mix, type Palette } from './theme';

/**
 * Laying out what panels are made of: rows of controls (snapped to whole
 * cells, three rows tall), and the blocks of a page (headings, paragraphs,
 * stats, tables, callouts, code, lists, checks, the sweep chart). Each
 * function draws onto a Surface from `top` and returns the px it used.
 */

const ROW = CELL.height;
/** A row of controls: three cells tall, the control 34 px in it. */
export const CONTROL_ROW = 3 * ROW;

const up = (y: number) => Math.ceil(y / ROW) * ROW;
const cols = (px: number) => Math.ceil(px / CELL.width);

export const BODY: TextStyle = { size: 14 };

/** Places a button `columns` wide at column `col`, its row from `top`. */
export function placeButton(S: Surface, c: Control, col: number, top: number, kind: 'button' | 'tab' | 'toggle' | 'option' = 'button', columns = buttonColumns(c)): Box {
  const box = { x: col * CELL.width, y: top + (CONTROL_ROW - CONTROL.height) / 2, w: columns * CELL.width, h: CONTROL.height };
  S.place({ control: { id: c.id, kind: c.active !== undefined && kind === 'button' ? 'toggle' : kind, ...(c.hotkey ? { hotkey: c.hotkey } : {}), ...(c.disabled ? { disabled: true } : {}) }, box, draw: (state) => drawButton(S.P, c, box, state) });
  return box;
}

const OPTION_ROW = (dense: boolean) => (dense ? ROW : 2 * ROW);

/** A select's menu under it from `top`: a card with an option per row, each a control `${id}=${value}`. */
function menu(S: Surface, sel: Select, col: number, top: number, minColumns: number): number {
  const P = S.P;
  const dense = sel.options.length > 8;
  const rowH = OPTION_ROW(dense);
  const size = dense ? 13 : 14;
  const groups = new Set(sel.options.map((o) => o.group).filter(Boolean)).size > 0;
  const textW = Math.max(...sel.options.map((o) => width(o.label, { size, weight: 600 }) + (o.detail ? width(o.detail, { size: 12.5 }) + 14 : 0)));
  const columns = Math.min(S.columns - col - 1, Math.max(minColumns, cols(textW + 48)));
  const x = col * CELL.width;
  const w = columns * CELL.width;
  let y = top;
  const parts: string[] = [];
  const headers: { y: number; label: string }[] = [];
  const opts: { y: number; i: number }[] = [];
  let group: string | undefined;
  sel.options.forEach((o, i) => {
    if (groups && o.group !== group) {
      group = o.group;
      if (group) {
        headers.push({ y, label: group });
        y += ROW;
      }
    }
    opts.push({ y, i });
    y += rowH;
  });
  const h = y - top + 6;
  parts.push(rect(x + 1.5, top + 0.5, w - 3, h - 1, { fill: alpha(P.ink, 0.06), stroke: alpha(P.ink, 0.24), sw: 1, rx: 8 }));
  for (const hd of headers) parts.push(txt(x + 12, hd.y + 12, hd.label.toUpperCase(), { size: 11, weight: 700, color: P.muted, spacing: 0.6 }));
  S.add(...parts);
  for (const { y: oy, i } of opts) {
    const o = sel.options[i];
    const box = { x: x + 4, y: oy + 2, w: w - 12, h: rowH - 2 };
    const selected = o.value === sel.value;
    S.place({
      control: { id: `${sel.id}=${o.value}`, kind: 'option' },
      box: { x, y: oy, w, h: rowH },
      draw: (state) => {
        const fill = state === 'pressed' ? alpha(P.ink, 0.18) : state === 'hover' ? alpha(P.ink, 0.11) : selected ? alpha(P.yellow, 0.16) : 'none';
        const base = box.y + box.h / 2 + size * 0.36;
        return [
          rect(box.x, box.y, box.w, box.h, { fill, rx: 4 }),
          selected ? icon('check', box.x + 7, box.y + box.h / 2 - 7, 14, P.yellow, 2.2) : '',
          txt(box.x + 28 + (groups ? 6 : 0), base, clip(o.label, box.w - 36 - (o.detail ? width(o.detail, { size: 12.5 }) + 10 : 0), size, selected ? 700 : 500), { size, weight: selected ? 700 : 500, color: P.ink }),
          o.detail ? txt(box.x + box.w - 8, base, o.detail, { size: 12.5, color: P.muted, anchor: 'end' }) : '',
        ].join('');
      },
    });
  }
  return up(h + 6);
}

/**
 * Items in rows three cells tall from `top`, starting at column `col` and
 * wrapping at `maxCol`: labels, buttons, selects (an open one's menu under its
 * row), a progress bar, and a spacer that pushes what follows to the right.
 */
export function itemsRow(S: Surface, items: Item[], col0: number, top: number, maxCol = S.columns - 2): number {
  const P = S.P;
  const start = top;
  top = up(top);
  const need = (it: Item): number => {
    if ('control' in it) return buttonColumns(it.control);
    if ('select' in it) return selectColumns(it.select.options.find((o) => o.value === it.select.value)?.label ?? it.select.value, it.select.hotkey);
    if ('text' in it) return cols(measureRich(it.text, BODY) + 2);
    if ('progress' in it) return it.columns ?? 8;
    return 0;
  };
  // Lines of items, wrapped.
  const lines: Item[][] = [[]];
  let used = 0;
  for (const it of items) {
    const n = need(it);
    if (lines.at(-1)!.length && used + n > maxCol - col0 && !('spacer' in it)) {
      lines.push([]);
      used = 0;
    }
    lines.at(-1)!.push(it);
    used += n + 1;
  }
  let y = top;
  const menus: { sel: Select; col: number; columns: number }[] = [];
  for (const items of lines) {
    const split = items.findIndex((it) => 'spacer' in it);
    const left = split < 0 ? items : items.slice(0, split);
    const right = split < 0 ? [] : items.slice(split + 1);
    const widthOf = (list: Item[]) => list.reduce((s, it) => s + need(it) + 1, 0) - (list.length ? 1 : 0);
    // A progress bar without a width takes what is left.
    const flex = items.find((it) => 'progress' in it && it.columns === undefined);
    const spare = Math.max(4, maxCol - col0 - widthOf(left) - widthOf(right) - (right.length ? 1 : 0) + (flex ? 8 : 0));
    const place = (list: Item[], start: number) => {
      let col = start;
      for (const it of list) {
        const n = it === flex ? spare : need(it);
        if ('control' in it) placeButton(S, it.control, col, y);
        else if ('select' in it) {
          const sel = it.select;
          const label = sel.options.find((o) => o.value === sel.value)?.label ?? sel.value;
          const box = { x: col * CELL.width, y: y + (CONTROL_ROW - CONTROL.height) / 2, w: n * CELL.width, h: CONTROL.height };
          S.place({ control: { id: sel.id, kind: 'select', ...(sel.hotkey ? { hotkey: sel.hotkey } : {}) }, box, draw: (state) => drawSelect(P, label, box, state, sel.open === true, sel.hotkey) });
          if (sel.open) menus.push({ sel, col, columns: n });
        } else if ('text' in it) {
          const laid = layoutRich(it.text, n * CELL.width, BODY, false)[0];
          S.add(drawLaid(P, laid, col * CELL.width, y + CONTROL_ROW / 2 + 5, BODY, P.ink));
        } else if ('progress' in it) {
          const x = col * CELL.width + 2;
          const w = n * CELL.width - 4;
          const p = Math.max(0, Math.min(1, it.progress));
          S.add(rect(x, y + CONTROL_ROW / 2 - 3, w, 6, { fill: P.hover, rx: 3 }), p > 0 ? rect(x, y + CONTROL_ROW / 2 - 3, Math.max(6, w * p), 6, { fill: P.yellow, rx: 3 }) : '');
        }
        col += n + 1;
      }
    };
    place(left, col0);
    if (right.length) place(right, maxCol - widthOf(right));
    y += CONTROL_ROW;
  }
  for (const m of menus) y += menu(S, m.sel, m.col, y, m.columns);
  return y - start;
}

export const measureRich = (rich: Rich, base: TextStyle) => layoutRich(rich, 1e6, base, false)[0].width;

// ---------- tables ----------

const HEAD = { size: 11.5, weight: 700, spacing: 0.5 };
const CELL_PAD = 18;

function cellText(c: Cell): Rich | undefined {
  if (typeof c === 'string' || Array.isArray(c)) return c;
  if ('bar' in c) return c.text;
  return undefined;
}

const BAR_TRACK = 56;

function cellWidth(c: Cell | undefined, base: TextStyle): number {
  if (c === undefined) return 0;
  if (typeof c === 'object' && !Array.isArray(c) && 'control' in c) return buttonColumns(c.control) * CELL.width;
  if (typeof c === 'object' && !Array.isArray(c) && 'bar' in c) return BAR_TRACK + 8 + width(c.text, { ...base, size: 13 });
  return measureRich(cellText(c)!, base);
}

const heatOf = (u: number) => (u >= 1 ? '#EF4444' : u > 0.7 ? '#F59E0B' : '#22C55E');

/** A table: uppercase header, hairline rows, numbers right-aligned; columns dropped by `drop`, then the first cut, to fit `maxW`. */
export function table(S: Surface, columns: Column[], rows: { cells: Cell[]; sub?: boolean; dim?: boolean }[], x0: number, top: number, maxW: number): number {
  const P = S.P;
  const controls = rows.some((row) => row.cells.some((c) => typeof c === 'object' && !Array.isArray(c) && 'control' in c));
  const rowH = controls ? CONTROL_ROW : 28;
  const subH = controls ? CONTROL_ROW : 22;
  const base: TextStyle = { size: 13.5 };
  const sub: TextStyle = { size: 12.5 };
  const widths = columns.map((c, i) =>
    Math.max(width(c.title.toUpperCase(), HEAD), ...rows.map((row) => cellWidth(row.cells[i], row.sub ? sub : base) + (i === 0 && row.sub ? 12 : 0))),
  );
  let shown = columns.map((_, i) => i);
  const total = () => shown.reduce((s, i) => s + widths[i], 0) + CELL_PAD * (shown.length - 1);
  while (total() > maxW) {
    const droppable = shown.filter((i) => columns[i].drop !== undefined).sort((a, b) => columns[b].drop! - columns[a].drop!);
    if (!droppable.length) break;
    shown = shown.filter((i) => i !== droppable[0]);
  }
  // Still too wide: the widest text columns give way, down to 60 px each; their cells end in an ellipsis.
  const fitted = [...widths];
  for (let guard = 0; guard < 50; guard++) {
    const over = shown.reduce((s, i) => s + fitted[i], 0) + CELL_PAD * (shown.length - 1) - maxW;
    if (over <= 0) break;
    const widest = shown.filter((i) => fitted[i] > 60).sort((a, b) => fitted[b] - fitted[a]);
    if (!widest.length) break;
    const next = widest.length > 1 ? fitted[widest[1]] : 60;
    fitted[widest[0]] = Math.max(60, Math.max(next, fitted[widest[0]] - over));
  }
  const w = (i: number) => fitted[i];
  // Column x positions; a column of controls starts on a cell boundary.
  // Narrower than the room: the gaps widen, as the editor's w-full tables, up to a point.
  const natural = shown.reduce((s, i) => s + w(i), 0) + CELL_PAD * (shown.length - 1);
  const gap = shown.length > 1 ? Math.min(96, CELL_PAD + Math.max(0, maxW - natural) / (shown.length - 1)) : CELL_PAD;
  const xs = new Map<number, number>();
  let x = x0;
  for (const i of shown) {
    const isControl = rows.some((row) => typeof row.cells[i] === 'object' && !Array.isArray(row.cells[i]) && 'control' in (row.cells[i] as object));
    if (isControl) x = Math.ceil(x / CELL.width) * CELL.width;
    xs.set(i, x);
    x += w(i) + gap;
  }
  let y = controls ? up(top) : top;
  const parts: string[] = [];
  parts.push(...shown.map((i) => txt(columns[i].align === 'right' ? xs.get(i)! + w(i) : xs.get(i)!, y + 13, columns[i].title.toUpperCase(), { ...HEAD, color: P.muted, anchor: columns[i].align === 'right' ? 'end' : 'start' })));
  y += 22;
  const right = Math.max(...shown.map((i) => xs.get(i)! + w(i)));
  parts.push(line(x0, y - 0.5, right, y - 0.5, P.line, 1));
  y = controls ? up(y) : y;
  rows.forEach((row, k) => {
    const h = row.sub ? subH : rowH;
    const style = row.sub ? sub : base;
    const baseline = y + h / 2 + (style.size ?? 13) * 0.36;
    for (const i of shown) {
      const c = row.cells[i];
      if (c === undefined) continue;
      const cx = xs.get(i)! + (i === shown[0] && row.sub ? 12 : 0);
      const cw = w(i) - (i === shown[0] && row.sub ? 12 : 0);
      if (typeof c === 'object' && !Array.isArray(c) && 'control' in c) {
        placeButton(S, c.control, Math.round(cx / CELL.width), y);
        continue;
      }
      if (typeof c === 'object' && !Array.isArray(c) && 'bar' in c) {
        const u = Math.max(0, c.bar);
        parts.push(rect(cx, y + h / 2 - 3, BAR_TRACK, 6, { fill: P.hover, rx: 3 }), u > 0 ? rect(cx, y + h / 2 - 3, Math.max(3, Math.min(1, u) * BAR_TRACK), 6, { fill: heatOf(u), rx: 3 }) : '');
        parts.push(txt(cx + BAR_TRACK + 8, baseline, c.text, { size: 13, weight: u >= 1 ? 600 : 400, color: c.tone ? P.tone[c.tone] : u >= 1 ? P.tone.bad : u > 0.7 ? P.tone.warn : mix(P.ink, P.surface, 0.8) }));
        continue;
      }
      const color = row.dim || row.sub ? P.muted : columns[i].align === 'right' ? mix(P.ink, P.surface, 0.85) : P.ink;
      const laid = layoutRich(c, cw, style, false)[0];
      parts.push(drawLaid(P, laid, columns[i].align === 'right' ? cx + cw - laid.width : cx, baseline, style, color));
    }
    y += h;
    const next = rows[k + 1];
    if (next && !next.sub) parts.push(line(x0, y - 0.5, right, y - 0.5, P.line, 1));
  });
  S.add(...parts);
  return y - top;
}

// ---------- code ----------

interface Token {
  text: string;
  color: string;
}

/** A line of JSON or XML in the kit's code colours. */
export function highlight(P: Palette, text: string, language?: string): Token[] {
  const out: Token[] = [];
  const C = P.code;
  if (language === 'json') {
    const re = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])|(\s+)|([^\s"{}[\],:]+)/g;
    for (const m of text.matchAll(re)) {
      if (m[1] && m[2]) out.push({ text: m[1], color: C.key }, { text: m[2], color: C.punct });
      else if (m[1]) out.push({ text: m[1], color: C.string });
      else if (m[3]) out.push({ text: m[3], color: C.number });
      else if (m[4]) out.push({ text: m[4], color: C.literal });
      else if (m[5]) out.push({ text: m[5], color: C.punct });
      else out.push({ text: m[0], color: P.ink });
    }
    return out;
  }
  if (language === 'xml') {
    const re = /(<\/?|\/?>)|([\w:.-]+)(=)("[^"]*")|([^<>]+)/g;
    let inTag = false;
    for (const m of text.matchAll(re)) {
      if (m[1]) {
        out.push({ text: m[1], color: C.punct });
        inTag = m[1].startsWith('<');
      } else if (m[2]) out.push({ text: m[2], color: C.key }, { text: m[3], color: C.punct }, { text: m[4], color: C.string });
      else if (inTag) {
        const [, name, rest] = /^(\s*[\w:.-]*)([\s\S]*)$/.exec(m[5])!;
        out.push({ text: name, color: C.tag }, { text: rest, color: P.ink });
        inTag = false;
      } else out.push({ text: m[5], color: P.ink });
    }
    return out;
  }
  return [{ text, color: P.ink }];
}

export const CODE = { size: 12.5, line: 18 };

/** A code box from (x, top), `w` wide: a line per row (16 px), at most `maxLines` and a count of the rest. */
export function codeBox(S: Surface, text: string, x: number, top: number, w: number, o: { language?: string; maxLines?: number; error?: boolean; fill?: string } = {}): number {
  const P = S.P;
  const all = text.replace(/\n+$/, '').split('\n');
  const shown = all.slice(0, o.maxLines ?? all.length);
  const more = all.length - shown.length;
  const h = 10 + (shown.length + (more ? 1 : 0)) * CODE.line;
  const fill = o.error ? P.chip.red.fill : (o.fill ?? P.wash);
  const parts = [rect(x + 0.5, top + 0.5, w - 1, h - 1, { fill, stroke: o.error ? alpha(P.fail, 0.45) : P.line, sw: 1, rx: 6 })];
  const advance = measure('0', CODE.size, 500, true);
  const room = Math.floor((w - 20) / advance);
  shown.forEach((ln, i) => {
    let col = 0;
    const y = top + 5 + i * CODE.line + 13;
    for (const t of highlight(P, ln, o.language)) {
      if (col >= room) break;
      let piece = t.text;
      if (col + piece.length > room) piece = `${piece.slice(0, Math.max(0, room - col - 1))}…`;
      if (piece.trim()) parts.push(txt(x + 10 + col * advance, y, piece, { size: CODE.size, mono: true, color: t.color }));
      col += piece.length;
    }
  });
  if (more) parts.push(txt(x + 10, top + 5 + shown.length * CODE.line + 13, `… ${more} more line${more === 1 ? '' : 's'}`, { size: 12, color: P.muted }));
  S.add(...parts);
  return h;
}

// ---------- the other blocks ----------

const CALLOUT_ICON: Record<'warn' | 'bad' | 'good' | 'info', 'warn' | 'cross' | 'check' | 'bolt'> = { warn: 'warn', bad: 'cross', good: 'check', info: 'bolt' };

export function callout(S: Surface, tone: 'warn' | 'bad' | 'good' | 'info', text: Rich, x: number, top: number, w: number, lead?: string): number {
  const P = S.P;
  const c = P.callout[tone];
  const inner = x + 34 + (lead ? width(lead, { size: 12, weight: 600 }) + 18 : 0);
  const body = paragraph(P, text, inner, top + 7, x + w - 12 - inner, BODY, c.text, 21);
  const h = body.height + 14;
  S.add(rect(x, top, w, h, { fill: c.fill, rx: 8 }), icon(CALLOUT_ICON[tone], x + 12, top + 7 + 21 / 2 - 8, 16, c.icon, 2), lead ? chip(P, x + 34, top + 7 + 21 / 2 + 4.5, lead, tone === 'info' ? 'info' : tone === 'good' ? 'good' : 'bad').svg : '', body.svg);
  return h;
}

function stats(S: Surface, items: { label: string; value: string; tone?: Tone }[], x: number, top: number, w: number): number {
  const P = S.P;
  const per = Math.max(1, Math.min(items.length, Math.floor((w + 10) / 170)));
  const cw = (w - 10 * (per - 1)) / per;
  const h = 58;
  items.forEach((it, i) => {
    const cx = x + (i % per) * (cw + 10);
    const cy = top + Math.floor(i / per) * (h + 10);
    S.add(
      rect(cx + 0.5, cy + 0.5, cw - 1, h - 1, { fill: P.card.fill, stroke: P.card.line, sw: 1, rx: 8 }),
      txt(cx + 12, cy + 20, clip(it.label, cw - 24, 12.5, 500), { size: 12.5, weight: 500, color: P.muted }),
      txt(cx + 12, cy + 44, clip(it.value, cw - 24, 18, 700), { size: 18, weight: 700, color: it.tone ? P.tone[it.tone] : P.ink }),
    );
  });
  return Math.ceil(items.length / per) * (h + 10) - 10;
}

function check(S: Surface, b: Extract<Block, { type: 'check' }>, x: number, top: number, w: number): number {
  const P = S.P;
  const ix = x + (b.indent ?? 0) * CELL.width;
  const tone = b.passed ? P.tone.good : P.tone.bad;
  const parts: string[] = [];
  parts.push(icon(b.passed ? 'check' : 'cross', ix, top + 4, 14, tone, 2.4));
  const title = spansOf(b.title).map((s) => ({ ...s, bold: s.bold ?? !b.passed }));
  const head = layoutRich([...title, ...(b.where ? [{ text: `  ${b.where}`, tone: 'muted' as const }] : [])], x + w - ix - 20, BODY, false)[0];
  parts.push(drawLaid(P, head, ix + 22, top + 16, BODY, b.passed ? mix(P.ink, P.surface, 0.8) : P.ink));
  let y = top + 23;
  S.add(...parts);
  if (b.message) {
    const m = paragraph(P, b.message, ix + 22, y, x + w - ix - 22, { size: 13 }, b.passed ? P.muted : mix(P.ink, P.surface, 0.85), 19);
    S.add(m.svg);
    y += m.height;
  }
  if (b.hint) {
    const hnt = paragraph(P, `→ ${b.hint}`, ix + 22, y, x + w - ix - 22, { size: 13 }, P.tone.warn, 19);
    S.add(hnt.svg);
    y += hnt.height;
  }
  return y - top;
}

function list(S: Surface, items: Rich[], ordered: boolean, x: number, top: number, w: number): number {
  const P = S.P;
  let y = top;
  items.forEach((it, i) => {
    const mark = ordered ? `${i + 1}.` : '•';
    S.add(txt(x + (ordered ? 14 : 4), y + 15, mark, { size: 14, weight: ordered ? 600 : 700, color: P.muted, anchor: ordered ? 'end' : 'start' }));
    const p = paragraph(P, it, x + 20, y, w - 20, BODY, P.ink, 21);
    S.add(p.svg);
    y += p.height + 2;
  });
  return y - top - 2;
}

/** The sweep (WhatIfResults.tsx SweepChart): a bar per node to where it saturates; today and the highest passing rate marked. */
function chart(S: Surface, c: SweepChart, x: number, top: number, w: number): number {
  const P = S.P;
  const nameW = Math.min(150, Math.max(50, ...c.bars.map((b) => width(b.node, { size: 12, weight: 600 })))) + 12;
  const valueW = Math.max(70, ...c.bars.map((b) => width(b.value, { size: 12 }))) + 12;
  const tx = x + nameW;
  const tw = w - nameW - valueW;
  const at = (rps: number) => tx + Math.max(0, Math.min(1, (rps - c.from) / (c.to - c.from))) * tw;
  const parts: string[] = [];
  let y = top + 18;
  const barH = 22;
  const bottom = y + c.bars.length * barH;
  parts.push(txt(x, top + 12, 'NODE', { ...HEAD, color: P.muted }), txt(x + w, top + 12, 'SATURATES AT', { ...HEAD, color: P.muted, anchor: 'end' }));
  c.bars.forEach((b) => {
    parts.push(txt(x, y + 15, clip(b.node, nameW - 12, 12, 600), { size: 12, weight: 600, color: P.ink }));
    parts.push(rect(tx, y + 6, tw, 10, { fill: P.hover, rx: 3 }));
    if (!b.atStart) parts.push(rect(tx, y + 6, Math.max(4, at(b.rps) - tx), 10, { fill: P.blue, rx: 3 }));
    parts.push(txt(x + w, y + 15, b.value, { size: 12, color: b.atStart ? P.tone.bad : mix(P.ink, P.surface, 0.85), anchor: 'end' }));
    y += barH;
  });
  // Markers over the bars, their labels under them.
  const mark = (rps: number, color: string, label: string, row: number) => {
    const mx = at(rps);
    parts.push(line(mx, top + 16, mx, bottom + 2, color, 2, '3 3'));
    const lw = width(label, { size: 11, weight: 600 });
    const lx = Math.max(tx, Math.min(tx + tw - lw, mx - lw / 2));
    parts.push(txt(lx, bottom + 16 + row * 15, label, { size: 11, weight: 600, color }));
  };
  mark(c.today, P.ink, `today ${c.labels.today}`, 0);
  if (c.maxPassing !== undefined && c.labels.maxPassing) mark(c.maxPassing, P.tone.good, `passes up to ${c.labels.maxPassing}`, Math.abs(at(c.maxPassing) - at(c.today)) < 150 ? 1 : 0);
  const rows = c.maxPassing !== undefined && Math.abs(at(c.maxPassing) - at(c.today)) < 150 ? 2 : 1;
  parts.push(txt(tx, bottom + 16 + rows * 15, c.labels.from, { size: 10.5, color: P.muted }), txt(tx + tw, bottom + 16 + rows * 15, c.labels.to, { size: 10.5, color: P.muted, anchor: 'end' }));
  S.add(...parts);
  return bottom + 20 + rows * 15 - top;
}

const HEADING = { 1: { size: 20, weight: 700, before: 8 }, 2: { size: 16.5, weight: 700, before: 8 }, 3: { size: 14.5, weight: 700, before: 4 } } as const;

/** The space before a block, after the one before it. */
function gapBefore(b: Block, prev: Block | undefined): number {
  if (!prev) return 0;
  if (b.type === 'heading') return 14 + HEADING[b.level ?? 2].before;
  if (prev.type === 'heading') return 6;
  if (b.type === 'check' && prev.type === 'check') return 8;
  if (b.type === 'space') return 0;
  return 10;
}

/** Blocks one under another from `top`, `x` to `x + w`; returns the px used. */
export function blocks(S: Surface, list_: Block[], x: number, top: number, w: number): number {
  const P = S.P;
  let y = top;
  let prev: Block | undefined;
  for (const b of list_) {
    y += gapBefore(b, prev);
    prev = b;
    switch (b.type) {
      case 'heading': {
        const h = HEADING[b.level ?? 2];
        const laid = layoutRich(b.text, w, { size: h.size, weight: h.weight }, true);
        laid.forEach((l, i) => S.add(drawLaid(P, l, x, y + h.size + i * h.size * 1.35, { size: h.size, weight: h.weight }, P.ink)));
        y += laid.length * h.size * 1.35 + (b.level === 1 ? 4 : 0);
        if (b.level === 1) S.add(line(x, y, x + w, y, P.line, 1));
        y += b.level === 1 ? 4 : 0;
        break;
      }
      case 'paragraph': {
        const ix = (b.indent ?? 0) * CELL.width;
        const style = b.small ? { size: 13 } : BODY;
        const p = paragraph(P, b.text, x + ix, y, w - ix, style, toneColor(P, b.tone, b.small ? P.muted : P.ink), b.small ? 19 : 21);
        S.add(p.svg);
        y += p.height;
        break;
      }
      case 'stats':
        y += stats(S, b.items, x, y, w);
        break;
      case 'table':
        y += table(S, b.columns, b.rows, x, y, w);
        break;
      case 'callout':
        y += callout(S, b.tone, b.text, x, y, w, b.chip);
        break;
      case 'controls':
        y += itemsRow(S, b.items, Math.round(x / CELL.width), y, Math.floor((x + w) / CELL.width));
        break;
      case 'code':
        y += codeBox(S, b.text, x, y, w, { ...(b.language ? { language: b.language } : {}), ...(b.maxLines ? { maxLines: b.maxLines } : {}), fill: P.wash });
        break;
      case 'list':
        y += list(S, b.items, b.ordered === true, x + (b.indent ?? 0) * CELL.width, y, w - (b.indent ?? 0) * CELL.width);
        break;
      case 'check':
        y += check(S, b, x, y, w);
        break;
      case 'chart':
        y += chart(S, b.chart, x, y, w);
        break;
      case 'quote': {
        const p = paragraph(P, b.text, x + 14, y, w - 14, BODY, P.muted, 21);
        S.add(rect(x, y, 3, p.height, { fill: P.line, rx: 1.5 }), p.svg);
        y += p.height;
        break;
      }
      case 'rule':
        S.add(line(x, y + 6, x + w, y + 6, P.line, 1));
        y += 12;
        break;
      case 'space':
        y += (b.rows ?? 1) * ROW;
        break;
    }
  }
  return y - top;
}

export { up as upToRow, r, plain };
