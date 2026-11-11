import { renderSequenceSvg } from '../sequence';
import { withTheme } from '../svg';
import { loadDocument } from '../../terminal/document';
import type { ActionBarPanel, Block, Control, DrawerPanel, ExplorerPanel, Item, MenuPanel, NoticesPanel, Panel, PlayerBarPanel, Rich, ScenarioChip, Select, SequencePanel, StepCard, SystemBarPanel, TabBarPanel, UiTheme } from './contract';
import { BODY, CODE, CONTROL_ROW, blocks, codeBox, itemsRow, measureRich, menu, placeButton, upToRow } from './blocks';
import { CELL, CONTROL, Surface, buttonColumns, chip, drawLaid, drawSelect, icon, layoutRich, line, paragraph, rect, selectColumns, surfaceFrame, tint, txt, width, type Box, type ControlState, type Edges } from './kit';
import { clip } from './metrics';
import { alpha, mix, paletteOf, type Palette } from './theme';

/**
 * Each panel kind laid out on a Surface `columns` cells wide, in the
 * editor's content in a terminal's clothes. A drawing is one continuous
 * surface (the panels stacked, the diagram among them): every panel fills
 * its width with the surface's opaque colour, a hairline down each side,
 * a divider along its top unless it is the drawing's first, and rounded
 * outer corners only where it is the drawing's top or bottom (`Edges`).
 * Inside, sections are parted by dividers, never by the terminal's
 * background. Tabs with a slim accent underline under the current one, the
 * player's step card as UseCasePlayback.tsx, pages as the Analysis and
 * Results panels. Type is the terminal's size (14 px on an 8×17 cell),
 * control rows three cells tall. The height is whole rows.
 */

export interface Drawn {
  surface: Surface;
  /** px, a whole number of rows. */
  height: number;
}

const ROW = CELL.height;
/** A page's or a card's inner margin: two columns. */
const GUTTER = 2 * CELL.width;

/** A section filling rows `top` to `bottom` (px, on row boundaries): where strips are best cut, a divider along its top unless it is the panel's first (or `divider` is false). */
function section(S: Surface, top: number, bottom: number, divider = top > 0): void {
  S.card(top, bottom);
  if (divider) S.add(line(1, top + 0.5, S.width - 1, top + 0.5, S.P.line, 1));
}

/**
 * A section of rows drawn by `inner` from `top` (the panel's top): `inner`
 * runs on a scratch surface to learn its height, then on the real one; `pad`
 * px inside above it.
 */
function framed(S: Surface, inner: (S: Surface, top: number) => number, top = 0, pad = ROW, divider = top > 0): number {
  const scratch = new Surface(S.P, S.columns);
  const h = upToRow(inner(scratch, top + pad) + pad + 4);
  section(S, top, top + h, divider);
  inner(S, top + pad);
  return h;
}

const TAB_LABEL = { size: 14, weight: 600 };

