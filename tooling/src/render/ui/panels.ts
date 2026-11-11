import { renderSequenceSvg } from '../sequence';
import { withTheme } from '../svg';
import { loadDocument } from '../../terminal/document';
import type { ActionBarPanel, BannerPanel, Control, NoticesPanel, Panel, PlayerHeaderPanel, ScenarioChip, SequencePanel, StepCard, StepPanel, SystemBarPanel, TabBarPanel, UiTheme, UseCaseBarPanel } from './contract';
import { BODY, CODE, CONTROL_ROW, blocks, codeBox, itemsRow, placeButton, upToRow } from './blocks';
import { CELL, CONTROL, Surface, buttonColumns, chip, drawLaid, icon, layoutRich, line, paragraph, rect, tint, txt, width, type Box, type ControlState } from './kit';
import { clip } from './metrics';
import { alpha, mix, paletteOf, type Palette } from './theme';

/**
 * Each panel kind laid out on a Surface `columns` cells wide, in the
 * editor's content in a terminal's clothes: drawn on a transparent
 * background so the terminal's own colour shows, bars as faint rounded
 * cards with a hairline (the use case bar's pink, as the text UI frames it),
 * tabs over a hairline with a slim accent underline under the current one,
 * the player's step card as UseCasePlayback.tsx, pages as the Analysis and
 * Results panels. Type is the terminal's size (14 px on an 8×16 cell),
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

/** A card: a faint rounded surface with a hairline (`border` for a coloured one), the terminal's background showing through. */
function card(P: Palette, x: number, y: number, w: number, h: number, border = P.card.line): string {
  return rect(x + 0.5, y + 0.5, w - 1, h - 1, { fill: P.card.fill, stroke: border, sw: 1, rx: 10 });
}

/**
 * A card around rows drawn by `inner`, from the panel's top: the card's
 * frame is drawn first (behind), so `inner` runs on a scratch surface to
 * learn its height, then again on the real one.
 */
function framed(S: Surface, border: string, inner: (S: Surface, top: number) => number): number {
  const scratch = new Surface(S.P, S.columns);
  const h = upToRow(inner(scratch, ROW) + ROW);
  S.add(card(S.P, 0, 0, S.width, h, border));
  inner(S, ROW);
  return h;
}

const TAB_LABEL = { size: 14, weight: 600 };

function tabs(S: Surface, p: TabBarPanel): number {
  const P = S.P;
  const H = CONTROL_ROW;
  // A hairline under the tabs, the current one's slim accent underline over it.
  S.add(rect(0, H - 1, S.width, 1, { fill: P.line }));
  let col = 0;
  for (const t of p.tabs) {
    const capW = t.hotkey ? CONTROL.keycap + 8 : 0;
    const badgeW = t.badge ? width(t.badge.text, { size: 12, weight: 700 }) + 14 + 7 : 0;
    const contentW = capW + width(t.label, { ...TAB_LABEL, weight: 700 }) + badgeW;
    const columns = Math.ceil((contentW + 28) / CELL.width);
    if (col + columns > S.columns) break;
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
        out.push(txt(x, cy + 5, t.label, { ...TAB_LABEL, weight: active ? 700 : 600, color }));
        x += width(t.label, { ...TAB_LABEL, weight: active ? 700 : 600 }) + 7;
        if (t.badge) {
          const bw = width(t.badge.text, { size: 12, weight: 700 }) + 14;
          const tone = P.tone[t.badge.tone];
          out.push(rect(x, cy - 9, bw, 18, { fill: alpha(tone, 0.16), rx: 9 }), txt(x + bw / 2, cy + 4.2, t.badge.text, { size: 12, weight: 700, color: tone, anchor: 'middle' }));
        }
        if (active) out.push(rect(box.x + 10, H - 3, box.w - 20, 3, { fill: P.accent, rx: 1.5 }));
        return out.join('');
      },
    });
    col += columns;
  }
  return H;
}

const CHIP_LABEL = { size: 14, weight: 600 };
const chipText = (s: ScenarioChip) => `${s.name}${s.status ? ` · ${s.status}` : ''}`;
const chipColumns = (s: ScenarioChip) => Math.ceil((width(chipText(s), { ...CHIP_LABEL, weight: 700 }) + 14 + 8 + 2 * CONTROL.pad + 2) / CELL.width);

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
        txt(x + CONTROL.pad + 22, box.y + box.h / 2 + 5 + dy, text, { ...CHIP_LABEL, weight: current ? 700 : 600, color: current || state !== 'rest' ? P.ink : tone }),
      ].join('');
    },
  });
  return columns;
}

