import { r } from '../svg';
import type { Block, Cell, Column, Control, Item, Rich, Select, Tone } from './contract';
import { CELL, CONTROL, Surface, buttonColumns, chip, drawButton, drawLaid, drawSelect, icon, layoutRich, line, paragraph, plain, rect, selectColumns, toneColor, txt, width, type Box, type TextStyle } from './kit';
import { clip, measure } from './metrics';
import { alpha, mix, type Palette } from './theme';

/**
 * Laying out what panels are made of: rows of controls (snapped to whole
 * cells, three rows tall), and the blocks of a page (headings, paragraphs,
 * stats, tables, callouts, code, lists, checks). Each
 * function draws onto a Surface from `top` and returns the px it used.
 */

const ROW = CELL.height;
/** A row of controls: three cells tall, the control 34 px in it. */
export const CONTROL_ROW = 3 * ROW;

const up = (y: number) => Math.ceil(y / ROW) * ROW;
const cols = (px: number) => Math.ceil(px / CELL.width);

export const BODY: TextStyle = { size: 14.5 };

/** Places a button `columns` wide at column `col`, its row from `top`. */
export function placeButton(S: Surface, c: Control, col: number, top: number, kind: 'button' | 'tab' | 'toggle' | 'option' = 'button', columns = buttonColumns(c)): Box {
  const box = { x: col * CELL.width, y: top + (CONTROL_ROW - CONTROL.height) / 2, w: columns * CELL.width, h: CONTROL.height };
  S.place({ control: { id: c.id, kind: c.active !== undefined && kind === 'button' ? 'toggle' : kind, ...(c.hotkey ? { hotkey: c.hotkey } : {}), ...(c.disabled ? { disabled: true } : {}) }, box, draw: (state) => drawButton(S.P, c, box, state) });
  return box;
}

const OPTION_ROW = (dense: boolean) => (dense ? ROW : 2 * ROW);

/** The columns a select's options take in its menu, measured in the type they are drawn in. */
function menuTextColumns(sel: Select): number {
  const size = sel.options.length > 8 ? 13 : 14;
  return cols(Math.max(...sel.options.map((o) => width(o.label, { size, weight: 600 }) + (o.detail ? width(o.detail, { size: 12.5 }) + 14 : 0))) + 48);
}

/** A MenuPanel's width: its options measured, at least 28 columns and at most `max`. */
export const menuColumns = (sel: Select, max: number) => Math.min(max, Math.max(28, menuTextColumns(sel) + 1));

/** A select's menu under it from `top`: a card with an option per row, each a control `${id}=${value}`; `framed` false where the panel is the card (a MenuPanel). */
export function menu(S: Surface, sel: Select, col: number, top: number, minColumns: number, framed = true): number {
  const P = S.P;
  const dense = sel.options.length > 8;
  const rowH = OPTION_ROW(dense);
  const size = dense ? 13 : 14;
  const groups = new Set(sel.options.map((o) => o.group).filter(Boolean)).size > 0;
  const columns = Math.min(S.columns - col - 1, Math.max(minColumns, menuTextColumns(sel)));
  const x = col * CELL.width;
  const w = columns * CELL.width;
  let y = top;
  const parts: string[] = [];
  const headers: { y: number; label: string }[] = [];
  const opts: { y: number; i: number }[] = [];
  let group: string | undefined;
  const dividers: number[] = [];
  sel.options.forEach((o, i) => {
    if (o.divider && i > 0) {
      dividers.push(y + 4);
      y += 8;
    }
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
  if (framed) parts.push(rect(x + 1.5, top + 0.5, w - 3, h - 1, { fill: alpha(P.ink, 0.06), stroke: alpha(P.ink, 0.24), sw: 1, rx: 8 }));
  for (const dy of dividers) parts.push(line(x + 10, dy + 0.5, x + w - 10, dy + 0.5, P.line, 1));
  // Marked options (a scenario's ✓ or ✗) show the selected one by its fill alone.
  const marked = sel.options.some((o) => o.icon);
  for (const hd of headers) parts.push(txt(x + 12, hd.y + 12, hd.label.toUpperCase(), { size: 11, weight: 600, color: P.muted, spacing: 0.6 }));
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
          o.icon ? icon(o.icon, box.x + 7, box.y + box.h / 2 - 7, 14, o.tone ? P.tone[o.tone] : P.muted, 2.2) : selected && !marked ? icon('check', box.x + 7, box.y + box.h / 2 - 7, 14, P.yellow, 2.2) : '',
          txt(box.x + 28 + (groups ? 6 : 0), base, clip(o.label, box.w - 36 - (o.detail ? width(o.detail, { size: 12.5 }) + 10 : 0), size, selected ? 600 : 500), { size, weight: selected ? 600 : 500, color: P.ink }),
          o.detail ? txt(box.x + box.w - 8, base, o.detail, { size: 12.5, color: P.muted, anchor: 'end' }) : '',
        ].join('');
      },
    });
  }
  return framed ? up(h + 6) : h;
}