function tabs(S: Surface, p: TabBarPanel): number {
  const P = S.P;
  const H = CONTROL_ROW;
  // The current tab's slim accent underline at its foot.
  section(S, 0, H);
  let col = 1;
  for (const t of p.tabs) {
    const capW = t.hotkey ? CONTROL.keycap + 8 : 0;
    const badgeW = t.badge ? width(t.badge.text, { size: 12, weight: 600 }) + 14 + 7 : 0;
    const contentW = capW + width(t.label, { ...TAB_LABEL, weight: 600 }) + badgeW;
    const columns = Math.ceil((contentW + 28) / CELL.width);
    if (col + columns > S.columns - 1) break;
    const box: Box = { x: col * CELL.width, y: 0, w: columns * CELL.width, h: H };
    const active = t.id === p.active;
    S.place({
      control: { id: t.id, kind: 'tab', ...(t.hotkey ? { hotkey: t.hotkey } : {}) },
      box,
      draw: (state: ControlState) => {
        const color = active || state !== 'rest' ? P.ink : P.muted;
        const out: string[] = [];
        if (state !== 'rest') out.push(rect(box.x + 3, 7, box.w - 6, H - 15, { fill: alpha(P.ink, state === 'pressed' ? 0.15 : 0.08), rx: 7 }));
        let x = box.x + 14;
        const cy = H / 2 - 1;
        if (t.hotkey) {
          out.push(rect(x + 0.5, cy - 8.5, CONTROL.keycap - 1, 17, { stroke: alpha(color, 0.42), sw: 1, rx: 4 }), txt(x + CONTROL.keycap / 2, cy + 3.8, t.hotkey, { size: 10.5, mono: true, weight: 700, color: alpha(color, 0.85), anchor: 'middle' }));
          x += CONTROL.keycap + 8;
        }
        out.push(txt(x, cy + 5, t.label, { ...TAB_LABEL, weight: active ? 600 : 600, color }));
        x += width(t.label, { ...TAB_LABEL, weight: active ? 600 : 600 }) + 7;
        if (t.badge) {
          const bw = width(t.badge.text, { size: 12, weight: 600 }) + 14;
          const tone = P.tone[t.badge.tone];
          out.push(rect(x, cy - 9, bw, 18, { fill: alpha(tone, 0.16), rx: 9 }), txt(x + bw / 2, cy + 4.2, t.badge.text, { size: 12, weight: 600, color: tone, anchor: 'middle' }));
        }
        if (active) out.push(rect(box.x + 10, H - 6, box.w - 20, 3, { fill: P.accent, rx: 1.5 }));
        return out.join('');
      },
    });
    col += columns;
  }
  // The editor, at the row's right end: its label shortened, then the icon alone, where the tabs leave less room.
  if (p.open) {
    const fits = [p.open, { ...p.open, label: 'Proschi' }, { ...p.open, label: undefined }].find((c) => col + 1 + buttonColumns(c) <= S.columns - 1);
    if (fits) placeButton(S, fits, S.columns - 1 - buttonColumns(fits), 0);
  }
  return H;
}

const CHIP_LABEL = { size: 14, weight: 600 };
const chipText = (s: ScenarioChip) => `${s.name}${s.status ? ` · ${s.status}` : ''}`;
const chipColumns = (s: ScenarioChip) => Math.ceil((width(chipText(s), { ...CHIP_LABEL, weight: 600 }) + 14 + 8 + 2 * CONTROL.pad + 2) / CELL.width);

/** A scenario as the editor's scenario tabs name it: ✓ or ✗, the name, the status an error ends with; the current one filled. */
function scenarioControl(S: Surface, s: ScenarioChip, col: number, top: number, current?: boolean): number {
  const P = S.P;
  const text = chipText(s);
  const error = s.outcome === 'error';
  const columns = chipColumns(s);
  const box: Box = { x: col * CELL.width, y: top + (CONTROL_ROW - CONTROL.height) / 2, w: columns * CELL.width, h: CONTROL.height };
  S.place({
    control: { id: s.id, kind: 'button' },
    box,
    draw: (state) => {
      const tone = error ? P.tone.bad : P.tone.good;
      const fill = state === 'pressed' ? alpha(tone, 0.34) : current ? alpha(tone, 0.24) : state === 'hover' ? alpha(tone, 0.2) : alpha(tone, 0.1);
      const x = box.x + 1;
      const w = box.w - 2;
      const dy = state === 'pressed' ? 1 : 0;
      return [
        rect(x + 0.5, box.y + 0.5, w - 1, box.h - 1, { fill, rx: 7, ...(current || state !== 'rest' ? { stroke: alpha(tone, current ? 0.85 : 0.5), sw: current ? 1.5 : 1 } : {}) }),
        icon(error ? 'cross' : 'check', x + CONTROL.pad, box.y + box.h / 2 - 7 + dy, 14, tone, 2.4),
        txt(x + CONTROL.pad + 22, box.y + box.h / 2 + 5 + dy, text, { ...CHIP_LABEL, weight: current ? 600 : 600, color: current || state !== 'rest' ? P.ink : tone }),
      ].join('');
    },
  });
  return columns;
}

// ---------- the player bar and what floats over the drawing ----------

