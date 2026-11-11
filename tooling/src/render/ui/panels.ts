import { renderSequenceSvg } from '../sequence';
import { withTheme } from '../svg';
import { loadDocument } from '../../terminal/document';
import type { ActionBarPanel, BannerPanel, Control, NoticesPanel, Panel, PlayerHeaderPanel, ScenarioChip, SequencePanel, StepCard, StepPanel, SystemBarPanel, TabBarPanel, UiTheme, UseCaseBarPanel } from './contract';
import { BODY, CODE, CONTROL_ROW, blocks, codeBox, itemsRow, placeButton, upToRow } from './blocks';
import { CELL, CONTROL, Surface, buttonColumns, chip, drawLaid, icon, layoutRich, line, paragraph, rect, tint, txt, width, type Box, type ControlState } from './kit';
import { clip } from './metrics';
import { mix, paletteOf, type Palette } from './theme';

/**
 * Each panel kind laid out on a Surface `columns` cells wide, in the
 * editor's look: bars as cards with an ink border and a hard shadow (the use
 * case bar's in pink, as the text UI frames it), tabs with the thick
 * underline (design/widgets.css .ps-tab), the player's step card as
 * UseCasePlayback.tsx, pages as the Analysis and Results panels. The height
 * is whole rows.
 */

export interface Drawn {
  surface: Surface;
  /** px, a whole number of rows. */
  height: number;
}

const ROW = CELL.height;
/** A page's or a card's inner margin: two columns. */
const GUTTER = 2 * CELL.width;

/** A card: surface, an ink (or `border`) frame, the hard shadow. */
function card(P: Palette, x: number, y: number, w: number, h: number, border = P.ink): string {
  return [rect(x + 3, y + 3, w - 3, h - 3, { fill: P.shadow, rx: 8 }), rect(x + 1, y + 1, w - 5, h - 5, { fill: P.surface, stroke: border, sw: 2, rx: 7 })].join('');
}

/**
 * A card around rows drawn by `inner`, from the panel's top: the card's
 * frame is drawn first (behind), so `inner` runs on a scratch surface to
 * learn its height, then again on the real one.
 */
function framed(S: Surface, border: string, inner: (S: Surface, top: number) => number): number {
  const scratch = new Surface(S.P, S.columns);
  const h = upToRow(inner(scratch, ROW) + ROW + 6);
  S.add(card(S.P, 0, 2, S.width, h - 2, border));
  inner(S, ROW);
  return h;
}

function tabs(S: Surface, p: TabBarPanel): number {
  const P = S.P;
  const H = CONTROL_ROW;
  const base = H - 3;
  S.add(rect(0, base, S.width, 3, { fill: P.ink }));
  let col = 1;
  for (const t of p.tabs) {
    const label = { size: 13.5, weight: 650 };
    const capW = t.hotkey ? 16 + 6 : 0;
    const badgeW = t.badge ? width(t.badge.text, { size: 11, weight: 700 }) + 14 + 6 : 0;
    const contentW = capW + width(t.label, label) + badgeW;
    const columns = Math.ceil((contentW + 24) / CELL.width);
    if (col + columns > S.columns) break;
    const box: Box = { x: col * CELL.width, y: 0, w: columns * CELL.width, h: base };
    const active = t.id === p.active;
    S.place({
      control: { id: t.id, kind: 'tab', ...(t.hotkey ? { hotkey: t.hotkey } : {}) },
      box,
      draw: (state: ControlState) => {
        const on = active || state === 'pressed';
        const color = on || state === 'hover' ? P.ink : P.muted;
        const out: string[] = [];
        if (state === 'hover' && !active) out.push(rect(box.x + 2, 3, box.w - 4, base - 5, { fill: P.hover, rx: 5 }));
        let x = box.x + 12;
        const cy = 14;
        if (t.hotkey) {
          out.push(rect(x, cy - 7.5, 16, 15, { fill: 'none', stroke: mix(color, P.paper, 0.5), sw: 1, rx: 3 }), txt(x + 8, cy + 3.5, t.hotkey, { size: 9.5, mono: true, weight: 700, color: mix(color, P.paper, 0.8), anchor: 'middle' }));
          x += 22;
        }
        out.push(txt(x, cy + 4.8, t.label, { ...label, color }));
        x += width(t.label, label) + 6;
        if (t.badge) {
          const bw = width(t.badge.text, { size: 11, weight: 700 }) + 14;
          const tone = P.tone[t.badge.tone];
          out.push(rect(x, cy - 8, bw, 16, { fill: mix(tone, P.paper, 0.12), stroke: tone, sw: 1.5, rx: 8 }), txt(x + bw / 2, cy + 3.8, t.badge.text, { size: 11, weight: 700, color: tone, anchor: 'middle' }));
        }
        // The underline: whole under the current tab, a third of it under the pointer.
        const u = active ? 1 : state === 'pressed' ? 1 : state === 'hover' ? 0.3 : 0;
        if (u > 0) {
          const full = box.w - 16;
          out.push(rect(box.x + 8 + (full * (1 - u)) / 2, base - 6, full * u, 6, { fill: P.ink, rx: 3 }));
        }
        return out.join('');
      },
    });
    col += columns;
  }
  return H;
}