/**
 * Ways to make a row of items narrower, tried in turn until it fits, as the
 * text UI shortens its buttons: the keycaps of quiet controls, their labels
 * (icon only), every keycap, then the labels of all but the primary.
 */
const SHRINK: ((c: Control) => Control)[] = [
  (c) => (c.variant === 'quiet' ? { ...c, hotkey: undefined } : c),
  (c) => (c.variant === 'quiet' && c.icon ? { ...c, label: undefined } : c),
  (c) => ({ ...c, hotkey: undefined, columns: undefined }),
  (c) => (c.variant !== 'primary' && c.icon ? { ...c, label: undefined } : c),
  (c) => (c.icon ? { ...c, label: undefined } : c),
];

/** `items` made narrow enough for `room` columns where shortening their controls can; else as narrow as it gets (and they wrap). */
function fitted(items: Item[], room: number, need: (it: Item) => number): Item[] {
  const total = (list: Item[]) => list.reduce((sum, it) => sum + ('spacer' in it ? 0 : ('progress' in it && it.columns === undefined ? 8 : need(it)) + 1), 0) - 1;
  let list = items;
  for (const shrink of SHRINK) {
    if (total(list) <= room) return list;
    list = list.map((it) => ('control' in it ? { control: shrink(it.control) } : it));
  }
  return list;
}

/**
 * Items in rows three cells tall from `top`, starting at column `col` and
 * up to `maxCol`: labels, buttons, selects (an open one's menu under its
 * row), a progress bar, and a spacer that pushes what follows to the right.
 * Too wide, the controls shorten (SHRINK); only what still does not fit wraps.
 */