/** The player bar's second line: two rows. */
const BAR_LINE = 2 * ROW;
/** The player bar: a row of controls and its second line, whether a scenario plays or not. */
export const PLAYER_BAR_ROWS = (CONTROL_ROW + BAR_LINE) / ROW;

const LINE = { size: 13.5 };

/**
 * The player bar (PlayerBarPanel): `Use case [▾] [▾]  ⏮ ‹ ▶ › ⏭ ✕  Step 2/5
 * ━━──` over `② GET /x · A → B · Sync  [Body ▾]`. Always the same rows; too
 * narrow, it drops the label, then the first and last keys, then narrows the
 * pickers and the count, then the progress bar, so the row never wraps.
 */
function playerBar(S: Surface, p: PlayerBarPanel): number {
  const P = S.P;
  const H = CONTROL_ROW + BAR_LINE;
  section(S, 0, H);
  const at = p.step.at;
  const total = p.step.total;
  const byId = new Map(p.controls.map((c) => [c.id, c]));
  const control = (id: string): Item[] => (byId.has(id) ? [{ control: byId.get(id)! }] : []);
  const widest = (s: Select) => Math.max(...s.options.map((o) => selectColumns(o.label, undefined, !!o.icon)), selectColumns('Main flow'));
  const counter = (short: boolean): Item => {
    const text = (n: string) => (short ? `${n}/${total}` : `Step ${n}/${total}`);
    return { text: [{ text: text(at === undefined ? '–' : String(at)), bold: at !== undefined, ...(at === undefined ? { tone: 'muted' as const } : {}) }], columns: Math.ceil((width(text(String(total)), { ...BODY, weight: 600 }) + 2) / CELL.width) };
  };
  const variants = [
    { label: true, ends: true, cap: 28, short: false, progress: true },
    { label: false, ends: true, cap: 28, short: false, progress: true },
    { label: false, ends: false, cap: 22, short: false, progress: true },
    { label: false, ends: false, cap: 16, short: true, progress: true },
    { label: false, ends: false, cap: 13, short: true, progress: false },
    { label: false, ends: false, cap: 10, short: true, progress: false },
    { label: false, ends: false, cap: 8, short: true, progress: false, steps: false },
  ];
  const itemsOf = (v: { label: boolean; ends: boolean; cap: number; short: boolean; progress: boolean; steps?: boolean }): Item[] => [
    ...(v.label ? [{ text: [{ text: 'Use case', bold: true, tone: 'accent' as const }] }] : []),
    { select: { ...p.useCase, floats: true, columns: Math.min(v.cap, widest(p.useCase)) } },
    { select: { ...p.scenario, floats: true, columns: Math.min(v.cap, widest(p.scenario)) } },
    ...(v.ends ? control('first') : []),
    ...(v.steps !== false ? control('prev') : []),
    ...control('play'),
    ...(v.steps !== false ? control('next') : []),
    ...(v.ends ? control('last') : []),
    ...control('stop'),
    counter(v.short),
    ...(v.progress ? [{ progress: total && at !== undefined ? at / total : 0 }] : []),
  ];
  const need = (it: Item) => ('control' in it ? buttonColumns(it.control) : 'select' in it ? it.select.columns! : 'text' in it ? it.columns! : 'progress' in it ? 8 : 0);
  const room = S.columns - 2;
  const items = variants.map(itemsOf).find((list) => list.reduce((s, it) => s + need(it) + 1, -1) <= room) ?? itemsOf(variants.at(-1)!);
  itemsRow(S, items, 1, 0, S.columns - 1);
  // The second line: the step, or a note before Play; Body ▾ at its end.
  const cy = CONTROL_ROW + BAR_LINE / 2;
  let x = GUTTER;
  let right = S.width - GUTTER;
  if (p.body) {
    const b = p.body;
    const columns = selectColumns(b.label ?? 'Body');
    const box: Box = { x: (S.columns - 1 - columns) * CELL.width, y: cy - 13, w: columns * CELL.width, h: 26 };
    S.place({ control: { id: b.id, kind: 'toggle', ...(b.hotkey ? { hotkey: b.hotkey } : {}), ...(b.disabled ? { disabled: true } : {}) }, box, draw: (state) => (b.disabled ? drawSelect(P, b.label ?? 'Body', box, 'rest', false, undefined, undefined, true) : drawSelect(P, b.label ?? 'Body', box, state, b.active === true)) });
    right = box.x - 12;
  }
  if (p.line.number !== undefined) {
    const color = p.line.error ? P.tone.bad : P.blue;
    S.add(`<circle cx="${x + 10}" cy="${cy}" r="10" fill="${alpha(color, 0.2)}"/>`, txt(x + 10, cy + 4.5, String(p.line.number), { size: 12.5, weight: 600, color, anchor: 'middle' }));
    x += 28;
  }
  const laid = layoutRich(p.line.text, right - x, LINE, false)[0];
  S.add(drawLaid(P, laid, x, cy + 5, LINE, P.ink));
  return H;
}