/** A scenario as the editor's scenario tabs name it: ✓ or ✗, the name, the status an error ends with. */
function scenarioControl(S: Surface, s: ScenarioChip, col: number, top: number, current?: boolean): number {
  const P = S.P;
  const text = `${s.name}${s.status ? ` · ${s.status}` : ''}`;
  const error = s.outcome === 'error';
  const columns = Math.ceil((width(text, { size: 12.5, weight: 600 }) + 14 + 6 + 2 * CONTROL.pad + 4) / CELL.width);
  const box: Box = { x: col * CELL.width, y: top + 3, w: columns * CELL.width, h: CONTROL.height };
  S.place({
    control: { id: s.id, kind: 'button' },
    box,
    draw: (state) => {
      const c = error ? P.chip.red : P.chip.green;
      const on = current || state === 'pressed';
      const lift = state === 'hover' ? -1 : state === 'pressed' ? 1 : 0;
      const x = box.x + 1 + lift;
      const y = box.y + lift;
      const w = box.w - 5;
      const fill = on ? (error ? mix(P.fail, P.surface, 0.28) : mix(P.pass, P.surface, 0.28)) : state === 'hover' ? mix(c.fill, P.ink, 0.88) : c.fill;
      return [
        on || state === 'hover' ? rect(x + 2, y + 2, w, box.h, { fill: P.shadow, rx: 6 }) : '',
        rect(x + 1, y + 1, w - 2, box.h - 2, { fill, rx: 5, ...(on || state === 'hover' ? { stroke: P.ink, sw: 2 } : { stroke: mix(c.text, c.fill, 0.35), sw: 1 }) }),
        icon(error ? 'cross' : 'check', x + CONTROL.pad, y + box.h / 2 - 6.5, 13, c.text, 2.4),
        txt(x + CONTROL.pad + 19, y + box.h / 2 + 4.5, text, { size: 12.5, weight: on ? 700 : 600, color: on ? P.ink : c.text }),
      ].join('');
    },
  });
  return columns;
}