function useCaseBar(S: Surface, p: UseCaseBarPanel): number {
  const P = S.P;
  return framed(S, alpha(P.accent, 0.55), (S, top) => {
    const label = { text: [{ text: 'Use case', tone: 'accent' as const, bold: true }] };
    const right = S.columns - 3;
    let y = top;
    y += itemsRow(S, [label, { select: p.picker }, { control: p.play }, { control: p.explore }], 2, y, right);
    for (const g of p.explorer ?? []) {
      y = upToRow(y);
      if (g.label) {
        S.add(txt(GUTTER, y + 13, g.label, { size: 13, weight: 700, color: P.blue, mono: true }));
        y += ROW + 4;
      }
      for (const u of g.useCases) {
        y = upToRow(y);
        const indent = g.label ? 4 : 2;
        const name = { size: 14, weight: u.current ? 700 : 500 };
        const nameCols = Math.ceil((width(u.name, name) + 14) / CELL.width);
        // The name on its own line when it and the scenarios do not fit one.
        const inline = nameCols + u.scenarios.reduce((s, c) => s + chipColumns(c) + 1, 0) <= right - indent;
        if (u.current) S.add(rect(indent * CELL.width - 8, y + CONTROL_ROW / 2 - 8, 3, 16, { fill: P.accent, rx: 1.5 }));
        S.add(txt(indent * CELL.width, inline ? y + CONTROL_ROW / 2 + 5 : y + 14, u.name, { ...name, color: P.ink }));
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
  });
}

function playerHeader(S: Surface, p: PlayerHeaderPanel): number {
  const P = S.P;
  return framed(S, alpha(P.accent, 0.55), (S, top) => {
    let y = top;
    const back = buttonColumns(p.back);
    placeButton(S, p.back, 2, y);
    const x = (2 + back + 2) * CELL.width;
    const title = { size: 16, weight: 700 };
    const titleW = Math.min(width(p.title, title), S.width - x - 3 * CELL.width);
    S.add(txt(x, y + CONTROL_ROW / 2 + 5.5, clip(p.title, S.width - x - 3 * CELL.width, 16, 700), { ...title, color: P.ink }));
    if (p.note && x + titleW + 60 < S.width - 3 * CELL.width) S.add(txt(x + titleW + 12, y + CONTROL_ROW / 2 + 5, clip(p.note, S.width - x - titleW - 12 - 3 * CELL.width, 13.5), { size: 13.5, color: P.muted }));
    y += CONTROL_ROW;
    if (p.scenarios?.length) {
      let col = 2;
      for (const s of p.scenarios) {
        if (col + chipColumns(s) > S.columns - 3) {
          col = 2;
          y += CONTROL_ROW;
        }
        col += scenarioControl(S, s, col, y, s.current) + 1;
      }
      y += CONTROL_ROW;
    }
    return y - top;
  });
}

// ---------- the step panel ----------

const EXEC: Record<StepCard['exec'], { label: string; color: 'green' | 'purple' | 'orange' }> = {
  sync: { label: 'Sync', color: 'green' },
  async: { label: 'Async', color: 'purple' },
  fire: { label: 'Fire & Forget', color: 'orange' },
};

/** Lines of a body the player shows; the rest is counted (BODY_LINES in register.tsx). */
const BODY_LINES = 8;

/** One step card from `top`, `x` to `x + w`; the px it took. */
function stepCard(S: Surface, s: StepCard, x: number, top: number, w: number): number {
  const P = S.P;
  const parts: string[] = [];
  let y = top;
  // The number: a disc, blue, or red once the call errs.
  const err = s.error === true || s.failed === true;
  const disc = err ? P.tone.bad : P.blue;
  parts.push(`<circle cx="${x + 15}" cy="${y + 15}" r="15" fill="${alpha(disc, 0.18)}"/>`, txt(x + 15, y + 20, String(s.number), { size: 14, weight: 700, color: disc, anchor: 'middle' }));
  const tx = x + 44;
  let cx = tx;
  const right = s.call ? width(s.call, { size: 13, mono: true }) + 16 : 0;
  const name = clip(s.name, w - 44 - right - 170, 15.5, 700);
  parts.push(txt(cx, y + 13, name, { size: 15.5, weight: 700, color: P.ink }));
  cx += width(name, { size: 15.5, weight: 700 }) + 10;
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
      const h = 18 + codeBox(S, b.body.text, bx, at + 18, bw, { language: b.body.format === 'JSON' ? 'json' : b.body.format === 'XML' ? 'xml' : undefined, maxLines: BODY_LINES, error: b.error });
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

/** The step at `at` with its parallel siblings; the px it took. */
function stepCards(S: Surface, p: StepPanel, cards: StepCard[], x: number, top: number, w: number): number {
  const P = S.P;
  let y = top;
  if (p.condition) {
    const laid = layoutRich([{ text: 'When: ', bold: true }, { text: p.condition }], w, { size: 13.5 }, false)[0];
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
    y += stepCard(S, c, x, y, w);
  });
  return y - top;
}

function stepPanel(S: Surface, p: StepPanel): number {
  const P = S.P;
  const total = p.steps.length;
  const at = Math.max(0, Math.min(p.at, total - 1));
  const x = GUTTER;
  const w = S.width - 2 * GUTTER;
  // As tall as the tallest step, so stepping moves nothing.
  const scratch = new Surface(P, S.columns);
  const tallest = Math.max(0, ...p.steps.map((cards) => stepCards(scratch, p, cards, x, 0, w)), stepCards(scratch, p, p.steps[at] ?? [], x, 0, w));
  return framed(S, P.card.line, (S, top) => {
    stepCards(S, p, p.steps[at] ?? [], x, top - 2, w);
    let y = upToRow(top - 2 + tallest + 6);
    S.add(line(1, y + 0.5, S.width - 1, y + 0.5, P.line, 1));
    const k = p.hotkeys ?? {};
    const hk = (id: keyof NonNullable<StepPanel['hotkeys']>) => (k[id] ? { hotkey: k[id] } : {});
    const ctl = (c: Control): { control: Control } => ({ control: c });
    const counter = `Step ${Math.min(at + 1, total)} of ${total}`;
    const playW = Math.max(buttonColumns({ id: 'x', icon: 'pause', label: 'Pause', ...hk('play') }), buttonColumns({ id: 'x', icon: 'play', label: 'Play', ...hk('play') }));
    y += itemsRow(
      S,
      [
        ctl({ id: 'first', icon: 'first', ...hk('first'), variant: 'quiet', disabled: at === 0 }),
        ctl({ id: 'prev', icon: 'prev', ...hk('prev'), variant: 'quiet', disabled: at === 0 }),
        ctl({ id: 'play', icon: p.playing ? 'pause' : 'play', label: p.playing ? 'Pause' : 'Play', variant: 'primary', columns: playW, ...hk('play') }),
        ctl({ id: 'next', icon: 'next', ...hk('next'), variant: 'quiet', disabled: at >= total - 1 }),
        ctl({ id: 'last', icon: 'last', ...hk('last'), variant: 'quiet', disabled: at >= total - 1 }),
        { text: [{ text: counter, bold: true }] },
        { progress: total ? (at + 1) / total : 0 },
        ctl({ id: 'exit', icon: 'exit', label: S.columns >= 96 ? 'Exit playback' : 'Exit', ...hk('exit'), variant: 'quiet' }),
      ],
      2,
      y,
      S.columns - 2,
    );
    return y - top;
  });
}

function systemBar(S: Surface, p: SystemBarPanel): number {
  const P = S.P;
  return framed(S, P.card.line, (S, top) => {
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
  return itemsRow(S, p.controls.map((c) => ({ control: c })), 0, 0, S.columns);
}

function banner(S: Surface, p: BannerPanel): number {
  const P = S.P;
  const resetCols = buttonColumns(p.reset);
  placeButton(S, p.reset, 0, 0);
  const x = (resetCols + 1) * CELL.width;
  const label = { size: 13.5, weight: 700 };
  const lw = Math.min(S.width - x - 8, width(p.label, label) + 24);
  const cy = CONTROL_ROW / 2;
  S.add(rect(x, cy - 12, lw, 24, { fill: P.yellow, rx: 12 }), txt(x + 12, cy + 5, clip(p.label, lw - 24, 13.5, 700), { ...label, color: P.onAccent }));
  if (p.note && x + lw + 12 < S.width - 60) S.add(txt(x + lw + 12, cy + 5, clip(p.note, S.width - x - lw - 20, 13.5), { size: 13.5, color: P.muted }));
  return CONTROL_ROW;
}

/** The load legend as LoadLegend.tsx: the heat scale, the p99 path, what edges say. */
function legend(S: Surface, critical: { useCase: string; p99: string } | undefined, x: number, y: number): void {
  const P = S.P;
  const out: string[] = [];
  const small = { size: 12.5, color: P.muted };
  let cx = x;
  const put = (s: string, style = small) => {
    out.push(txt(cx, y, s, style));
    cx += width(s, style) + 6;
  };
  put('Load');
  out.push(rect(cx, y - 5, 14, 3, { fill: '#FFD23F', rx: 1.5 }));
  cx += 18;
  put('40');
  for (const [fill, label] of [
    ['#FFD23F', '70'],
    ['#FF7AB4', '90'],
    ['#FF6B61', '100%'],
  ] as const) {
    out.push(rect(cx, y - 10, 13, 13, { fill, rx: 3 }));
    cx += 17;
    put(label);
  }
  if (critical) {
    cx += 8;
    out.push(line(cx, y - 4.5, cx + 18, y - 4.5, P.ink, 3.5));
    cx += 24;
    const t = `p99 path of "${critical.useCase}" ${critical.p99}`;
    if (cx + width(t, small) < S.width - 8) put(t);
  }
  const edges = '·  edges: rps · +latency';
  if (cx + 8 + width(edges, small) < S.width - 8) {
    cx += 8;
    put(edges);
  }
  S.add(...out);
}

function notices(S: Surface, p: NoticesPanel): number {
  const P = S.P;
  let y = 4;
  const x = CELL.width;
  const w = S.width - 2 * CELL.width;
  for (const n of p.notices ?? []) {
    const tone = n.tone ?? 'warn';
    const color = tone === 'muted' ? P.muted : tone === 'bad' ? P.tone.bad : P.tone.warn;
    const laid = layoutRich([{ text: n.text }, ...(n.hint ? [{ text: `  → ${n.hint}`, tone: 'muted' as const }] : [])], w - 24, BODY, false)[0];
    S.add(icon('warn', x, y + 3, 15, color, 1.8), drawLaid(P, laid, x + 23, y + 15, BODY, color));
    y += 22;
  }
  if (p.legend) {
    legend(S, p.legend.critical, x, y + 15);
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
    if (p.details) placeButton(S, p.details, S.columns - detailsCols, y);
    y += CONTROL_ROW;
  }
  return y + 2;
}

function page(S: Surface, b: Extract<Panel, { kind: 'page' }>): number {
  return blocks(S, b.blocks, GUTTER, ROW / 2, S.width - 2 * GUTTER) + ROW;
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
  let y = 0;
  if (p.controls?.length) y += itemsRow(S, p.controls, 2, ROW / 2, S.columns - 3) + ROW / 2;
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
  // Narrower than the panel: drawn at its size; wider: scaled to fit.
  const k = Math.min(1, (S.width - 8) / w);
  S.addWithin({ x: 0, y, w: S.width, h: h * k + 8 }, `<g transform="translate(4 ${y + 4})${k < 1 ? ` scale(${Math.round(k * 1000) / 1000})` : ''}">${inner}</g>`);
  return y + h * k + 8;
}

/** Lays `panel` out `columns` wide in `theme`. */
export function drawPanel(panel: Panel, columns: number, theme: UiTheme): Drawn {
  if (!Number.isInteger(columns) || columns < 20 || columns > 255) throw new Error(`A panel is 20 to 255 columns wide, not ${columns}`);
  const S = new Surface(paletteOf(theme), columns);
  let h: number;
  switch (panel.kind) {
    case 'tabs':
      h = tabs(S, panel);
      break;
    case 'useCaseBar':
      h = useCaseBar(S, panel);
      break;
    case 'playerHeader':
      h = playerHeader(S, panel);
      break;
    case 'step':
      h = stepPanel(S, panel);
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
    case 'banner':
      h = banner(S, panel);
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
  return { surface: S, height: Math.max(ROW, upToRow(h)) };
}

export { CODE, chip };