/** A select's menu as a card of its own, floated over the drawing under its select. */
function menuPanel(S: Surface, p: MenuPanel): number {
  return menu(S, p.select, 0, 0, S.columns, false);
}

/** A float's header: its title and ✕. */
function floatHead(S: Surface, title: Rich, close: Control | undefined, top: number): number {
  return itemsRow(S, [{ text: title }, { spacer: true }, ...(close ? [{ control: close }] : [])], 2, top, S.columns - 2);
}

/** The current step's card, its bodies whole (to a point), floated under the player bar. */
function drawer(S: Surface, p: DrawerPanel): number {
  const x = GUTTER;
  const w = S.width - 2 * GUTTER;
  return framed(
    S,
    (S, top) => {
      let y = top + floatHead(S, [{ text: p.cards.length > 1 ? `Steps ${p.cards.map((c) => c.number).join(', ')}` : `Step ${p.cards[0]?.number ?? ''}`, bold: true }, { text: '  request and response', tone: 'muted' }], p.close, top);
      y = upToRow(y + 4);
      y += stepCards(S, p.condition, p.cards, x, y, w, DRAWER_BODY_LINES);
      return y - top;
    },
    0,
    ROW / 2,
  );
}

/** Every use case by endpoint, each scenario a button that plays it, floated under the use case picker. */
function explorer(S: Surface, p: ExplorerPanel): number {
  const P = S.P;
  return framed(
    S,
    (S, top) => {
      const right = S.columns - 3;
      let y = top + floatHead(S, [{ text: 'All use cases', bold: true }, { text: '  pick a scenario to play it', tone: 'muted' }], p.close, top);
      for (const g of p.groups) {
        y = upToRow(y);
        if (g.label) {
          S.add(txt(GUTTER, y + 13, clip(g.label, S.width - 2 * GUTTER, 13, 700, true), { size: 13, weight: 700, color: P.blue, mono: true }));
          y += ROW + 4;
        }
        for (const u of g.useCases) {
          y = upToRow(y);
          const indent = g.label ? 4 : 2;
          const name = { size: 14, weight: u.current ? 600 : 500 };
          const nameCols = Math.ceil((width(u.name, name) + 14) / CELL.width);
          // The name on its own line when it and the scenarios do not fit one.
          const inline = nameCols + u.scenarios.reduce((s, c) => s + chipColumns(c) + 1, 0) <= right - indent;
          // The current one marked beside its name, on the chips' row or its own line.
          if (u.current) S.add(rect(indent * CELL.width - 8, inline ? y + CONTROL_ROW / 2 - 8 : y + 2, 3, 16, { fill: P.accent, rx: 1.5 }));
          S.add(txt(indent * CELL.width, inline ? y + CONTROL_ROW / 2 + 5 : y + 14, clip(u.name, (right - indent) * CELL.width, 14, name.weight), { ...name, color: P.ink }));
          let col = indent + (inline ? nameCols : 2);
          if (!inline) y += ROW + 2;
          y = upToRow(y);
          for (const c of u.scenarios) {
            if (col + chipColumns(c) > right) {
              col = indent + 2;
              y += CONTROL_ROW;
            }
            col += scenarioControl(S, c, col, y) + 1;
          }
          y += CONTROL_ROW;
        }
      }
      return y - top;
    },
    0,
    ROW / 2,
  );
}