function useCaseBar(S: Surface, p: UseCaseBarPanel): number {
  const P = S.P;
  return framed(S, P.accent, (S, top) => {
    const label = { text: [{ text: 'USE CASE', tone: 'accent' as const, bold: true }] };
    let y = top;
    y += itemsRow(S, [label, { select: p.picker }, { control: p.play }, { control: p.explore }], 2, y, S.columns - 3);
    for (const g of p.explorer ?? []) {
      y += 6;
      if (g.label) {
        S.add(txt(GUTTER, y + 13, g.label, { size: 12, weight: 700, color: P.blue, mono: true }));
        y += 20;
      }
      for (const u of g.useCases) {
        y = upToRow(y);
        const nameW = width(u.name, { size: 13, weight: u.current ? 700 : 500 });
        const indent = g.label ? 4 : 2;
        let col = indent;
        const chips = u.scenarios.map((s) => ({ s, columns: Math.ceil((width(`${s.name}${s.status ? ` · ${s.status}` : ''}`, { size: 12.5, weight: 600 }) + 14 + 6 + 2 * CONTROL.pad + 4) / CELL.width) }));
        // The name on its own line when it and the scenarios do not fit one.
        const nameCols = Math.ceil((nameW + 12) / CELL.width);
        const inline = nameCols + chips.reduce((s, c) => s + c.columns + 1, 0) <= S.columns - 3 - indent;
        if (u.current) S.add(rect(col * CELL.width - 6, y + 9, 3, 14, { fill: P.accent, rx: 1.5 }));
        S.add(txt(col * CELL.width, y + CONTROL_ROW / 2 + 4.6, u.name, { size: 13, weight: u.current ? 700 : 500, color: P.ink }));
        if (inline) col += nameCols;
        else y += 24;
        for (const c of chips) {
          if (col + c.columns > S.columns - 3) {
            col = indent + 2;
            y += CONTROL_ROW;
          }
          if (!inline && col === indent) col = indent + 2;
          y = upToRow(y);
          scenarioControl(S, c.s, col, y);
          col += c.columns + 1;
        }
        y += CONTROL_ROW;
      }
    }
    return y - top;
  });
}