export function itemsRow(S: Surface, given: Item[], col0: number, top: number, maxCol = S.columns - 2): number {
  const P = S.P;
  const start = top;
  top = up(top);
  const need = (it: Item): number => {
    if ('control' in it) return buttonColumns(it.control);
    if ('select' in it) return it.select.columns ?? selectColumns(it.select.options.find((o) => o.value === it.select.value)?.label ?? it.select.value, it.select.hotkey);
    if ('text' in it) return it.columns ?? cols(measureRich(it.text, BODY) + 2);
    if ('progress' in it) return it.columns ?? 8;
    return 0;
  };
  const items = fitted(given, maxCol - col0, need);
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
          const shown = sel.options.find((o) => o.value === sel.value);
          const box = { x: col * CELL.width, y: y + (CONTROL_ROW - CONTROL.height) / 2, w: n * CELL.width, h: CONTROL.height };
          S.place({ control: { id: sel.id, kind: 'select', ...(sel.hotkey ? { hotkey: sel.hotkey } : {}), ...(sel.disabled ? { disabled: true } : {}) }, box, draw: (state) => drawSelect(P, shown?.label ?? sel.value, box, state, sel.open === true, sel.hotkey, shown?.icon ? { icon: shown.icon, color: shown.tone ? P.tone[shown.tone] : P.muted } : undefined, sel.disabled === true) });
          if (sel.open && !sel.floats) menus.push({ sel, col, columns: n });
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

const HEAD = { size: 11.5, weight: 600, spacing: 0.5 };
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

/** A cell that never wraps: a control, or a heat bar with its figure. */
const isFixed = (c: Cell | undefined) => typeof c === 'object' && !Array.isArray(c) && ('control' in c || 'bar' in c);

/** A wrapped line of table text: 19 px at 14 px type, 17 at 13. */
const lineOf = (s: TextStyle) => ((s.size ?? 13) >= 14 ? 19 : 17);

/**
 * A table: uppercase header, hairline rows, numbers right-aligned. Columns
 * marked `drop` go first when it does not fit; then the text columns share
 * the room (a narrow one keeps its width, the wide ones split the rest) and
 * their cells and titles wrap, a word too long for its column broken, so
 * every cell is whole within `maxW`.
 */
/** The narrowest a wrapping text column of a table gets before one of its columns drops, px. */
const MIN_TEXT = 88;

export function table(S: Surface, columns: Column[], rows: { cells: Cell[]; sub?: boolean; dim?: boolean }[], x0: number, top: number, maxW: number): number {
  const P = S.P;
  const controls = rows.some((row) => row.cells.some((c) => typeof c === 'object' && !Array.isArray(c) && 'control' in c));
  // Every row whole cells, so a strip can end under any of them.
  const rowH = controls ? CONTROL_ROW : 2 * ROW;
  const subH = controls ? CONTROL_ROW : ROW;
  const base: TextStyle = { size: 14 };
  const sub: TextStyle = { size: 13 };
  const indent = (i: number, row: { sub?: boolean }) => (i === 0 && row.sub ? 12 : 0);
  const widths = columns.map((c, i) => Math.max(width(c.title.toUpperCase(), HEAD), ...rows.map((row) => cellWidth(row.cells[i], row.sub ? sub : base) + indent(i, row))));
  const fixed = columns.map((_, i) => rows.some((row) => isFixed(row.cells[i])));
  let shown = columns.map((_, i) => i);
  const total = () => shown.reduce((s, i) => s + widths[i], 0) + CELL_PAD * (shown.length - 1);
  // A column drops only where the table cannot fit even with its text columns wrapped (each at least MIN_TEXT wide), as the editor's tables wrap.
  const least = () => shown.reduce((s, i) => s + (fixed[i] ? widths[i] : Math.min(widths[i], MIN_TEXT)), 0) + CELL_PAD * (shown.length - 1);
  while (least() > maxW) {
    const droppable = shown.filter((i) => columns[i].drop !== undefined).sort((a, b) => columns[b].drop! - columns[a].drop!);
    if (!droppable.length) break;
    shown = shown.filter((i) => i !== droppable[0]);
  }
  // Still too wide: the text columns share what the fixed ones leave, the narrowest keeping their width first.
  const w = [...widths];
  if (total() > maxW) {
    let room = maxW - CELL_PAD * (shown.length - 1) - shown.filter((i) => fixed[i]).reduce((s, i) => s + widths[i], 0);
    const flex = shown.filter((i) => !fixed[i]).sort((a, b) => widths[a] - widths[b]);
    flex.forEach((i, k) => {
      const share = Math.max(24, Math.floor(room / (flex.length - k)));
      w[i] = Math.min(widths[i], share);
      room -= w[i];
    });
  }
  // Column x positions; a column of controls starts on a cell boundary.
  // Narrower than the room: the gaps widen, as the editor's w-full tables, up to a point.
  const natural = shown.reduce((s, i) => s + w[i], 0) + CELL_PAD * (shown.length - 1);
  const gap = shown.length > 1 ? Math.min(96, CELL_PAD + Math.max(0, maxW - natural) / (shown.length - 1)) : CELL_PAD;
  const xs = new Map<number, number>();
  let x = x0;
  for (const i of shown) {
    const isControl = rows.some((row) => typeof row.cells[i] === 'object' && !Array.isArray(row.cells[i]) && 'control' in (row.cells[i] as object));
    if (isControl) x = Math.ceil(x / CELL.width) * CELL.width;
    xs.set(i, x);
    x += w[i] + gap;
  }
  // On the cell grid: the header whole rows, each row whole rows under it.
  let y = up(top);
  const parts: string[] = [];
  const heads = shown.map((i) => layoutRich(columns[i].title.toUpperCase(), w[i], HEAD, true));
  const headLines = Math.max(1, ...heads.map((l) => l.length));
  shown.forEach((i, k) =>
    heads[k].forEach((laid, n) => {
      const right = columns[i].align === 'right';
      parts.push(drawLaid(P, laid, right ? xs.get(i)! + w[i] - laid.width : xs.get(i)!, y + ROW / 2 + 4 + n * 14, HEAD, P.muted));
    }),
  );
  y += up(ROW + (headLines - 1) * 14);
  const right = Math.max(...shown.map((i) => xs.get(i)! + w[i]));
  parts.push(line(x0, y - 0.5, right, y - 0.5, P.line, 1));
  rows.forEach((row, k) => {
    const style = row.sub ? sub : base;
    const single = row.sub ? subH : rowH;
    const L = lineOf(style);
    // Each text cell's lines; the row as tall as its tallest, its first line where a one-line row has it.
    const laid = new Map<number, ReturnType<typeof layoutRich>>();
    for (const i of shown) {
      const c = row.cells[i];
      if (c === undefined || isFixed(c)) continue;
      laid.set(i, layoutRich(c as Rich, w[i] - indent(i, row), style, true));
    }
    const most = Math.max(1, ...[...laid.values()].map((l) => l.length));
    const pad = (single - L) / 2;
    const h = Math.max(single, up(2 * pad + most * L));
    const baseline = y + pad + L / 2 + (style.size ?? 13) * 0.36;
    for (const i of shown) {
      const c = row.cells[i];
      if (c === undefined) continue;
      const cx = xs.get(i)! + indent(i, row);
      const cw = w[i] - indent(i, row);
      if (typeof c === 'object' && !Array.isArray(c) && 'control' in c) {
        placeButton(S, c.control, Math.round(cx / CELL.width), y);
        continue;
      }
      if (typeof c === 'object' && !Array.isArray(c) && 'bar' in c) {
        const u = Math.max(0, c.bar);
        parts.push(rect(cx, y + single / 2 - 3, BAR_TRACK, 6, { fill: P.hover, rx: 3 }), u > 0 ? rect(cx, y + single / 2 - 3, Math.max(3, Math.min(1, u) * BAR_TRACK), 6, { fill: heatOf(u), rx: 3 }) : '');
        parts.push(txt(cx + BAR_TRACK + 8, baseline, c.text, { size: 13, weight: u >= 1 ? 600 : 400, color: c.tone ? P.tone[c.tone] : u >= 1 ? P.tone.bad : u > 0.7 ? P.tone.warn : mix(P.ink, P.surface, 0.8) }));
        continue;
      }
      const color = row.dim || row.sub ? P.muted : columns[i].align === 'right' ? mix(P.ink, P.surface, 0.85) : P.ink;
      laid.get(i)!.forEach((l, n) => parts.push(drawLaid(P, l, columns[i].align === 'right' ? cx + cw - l.width : cx, baseline + n * L, style, color)));
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

/** A code box from (x, top), `w` wide: a row per line (18 px), a line longer than the box going on under itself, indented; at most `maxLines` lines of the source and a count of the rest. */
export function codeBox(S: Surface, text: string, x: number, top: number, w: number, o: { language?: string; maxLines?: number; error?: boolean; fill?: string } = {}): number {
  const P = S.P;
  const all = text.replace(/\n+$/, '').split('\n');
  const shown = all.slice(0, o.maxLines ?? all.length);
  const more = all.length - shown.length;
  const advance = measure('0', CODE.size, 500, true);
  const room = Math.max(8, Math.floor((w - 20) / advance));
  // Each source line as rows of tokens, at a column each.
  const rows: { col: number; text: string; color: string }[][] = [];
  for (const ln of shown) {
    const lead = Math.min(Math.floor(room / 2), /^\s*/.exec(ln)![0].length + 2);
    let row: { col: number; text: string; color: string }[] = [];
    let col = 0;
    rows.push(row);
    for (const t of highlight(P, ln, o.language)) {
      let rest = t.text;
      while (rest) {
        if (col >= room) {
          rows.push((row = []));
          col = lead;
          rest = rest.replace(/^\s+/, '');
          if (!rest) break;
        }
        const piece = rest.slice(0, room - col);
        row.push({ col, text: piece, color: t.color });
        col += piece.length;
        rest = rest.slice(piece.length);
      }
    }
  }
  const h = 10 + (rows.length + (more ? 1 : 0)) * CODE.line;
  const fill = o.error ? P.chip.red.fill : (o.fill ?? P.wash);
  const parts = [rect(x + 0.5, top + 0.5, w - 1, h - 1, { fill, stroke: o.error ? alpha(P.fail, 0.45) : P.line, sw: 1, rx: 6 })];
  rows.forEach((row, i) => {
    const y = top + 5 + i * CODE.line + 13;
    for (const t of row) if (t.text.trim()) parts.push(txt(x + 10 + t.col * advance, y, t.text, { size: CODE.size, mono: true, color: t.color }));
  });
  if (more) parts.push(txt(x + 10, top + 5 + rows.length * CODE.line + 13, `… ${more} more line${more === 1 ? '' : 's'}`, { size: 12, color: P.muted }));
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
  const h = 3 * ROW;
  items.forEach((it, i) => {
    const cx = x + (i % per) * (cw + 10);
    const cy = top + Math.floor(i / per) * (h + 10);
    S.add(
      rect(cx + 0.5, cy + 0.5, cw - 1, h - 1, { fill: P.button.fill, stroke: P.card.line, sw: 1, rx: 8 }),
      txt(cx + 12, cy + 20, clip(it.label, cw - 24, 12.5, 500), { size: 12.5, weight: 500, color: P.muted }),
      txt(cx + 12, cy + 44, clip(it.value, cw - 24, 18, 600), { size: 18, weight: 600, color: it.tone ? P.tone[it.tone] : P.ink }),
    );
  });
  return Math.ceil(items.length / per) * (h + 10) - 10;
}

function list(S: Surface, items: Rich[], ordered: boolean, x: number, top: number, w: number): number {
  const P = S.P;
  let y = top;
  items.forEach((it, i) => {
    const mark = ordered ? `${i + 1}.` : '•';
    S.add(txt(x + (ordered ? 14 : 4), y + 15, mark, { size: 14, weight: ordered ? 600 : 600, color: P.muted, anchor: ordered ? 'end' : 'start' }));
    const p = paragraph(P, it, x + 20, y, w - 20, BODY, P.ink, 21);
    S.add(p.svg);
    y += p.height + 2;
  });
  return y - top - 2;
}

/**
 * A nested <svg> (an icon) as a <g> with the same placement, which resvg can
 * crop: its x, y, width, height and viewBox become a transform, the other
 * attributes (fill, stroke, color) stay for the children to inherit.
 */
function flatten(attrs: string, body: string): string {
  const num = (name: string, fallback = 0) => Number(new RegExp(`\\s${name}="([-\\d.]+)"`).exec(attrs)?.[1] ?? fallback);
  const box = /viewBox="([^"]+)"/.exec(attrs)?.[1].split(/[\s,]+/).map(Number) ?? [0, 0, num('width', 1), num('height', 1)];
  const kx = num('width', box[2]) / box[2];
  const ky = num('height', box[3]) / box[3];
  const rest = attrs.replace(/\s(x|y|width|height|viewBox|xmlns(:\w+)?|preserveAspectRatio)="[^"]*"/g, '');
  return `<g transform="translate(${num('x') - box[0] * kx} ${num('y') - box[1] * ky}) scale(${kx} ${ky})"${rest}>${body}</g>`;
}

/** An SVG drawing (`proschi render`'s) to draw inside a panel: its size, and its body without the outer <svg>, title and background, nested <svg>s flattened. */
export function embedded(svg: string): { width: number; height: number; body: string } {
  const width = Number(/width="([\d.]+)"/.exec(svg)![1]);
  const height = Number(/height="([\d.]+)"/.exec(svg)![1]);
  const body = svg
    .replace(/^<svg[^>]*>\n?/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/<title>[\s\S]*?<\/title>\n?/, '')
    .replace(/<rect width="100%" height="100%"[^>]*\/>\n?/, '')
    .replace(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/g, (_, attrs: string, inner: string) => flatten(attrs, inner));
  return { width, height, body };
}

/** A figure: the drawing in a frame of the page's wash, centred, no wider than the page and no taller than its rows; its caption under it. */
function figure(S: Surface, b: Extract<Block, { type: 'figure' }>, x: number, top: number, w: number): number {
  const P = S.P;
  if (!b.svg) {
    const p = paragraph(P, 'This drawing could not be made here: ↗ Open in Proschi draws it.', x, top, w, { size: 13 }, P.muted, 19);
    S.add(p.svg);
    return p.height;
  }
  const d = embedded(b.svg);
  const pad = 10;
  const k = Math.min(1, (w - 2 * pad) / d.width, ((b.maxRows ?? 30) * ROW - 2 * pad) / d.height);
  const h = up(d.height * k + 2 * pad);
  S.add(rect(x + 0.5, top + 0.5, w - 1, h - 1, { fill: P.wash, stroke: P.card.line, sw: 1, rx: 8 }));
  const kk = Math.round(k * 1000) / 1000;
  S.addWithin({ x, y: top, w, h }, `<g transform="translate(${r(x + (w - d.width * kk) / 2)} ${r(top + (h - d.height * kk) / 2)})${kk < 1 ? ` scale(${kk})` : ''}">${d.body}</g>`);
  if (!b.caption) return h;
  const c = paragraph(P, b.caption, x + 4, top + h + 4, w - 8, { size: 12.5 }, P.muted, 18);
  S.add(c.svg);
  return h + 4 + c.height;
}

const HEADING = { 1: { size: 20, weight: 600, before: 8 }, 2: { size: 16.5, weight: 600, before: 8 }, 3: { size: 14.5, weight: 600, before: 4 } } as const;

/** The space before a block, after the one before it. */
function gapBefore(b: Block, prev: Block | undefined): number {
  if (!prev) return 0;
  if (b.type === 'heading') return ROW;
  if (prev.type === 'heading') return 2;
  if (b.type === 'space') return 0;
  return 8;
}

/** Blocks one under another from `top`, `x` to `x + w`; returns the px used. */
export function blocks(S: Surface, list_: Block[], x: number, top: number, w: number): number {
  const P = S.P;
  let y = top;
  let prev: Block | undefined;
  for (const b of list_) {
    // Each block starts on a row, so a strip can end before it.
    y = b.type === 'space' || !prev ? y : up(y + gapBefore(b, prev));
    const at = y;
    prev = b;
    switch (b.type) {
      case 'heading': {
        if (b.anchor) S.anchors[b.anchor] = y;
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
      case 'figure':
        y += figure(S, b, x, y, w);
        break;
    }
    // Boxes read as one: never cut across.
    if (b.type === 'stats' || b.type === 'callout' || (b.type === 'code' && y - at <= 16 * ROW)) S.keep(at, y);
  }
  return y - top;
}

export { up as upToRow, r, plain };