// ---------- step cards ----------

const EXEC: Record<StepCard['exec'], { label: string; color: 'green' | 'purple' | 'orange' }> = {
  sync: { label: 'Sync', color: 'green' },
  async: { label: 'Async', color: 'purple' },
  fire: { label: 'Fire & Forget', color: 'orange' },
};

/** Lines of a body the drawer shows; the rest is counted. */
const DRAWER_BODY_LINES = 24;

/** The kind of call a step is, as its chip names it. */
export const execLabel = (exec: StepCard['exec']) => EXEC[exec].label;

/** One step card from `top`, `x` to `x + w`; the px it took. */
function stepCard(S: Surface, s: StepCard, x: number, top: number, w: number, bodyLines: number): number {
  const P = S.P;
  const parts: string[] = [];
  let y = top;
  // The number: a disc, blue, or red once the call errs.
  const err = s.error === true || s.failed === true;
  const disc = err ? P.tone.bad : P.blue;
  parts.push(`<circle cx="${x + 15}" cy="${y + 15}" r="15" fill="${alpha(disc, 0.18)}"/>`, txt(x + 15, y + 20, String(s.number), { size: 14, weight: 600, color: disc, anchor: 'middle' }));
  const tx = x + 44;
  let cx = tx;
  const right = s.call ? width(s.call, { size: 13, mono: true }) + 16 : 0;
  const name = clip(s.name, w - 44 - right - 170, 15.5, 600);
  parts.push(txt(cx, y + 13, name, { size: 15.5, weight: 600, color: P.ink }));
  cx += width(name, { size: 15.5, weight: 600 }) + 10;
  const chips: { svg: string; width: number }[] = [];
  if (s.failed) chips.push(tint(P, cx, y + 13, 'Failed', 'red'));
  else if (s.status !== undefined && s.status >= 400) chips.push(tint(P, cx, y + 13, String(s.status), 'red'));
  for (const c of chips) {
    parts.push(c.svg);
    cx += c.width + 6;
  }
  if (!(s.exec === 'sync' && s.failed)) parts.push(tint(P, cx, y + 13, EXEC[s.exec].label, EXEC[s.exec].color).svg);
  if (s.call) parts.push(txt(x + w, y + 13, clip(s.call, right, 13, 500, true), { size: 13, mono: true, color: P.muted, anchor: 'end' }));
  parts.push(txt(tx, y + 33, clip(`${s.from}  →  ${s.to}`, w - 44, 13.5), { size: 13.5, color: P.muted }));
  y += 44;
  S.add(...parts);
  if (s.description) {
    const p = paragraph(P, s.description.replace(/\s*\n\s*/g, ' '), tx, y, w - 44, { size: 13.5 }, mix(P.ink, P.surface, 0.82), 20, 2);
    S.add(p.svg);
    y += p.height + 6;
  }
  const bodies = [s.request && { label: `Request (${s.request.format})`, body: s.request, error: false }, s.response && { label: `Response (${s.response.format})${s.response.status !== undefined ? ` - ${s.response.status}` : ''}`, body: s.response, error: s.response.error === true }].filter(
    (b): b is { label: string; body: NonNullable<StepCard['request']>; error: boolean } => !!b,
  );
  if (bodies.length) {
    // Side by side where both fit (the editor's two columns from `sm`), else one under the other.
    const side = bodies.length === 2 && w - 44 >= 560;
    const bw = side ? (w - 44 - 14) / 2 : w - 44;
    let tallest = 0;
    let by = y;
    bodies.forEach((b, i) => {
      const bx = side ? tx + i * (bw + 14) : tx;
      const at = side ? y : by;
      S.add(txt(bx, at + 12, b.label, { size: 12.5, weight: 600, color: b.error ? P.tone.bad : P.muted }));
      const h = 18 + codeBox(S, b.body.text, bx, at + 18, bw, { language: b.body.format === 'JSON' ? 'json' : b.body.format === 'XML' ? 'xml' : undefined, maxLines: bodyLines, error: b.error });
      tallest = Math.max(tallest, h);
      by = at + h + 8;
    });
    y = side ? y + tallest + 6 : by;
  }
  if (s.failed) {
    S.add(txt(tx, y + 14, 'No response: the call failed (timeout, connection refused or similar).', { size: 13.5, weight: 500, color: P.tone.bad }));
    y += 22;
  } else if (!s.response && s.status !== undefined && s.status >= 400) {
    S.add(txt(tx, y + 14, `Answered with ${s.status}`, { size: 13.5, weight: 500, color: P.tone.bad }));
    y += 22;
  }
  return y - top;
}