function playerHeader(S: Surface, p: PlayerHeaderPanel): number {
  const P = S.P;
  return framed(S, P.accent, (S, top) => {
    let y = top;
    const back = buttonColumns(p.back);
    placeButton(S, p.back, 2, y);
    const x = (2 + back + 1) * CELL.width;
    const titleW = width(p.title, { size: 14, weight: 700 });
    S.add(txt(x, y + CONTROL_ROW / 2 + 5, clip(p.title, S.width - x - 24, 14, 700), { size: 14, weight: 700, color: P.ink }));
    if (p.note) S.add(txt(x + titleW + 10, y + CONTROL_ROW / 2 + 4.6, clip(p.note, S.width - x - titleW - 34, 12.5), { size: 12.5, color: P.muted }));
    y += CONTROL_ROW;
    if (p.scenarios?.length) {
      let col = 2;
      for (const s of p.scenarios) {
        const need = Math.ceil((width(`${s.name}${s.status ? ` · ${s.status}` : ''}`, { size: 12.5, weight: 700 }) + 14 + 6 + 2 * CONTROL.pad + 4) / CELL.width);
        if (col + need > S.columns - 3) {
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
  const disc = err ? P.chip.red : { fill: mix(P.blue, P.surface, 0.15), text: P.blue };
  parts.push(`<circle cx="${x + 14}" cy="${y + 14}" r="14" fill="${disc.fill}"/>`, txt(x + 14, y + 18.5, String(s.number), { size: 13, weight: 700, color: disc.text, anchor: 'middle' }));
  const tx = x + 40;
  let cx = tx;
  const right = s.call ? width(s.call, { size: 12, mono: true }) + 16 : 0;
  const name = clip(s.name, w - 40 - right - 160, 14.5, 700);
  parts.push(txt(cx, y + 12, name, { size: 14.5, weight: 700, color: P.ink }));
  cx += width(name, { size: 14.5, weight: 700 }) + 10;
  const chips: { svg: string; width: number }[] = [];
  if (s.failed) chips.push(tint(P, cx, y + 12, 'Failed', 'red'));
  else if (s.status !== undefined && s.status >= 400) chips.push(tint(P, cx, y + 12, String(s.status), 'red'));
  for (const c of chips) {
    parts.push(c.svg);
    cx += c.width + 6;
  }
  if (!(s.exec === 'sync' && s.failed)) parts.push(tint(P, cx, y + 12, EXEC[s.exec].label, EXEC[s.exec].color).svg);
  if (s.call) parts.push(txt(x + w, y + 12, clip(s.call, right, 12, 500, true), { size: 12, mono: true, color: P.muted, anchor: 'end' }));
  parts.push(txt(tx, y + 29, clip(`${s.from}  →  ${s.to}`, w - 40, 12.5), { size: 12.5, color: P.muted }));
  y += 38;
  S.add(...parts);
  if (s.description) {
    const p = paragraph(P, s.description.replace(/\s*\n\s*/g, ' '), tx, y, w - 40, { size: 12.5 }, mix(P.ink, P.surface, 0.78), 18, 2);
    S.add(p.svg);
    y += p.height + 6;
  }
  const bodies = [s.request && { label: `Request (${s.request.format})`, body: s.request, error: false }, s.response && { label: `Response (${s.response.format})${s.response.status !== undefined ? ` - ${s.response.status}` : ''}`, body: s.response, error: s.response.error === true }].filter(
    (b): b is { label: string; body: NonNullable<StepCard['request']>; error: boolean } => !!b,
  );
  if (bodies.length) {
    // Side by side where both fit (the editor's two columns from `sm`), else one under the other.
    const side = bodies.length === 2 && w - 40 >= 560;
    const bw = side ? (w - 40 - 14) / 2 : w - 40;
    let tallest = 0;
    let by = y;
    bodies.forEach((b, i) => {
      const bx = side ? tx + i * (bw + 14) : tx;
      const at = side ? y : by;
      S.add(txt(bx, at + 11, b.label, { size: 11.5, weight: 600, color: b.error ? P.tone.bad : P.muted }));
      const h = 16 + codeBox(S, b.body.text, bx, at + 16, bw, { language: b.body.format === 'JSON' ? 'json' : b.body.format === 'XML' ? 'xml' : undefined, maxLines: BODY_LINES, error: b.error, fill: P.paper });
      tallest = Math.max(tallest, h);
      by = at + h + 8;
    });
    y = side ? y + tallest + 6 : by;
  }
  if (s.failed) {
    S.add(txt(tx, y + 13, 'No response: the call failed (timeout, connection refused or similar).', { size: 12.5, weight: 500, color: P.tone.bad }));
    y += 20;
  } else if (!s.response && s.status !== undefined && s.status >= 400) {
    S.add(txt(tx, y + 13, `Answered with ${s.status}`, { size: 12.5, weight: 500, color: P.tone.bad }));
    y += 20;
  }
  return y - top;
}

/** The step at `at` with its parallel siblings; the px it took. */
function stepCards(S: Surface, p: StepPanel, cards: StepCard[], x: number, top: number, w: number): number {
  const P = S.P;
  let y = top;
  if (p.condition) {
    const laid = layoutRich([{ text: 'When: ', bold: true }, { text: p.condition }], w, { size: 12.5 }, false)[0];
    S.add(drawLaid(P, laid, x, y + 13, { size: 12.5 }, mix(P.ink, P.surface, 0.8)));
    y += 24;
  }
  if (cards.length > 1) {
    S.add(icon('bolt', x, y + 1, 14, P.blue), txt(x + 20, y + 12.5, `Parallel Execution (${cards.length} steps running simultaneously)`, { size: 12.5, weight: 600, color: P.blue }));
    y += 24;
  }
  if (cards.length === 0) {
    S.add(txt(x, y + 14, 'This scenario has no steps.', { size: 13, color: P.muted }));
    y += 24;
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
  const w = S.width - 2 * GUTTER - 4;
  // As tall as the tallest step, so stepping moves nothing.
  const scratch = new Surface(P, S.columns);
  const tallest = Math.max(0, ...p.steps.map((cards) => stepCards(scratch, p, cards, x, 0, w)), stepCards(scratch, p, p.steps[at] ?? [], x, 0, w));
  return framed(S, P.ink, (S, top) => {
    stepCards(S, p, p.steps[at] ?? [], x, top, w);
    let y = upToRow(top + tallest + 4);
    S.add(line(6, y + 0.5, S.width - 10, y + 0.5, P.line, 1));
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
        ctl({ id: 'exit', icon: 'exit', label: S.columns >= 90 ? 'Exit playback' : 'Exit', ...hk('exit'), variant: 'quiet' }),
      ],
      2,
      y + 2,
      S.columns - 3,
    ) + 2;
    return y - top;
  });
}

function systemBar(S: Surface, p: SystemBarPanel): number {
  const P = S.P;
  return framed(S, P.ink, (S, top) => {
    let y = top;
    if (p.inside) {
      S.add(txt(GUTTER, y + 12, clip(`Inside ${p.inside}`, S.width - 2 * GUTTER, 12), { size: 12, color: P.muted }));
      y += 18;
    }
    const selected: { text: { text: string; tone?: 'accent' | 'muted'; bold?: boolean }[] } = p.selected
      ? { text: [{ text: 'System  ', bold: true }, { text: p.selected.name, tone: 'accent', bold: true }, { text: `  ${p.selected.path}`, tone: 'muted' }] }
      : { text: [{ text: 'System  ', bold: true }, { text: 'none here', tone: 'muted' }] };
    y += itemsRow(S, [selected, ...p.controls.map((c) => ({ control: c }))], 2, y, S.columns - 3);
    return y - top;
  });
}

function actionBar(S: Surface, p: ActionBarPanel): number {
  return itemsRow(S, p.controls.map((c) => ({ control: c })), 0, 0, S.columns - 1);
}

function banner(S: Surface, p: BannerPanel): number {
  const P = S.P;
  const resetCols = buttonColumns(p.reset);
  placeButton(S, p.reset, 0, 0);
  const x = (resetCols + 1) * CELL.width;
  const lw = Math.min(S.width - x - 8, width(p.label, { size: 12.5, weight: 700 }) + 22);
  S.add(rect(x, 6, lw, 20, { fill: P.yellow, stroke: P.theme === 'dark' ? P.yellow : P.ink, sw: 1.5, rx: 10 }), txt(x + 11, 20.5, clip(p.label, lw - 22, 12.5, 700), { size: 12.5, weight: 700, color: P.onAccent }));
  if (p.note && x + lw + 12 < S.width - 60) S.add(txt(x + lw + 10, 20.5, clip(p.note, S.width - x - lw - 18, 12.5), { size: 12.5, color: P.muted }));
  return CONTROL_ROW;
}

/** The load legend as LoadLegend.tsx: the heat scale, the p99 path, what edges say. */
function legend(S: Surface, critical: { useCase: string; p99: string } | undefined, x: number, y: number): void {
  const P = S.P;
  const out: string[] = [];
  const small = { size: 11.5, color: P.muted };
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
    out.push(rect(cx, y - 9, 12, 12, { fill, stroke: P.ink, sw: 1, rx: 2 }));
    cx += 16;
    put(label);
  }
  if (critical) {
    cx += 8;
    out.push(line(cx, y - 4, cx + 18, y - 4, P.ink, 3.5));
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
    const laid = layoutRich([{ text: n.text }, ...(n.hint ? [{ text: `  → ${n.hint}`, tone: 'muted' as const }] : [])], w - 22, { size: 12.5 }, false)[0];
    S.add(icon(tone === 'muted' ? 'warn' : 'warn', x, y + 3, 13, color, 1.8), drawLaid(P, laid, x + 20, y + 14, { size: 12.5 }, color));
    y += 20;
  }
  if (p.legend) {
    legend(S, p.legend.critical, x, y + 14);
    y += 22;
  }
  if (p.verdict) {
    y = upToRow(y);
    const { passed, total, first } = p.verdict;
    const failing = total - passed;
    const checks = total === 1 ? 'check' : 'checks';
    const detailsCols = p.details ? buttonColumns(p.details) + 1 : 0;
    const room = w - detailsCols * CELL.width - 22;
    const head = failing === 0 ? `All ${total} ${checks} pass` : `${failing} of ${total} ${checks} fail`;
    const laid = layoutRich([{ text: head, bold: true, tone: failing ? 'bad' : 'good' }, ...(failing && first ? [{ text: `: ${first}` }] : [])], room, BODY, false)[0];
    S.add(icon(failing ? 'cross' : 'check', x, y + CONTROL_ROW / 2 - 7, 14, failing ? P.tone.bad : P.tone.good, 2.4), drawLaid(P, laid, x + 20, y + CONTROL_ROW / 2 + 4.6, BODY, P.ink));
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