/** A step with its parallel siblings; the px it took. */
function stepCards(S: Surface, condition: string | undefined, cards: StepCard[], x: number, top: number, w: number, bodyLines: number): number {
  const P = S.P;
  let y = top;
  if (condition) {
    const laid = layoutRich([{ text: 'When: ', bold: true }, { text: condition }], w, { size: 13.5 }, false)[0];
    S.add(drawLaid(P, laid, x, y + 14, { size: 13.5 }, mix(P.ink, P.surface, 0.82)));
    y += 26;
  }
  if (cards.length > 1) {
    S.add(icon('bolt', x, y + 1, 15, P.blue), txt(x + 22, y + 13, `Parallel Execution (${cards.length} steps running simultaneously)`, { size: 13.5, weight: 600, color: P.blue }));
    y += 26;
  }
  if (cards.length === 0) {
    S.add(txt(x, y + 15, 'This scenario has no steps.', { size: 14, color: P.muted }));
    y += 26;
  }
  cards.forEach((c, i) => {
    if (i > 0) {
      S.add(line(x, y + 7, x + w, y + 7, P.line, 1));
      y += 16;
    }
    y += stepCard(S, c, x, y, w, bodyLines);
  });
  return y - top;
}

function systemBar(S: Surface, p: SystemBarPanel): number {
  const P = S.P;
  return framed(S, (S, top) => {
    let y = top;
    if (p.inside) {
      S.add(txt(GUTTER, y + 13, clip(`Inside ${p.inside}`, S.width - 2 * GUTTER, 13), { size: 13, color: P.muted }));
      y += ROW + 2;
    }
    const selected: { text: { text: string; tone?: 'accent' | 'muted'; bold?: boolean }[] } = p.selected
      ? { text: [{ text: 'System  ', bold: true }, { text: p.selected.name, tone: 'accent', bold: true }, { text: `  ${p.selected.path}`, tone: 'muted' }] }
      : { text: [{ text: 'System  ', bold: true }, { text: 'none here', tone: 'muted' }] };
    y += itemsRow(S, [selected, ...p.controls.map((c) => ({ control: c }))], 2, y, S.columns - 2);
    return y - top;
  });
}

function actionBar(S: Surface, p: ActionBarPanel): number {
  section(S, 0, CONTROL_ROW);
  return itemsRow(S, p.controls.map((c) => ({ control: c })), 1, 0, S.columns - 1);
}

/**
 * The load legend as LoadLegend.tsx says it, in one short row: the heat
 * scale as small swatches, the p99 path's stroke and what it is. Its left at
 * x, its text's baseline at y, at most `max` px wide (the p99 part goes
 * first, then the scale's labels). The diagram's strip draws it as a badge
 * (terminal/rasterHost.ts).
 */
export function legend(P: Palette, critical: { useCase: string; p99: string } | undefined, x: number, y: number, max = Infinity): { svg: string; width: number } {
  const out: string[] = [];
  const small = { size: 11, weight: 500, color: P.muted };
  let cx = x;
  const put = (s: string, style = small) => {
    out.push(txt(cx, y, s, style));
    cx += width(s, style) + 5;
  };
  put('Load', { ...small, weight: 600 });
  cx += 2;
  for (const [fill, label] of [
    ['#FFD23F', '40'],
    ['#FFD23F', '70'],
    ['#FF7AB4', '90'],
    ['#FF6B61', '100%'],
  ] as const) {
    out.push(label === '40' ? rect(cx, y - 5, 10, 3, { fill, rx: 1.5 }) : rect(cx, y - 8.5, 9, 9, { fill, rx: 2 }));
    cx += label === '40' ? 13 : 12;
    put(label);
  }
  if (critical) {
    const t = `p99 ${critical.useCase} ${critical.p99}`;
    if (cx - x + 30 + width(t, small) <= max) {
      cx += 7;
      out.push(line(cx, y - 4, cx + 14, y - 4, P.ink, 3));
      cx += 19;
      put(t);
    }
  }
  return { svg: out.join(''), width: cx - 5 - x };
}

function notices(S: Surface, p: NoticesPanel): number {
  return framed(S, (S, top) => noticeRows(S, p, top), 0, ROW / 2);
}

function noticeRows(S: Surface, p: NoticesPanel, top: number): number {
  const P = S.P;
  let y = top;
  const x = GUTTER;
  const w = S.width - 2 * GUTTER;
  for (const n of p.notices ?? []) {
    const tone = n.tone ?? 'warn';
    const color = tone === 'muted' ? P.muted : tone === 'bad' ? P.tone.bad : P.tone.warn;
    const laid = layoutRich([{ text: n.text }, ...(n.hint ? [{ text: `  → ${n.hint}`, tone: 'muted' as const }] : [])], w - 24, BODY, false)[0];
    S.add(icon('warn', x, y + 3, 15, color, 1.8), drawLaid(P, laid, x + 23, y + 15, BODY, color));
    y += 22;
  }
  if (p.legend) {
    S.add(legend(P, p.legend.critical, x, y + 15, w).svg);
    y += 24;
  }
  if (p.verdict) {
    y = upToRow(y);
    const { passed, total, first } = p.verdict;
    const failing = total - passed;
    const checks = total === 1 ? 'check' : 'checks';
    const detailsCols = p.details ? buttonColumns(p.details) + 1 : 0;
    const room = w - detailsCols * CELL.width - 24;
    const head = failing === 0 ? `All ${total} ${checks} pass` : `${failing} of ${total} ${checks} fail`;
    const laid = layoutRich([{ text: head, bold: true, tone: failing ? 'bad' : 'good' }, ...(failing && first ? [{ text: `: ${first}` }] : [])], room, BODY, false)[0];
    S.add(icon(failing ? 'cross' : 'check', x, y + CONTROL_ROW / 2 - 8, 16, failing ? P.tone.bad : P.tone.good, 2.4), drawLaid(P, laid, x + 23, y + CONTROL_ROW / 2 + 5, BODY, P.ink));
    if (p.details) placeButton(S, p.details, S.columns - 1 - detailsCols, y);
    y += CONTROL_ROW;
  }
  return y - top;
}

/**
 * A page: its blocks in sections, one from each heading to the next, the
 * stats and callouts of their own; a divider above each heading's section,
 * where its strips are best cut.
 */
function page(S: Surface, b: Extract<Panel, { kind: 'page' }>): number {
  const sections: { blocks: Block[]; bare: boolean }[] = [];
  for (const block of b.blocks) {
    const bare = block.type === 'stats' || block.type === 'callout';
    const last = sections.at(-1);
    if (bare || !last || last.bare || (block.type === 'heading' && (block.level ?? 2) <= 2)) sections.push({ blocks: [block], bare });
    else last.blocks.push(block);
  }
  let y = 0;
  for (const [i, part] of sections.entries()) y += framed(S, (S, top) => blocks(S, part.blocks, GUTTER, top, S.width - 2 * GUTTER), y, part.bare ? ROW / 2 : ROW, i > 0 && !part.bare);
  return y;
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

/** The sequence SVG of `proschi render`, its outer <svg> taken off so it draws inside the panel. */
function sequence(S: Surface, p: SequencePanel, theme: UiTheme): number {
  return framed(S, (S, top) => sequenceDrawing(S, p, theme, top), 0, ROW / 2);
}

function sequenceDrawing(S: Surface, p: SequencePanel, theme: UiTheme, top: number): number {
  let y = top;
  if (p.controls?.length) {
    // One row however long the scenario's name: a select as wide whichever option shows, narrowed (its label cut) to leave the rest room.
    const room = S.columns - 5;
    const others = p.controls.reduce((s, it) => s + ('text' in it ? Math.ceil((measureRich(it.text, BODY) + 2) / CELL.width) + 1 : 'control' in it ? buttonColumns(it.control) + 1 : 0), 0);
    const controls = p.controls.map((it): Item => {
      if (!('select' in it)) return it;
      const widest = Math.max(...it.select.options.map((o) => selectColumns(o.label, it.select.hotkey, !!o.icon)));
      return { select: { ...it.select, columns: Math.max(12, Math.min(it.select.columns ?? widest, room - others)) } };
    });
    y += itemsRow(S, controls, 2, y, S.columns - 3);
  }
  const doc = loadDocument(p.source);
  if (doc.errors.length) throw new Error(doc.errors.map((e) => `${e.line}:${e.col} ${e.message}`).join('\n'));
  const u = doc.diagram.useCases.find((c) => c.id === p.useCase || c.name === p.useCase);
  if (!u) throw new Error(`No use case '${p.useCase}'`);
  const s = p.scenario === undefined ? u.scenarios[0] : u.scenarios.find((c) => c.id === p.scenario || c.name === p.scenario);
  if (!s) throw new Error(`No scenario '${p.scenario}' in '${u.id}'`);
  const svg = withTheme(theme, () => renderSequenceSvg(doc.diagram, u, s, 'seq-', { current: p.current ?? [] }));
  const w = Number(/width="(\d+)"/.exec(svg)![1]);
  const h = Number(/height="(\d+)"/.exec(svg)![1]);
  const inner = svg
    .replace(/^<svg[^>]*>\n?/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/<title>[\s\S]*?<\/title>\n?/, '')
    .replace(/<rect width="100%" height="100%"[^>]*\/>\n?/, '')
    .replace(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/g, (_, attrs: string, body: string) => flatten(attrs, body));
  // Narrower than the card: drawn at its size; wider: scaled to fit.
  const k = Math.min(1, (S.width - 2 * CELL.width) / w);
  S.addWithin({ x: 0, y, w: S.width, h: h * k }, `<g transform="translate(${CELL.width} ${y})${k < 1 ? ` scale(${Math.round(k * 1000) / 1000})` : ''}">${inner}</g>`);
  return y + h * k - top;
}

/** Lays `panel` out `columns` wide in `theme`, on the drawing's surface at its `edges`. */
export function drawPanel(panel: Panel, columns: number, theme: UiTheme, edges: Edges = {}): Drawn {
  if (!Number.isInteger(columns) || columns < 20 || columns > 255) throw new Error(`A panel is 20 to 255 columns wide, not ${columns}`);
  const S = new Surface(paletteOf(theme), columns);
  let h: number;
  switch (panel.kind) {
    case 'tabs':
      h = tabs(S, panel);
      break;
    case 'playerBar':
      h = playerBar(S, panel);
      break;
    case 'menu':
      h = menuPanel(S, panel);
      break;
    case 'drawer':
      h = drawer(S, panel);
      break;
    case 'explorer':
      h = explorer(S, panel);
      break;
    case 'systemBar':
      h = systemBar(S, panel);
      break;
    case 'actionBar':
      h = actionBar(S, panel);
      break;
    case 'notices':
      h = notices(S, panel);
      break;
    case 'page':
      h = page(S, panel);
      break;
    case 'sequence':
      h = sequence(S, panel, theme);
      break;
    default:
      throw new Error(`Unknown panel kind '${(panel as { kind: string }).kind}'`);
  }
  const height = Math.max(ROW, upToRow(h));
  S.under(surfaceFrame(S.P, S.width, height, edges));
  return { surface: S, height };
}

export { CODE, chip };
