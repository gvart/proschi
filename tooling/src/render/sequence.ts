import { buildSequence, type Diagram, type DiagramScenario, type DiagramUseCase, type SequenceMessage } from '../proschi';
import { techIcon } from './icons';
import { COLORS, MONO, card, esc, fit, marker, r, svgDocument, text, textWidth } from './svg';

/**
 * One scenario as an SVG sequence diagram: a header box and dashed lifeline
 * per participant, numbered request arrows, dashed responses with their
 * status codes, `par` regions, and error replies and failed calls in red,
 * in the canvas's style: ink cards with hard shadows, pink step numbers.
 */

const MARGIN = 24;
const HEADER_HEIGHT = 46;
const ROW = 40;
const SELF_ROW = 56;
const LABEL_SIZE = 12;
const LABEL_MAX = 380;
const MIN_GAP = 150;
const PAR_PAD = 12;

type Row = { kind: 'message'; message: SequenceMessage; y: number } | { kind: 'par-start' | 'par-and' | 'par-end'; y: number };

function labelText(m: SequenceMessage): string {
  return fit(m.label || (m.kind === 'response' ? '' : ' '), LABEL_MAX, LABEL_SIZE);
}

/** Width a message's label needs between its two lifelines (number badge included). */
function labelNeed(m: SequenceMessage): number {
  return textWidth(labelText(m), LABEL_SIZE) + (m.kind === 'request' ? 26 : 0) + 24;
}

export function scenarioTitle(useCase: DiagramUseCase, scenario: DiagramScenario): string {
  return useCase.scenarios.length > 1 ? `${useCase.name} › ${scenario.name}` : useCase.name;
}

export function renderSequenceSvg(diagram: Diagram, useCase: DiagramUseCase, scenario: DiagramScenario, idPrefix = ''): string {
  const seq = buildSequence(useCase, scenario, diagram.nodes);
  const participants = seq.participants;
  const index = new Map(participants.map((p, i) => [p.id, i]));

  // Header box widths, then the distance between neighbouring lifelines.
  const widths = participants.map((p) => Math.min(240, Math.max(120, textWidth(p.name, 13, true) + 58, textWidth(p.tech ?? '', 11) + 58)));
  const nodes = new Map(diagram.nodes.map((n) => [n.id, n]));
  const gaps = participants.slice(1).map((_, i) => Math.max(MIN_GAP, (widths[i] + widths[i + 1]) / 2 + 24));
  const messages = seq.items.flatMap((item) => (item.kind === 'message' ? [item.message] : item.branches.flat()));
  // Widen the narrowest spans first so long labels fit between their lifelines.
  const spans = messages
    .map((m) => ({ m, a: Math.min(index.get(m.from)!, index.get(m.to)!), b: Math.max(index.get(m.from)!, index.get(m.to)!) }))
    .sort((x, y) => x.b - x.a - (y.b - y.a));
  let selfExtra = 0;
  for (const { m, a, b } of spans) {
    if (a === b) {
      const need = labelNeed(m) + 40;
      if (a < gaps.length) gaps[a] = Math.max(gaps[a], need);
      else selfExtra = Math.max(selfExtra, need - widths[a] / 2);
      continue;
    }
    const have = gaps.slice(a, b).reduce((s, g) => s + g, 0);
    const need = labelNeed(m);
    if (need > have) for (let i = a; i < b; i++) gaps[i] += (need - have) / (b - a);
  }
  const xs: number[] = [];
  participants.forEach((_, i) => xs.push(i === 0 ? MARGIN + widths[0] / 2 : xs[i - 1] + gaps[i - 1]));

  const title = scenarioTitle(useCase, scenario);
  const subtitle = [
    useCase.endpoint,
    seq.condition ? `when ${seq.condition}` : '',
    scenario.outcome === 'error' ? 'error path' : '',
  ].filter(Boolean);
  const top = MARGIN + 30 + (subtitle.length ? 18 : 0);
  const headerTop = top + 8;
  let y = headerTop + HEADER_HEIGHT + 36;

  // Lay out the rows top to bottom.
  const rows: Row[] = [];
  const place = (m: SequenceMessage) => {
    const self = m.from === m.to;
    y += self ? SELF_ROW - ROW : 0;
    rows.push({ kind: 'message', message: m, y: y + (self ? -16 : 0) });
    y += ROW;
  };
  for (const item of seq.items) {
    if (item.kind === 'message') {
      place(item.message);
      continue;
    }
    // A message's label sits about 20px above its line; `y` is where the next line goes.
    y += PAR_PAD + 8;
    rows.push({ kind: 'par-start', y: y - 20 - PAR_PAD - 8 });
    item.branches.forEach((branch, i) => {
      if (i > 0) {
        rows.push({ kind: 'par-and', y: y - ROW + PAR_PAD });
        y += 8;
      }
      branch.forEach(place);
    });
    rows.push({ kind: 'par-end', y: y - ROW + PAR_PAD });
    y += 8;
  }
  const bottom = y - ROW / 2 + 12;
  const width = Math.max((xs.at(-1) ?? MARGIN) + (widths.at(-1) ?? 0) / 2 + MARGIN + selfExtra, textWidth(title, 16, true) + MARGIN * 2, 320);
  const height = bottom + MARGIN;

  const body: string[] = [
    text(MARGIN, MARGIN + 16, title, { size: 16, weight: 700 }),
    subtitle.length ? text(MARGIN, MARGIN + 36, subtitle.join(' · '), { size: 12, fill: scenario.outcome === 'error' ? COLORS.error : COLORS.muted }) : '',
  ];

  // par regions behind everything else.
  let parTop = 0;
  for (const row of rows) {
    if (row.kind === 'par-start') parTop = row.y;
    if (row.kind === 'par-and') {
      body.push(`<line x1="${MARGIN / 2}" y1="${r(row.y)}" x2="${r(width - MARGIN / 2)}" y2="${r(row.y)}" stroke="${COLORS.par}" stroke-width="1" stroke-dasharray="4 3"/>`);
    }
    if (row.kind === 'par-end') {
      body.push(
        `<g data-kind="par">`,
        `<rect x="${MARGIN / 2}" y="${r(parTop)}" width="${r(width - MARGIN)}" height="${r(row.y - parTop)}" rx="4" fill="${COLORS.par}" fill-opacity="0.04" stroke="${COLORS.par}" stroke-width="1"/>`,
        `<path d="M${MARGIN / 2},${r(parTop + 18)} H${MARGIN / 2 + 30} L${MARGIN / 2 + 36},${r(parTop + 12)} V${r(parTop)}" fill="none" stroke="${COLORS.par}" stroke-width="1"/>`,
        text(MARGIN / 2 + 6, parTop + 13, 'par', { size: 11, weight: 600, fill: COLORS.par }),
        '</g>',
      );
    }
  }

  // Participants and lifelines.
  participants.forEach((p, i) => {
    const x = xs[i];
    const w = widths[i];
    const node = p.tech ? nodes.get(p.id) : undefined;
    body.push(
      `<g data-participant="${esc(p.id)}">`,
      `<line x1="${r(x)}" y1="${r(headerTop + HEADER_HEIGHT)}" x2="${r(x)}" y2="${r(bottom)}" stroke="${COLORS.muted}" stroke-opacity="0.6" stroke-width="1.5" stroke-dasharray="5 4"/>`,
      // A small ComponentNode: card, icon tile, name and tech stack.
      card(x - w / 2, headerTop, w, HEADER_HEIGHT, { stroke: 2 }),
      node ? `<rect x="${r(x - w / 2 + 10)}" y="${r(headerTop + 11)}" width="24" height="24" rx="4" fill="${COLORS.background}" stroke="${COLORS.border}" stroke-width="1.5"/>` : '',
      node ? techIcon(node.techStack, x - w / 2 + 15, headerTop + 16, 14, COLORS.text, node.type) : '',
      text(x - w / 2 + (node ? 42 : 12), headerTop + (p.tech ? 20 : 28), fit(p.name, w - (node ? 50 : 20), 13, true), { size: 13, weight: 700 }),
      p.tech ? text(x - w / 2 + 42, headerTop + 36, fit(p.tech, w - 50, 11), { size: 10, weight: 500, fill: COLORS.muted, family: MONO }) : '',
      '</g>',
    );
  });

  if (messages.length === 0) body.push(text(MARGIN, headerTop + 16, 'No steps', { fill: COLORS.muted }));
  for (const row of rows) {
    if (row.kind !== 'message') continue;
    body.push(drawMessage(row.message, xs[index.get(row.message.from)!], xs[index.get(row.message.to)!], row.y, idPrefix));
  }

  const defs = [
    marker(`${idPrefix}solid`, COLORS.text),
    marker(`${idPrefix}open`, COLORS.text, true),
    marker(`${idPrefix}reply`, COLORS.line, true),
    marker(`${idPrefix}solid-error`, COLORS.error),
    marker(`${idPrefix}open-error`, COLORS.error, true),
  ].join('');
  return svgDocument(width, height, title, body.filter(Boolean), defs);
}

function drawMessage(m: SequenceMessage, x1: number, x2: number, y: number, idPrefix: string): string {
  // Requests in ink, replies grey and dashed, errors red.
  const color = m.error ? COLORS.error : m.kind === 'response' ? COLORS.line : COLORS.text;
  const dash = m.kind === 'response' ? ' stroke-dasharray="6 4"' : '';
  const head = m.error ? `${m.kind === 'response' || m.async ? 'open' : 'solid'}-error` : m.kind === 'response' ? 'reply' : m.async ? 'open' : 'solid';
  const label = labelText(m);
  const out = [`<g data-step="${m.number}" data-kind="${m.failed ? 'failed' : m.kind}"${m.error ? ' data-error="true"' : ''}>`];

  // The label: a number badge for requests, the status code in bold for responses.
  const labelContent = (l: string) => {
    if (m.kind === 'response' && m.status !== undefined && l.startsWith(String(m.status))) {
      return `<tspan font-weight="700">${m.status}</tspan>${esc(l.slice(String(m.status).length))}`;
    }
    return esc(l);
  };
  const labelWidth = textWidth(label, LABEL_SIZE) + (m.kind === 'request' ? 22 : 0);
  const drawLabel = (startX: number, ly: number) => {
    let tx = startX;
    if (m.kind === 'request') {
      out.push(
        `<circle cx="${r(tx + 8)}" cy="${r(ly - 4)}" r="8" fill="${m.error ? COLORS.error : COLORS.active}" stroke="${COLORS.border}" stroke-width="1.5"/>`,
        text(tx + 8, ly - 0.5, String(m.number), { size: 10, weight: 700, anchor: 'middle' }),
      );
      tx += 22;
    }
    if (label.trim()) {
      out.push(`<text x="${r(tx)}" y="${r(ly)}" font-size="${LABEL_SIZE}" fill="${m.error ? COLORS.error : COLORS.text}">${labelContent(label)}</text>`);
    }
  };

  if (x1 === x2) {
    // A call to itself: a small loop to the right of the lifeline.
    const d = `M${r(x1)},${r(y)} H${r(x1 + 36)} V${r(y + 18)} H${r(x1 + 2)}`;
    out.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="2"${dash} marker-end="url(#${idPrefix}${head})"/>`);
    drawLabel(x1 + 44, y + 13);
  } else {
    const dir = Math.sign(x2 - x1);
    const end = m.failed ? x2 - dir * 14 : x2 - dir * 2;
    out.push(
      `<line x1="${r(x1)}" y1="${r(y)}" x2="${r(end)}" y2="${r(y)}" stroke="${color}" stroke-width="2"${dash}${m.failed ? '' : ` marker-end="url(#${idPrefix}${head})"`}/>`,
    );
    if (m.failed) {
      // ✕: the request never arrives.
      const cx = end + dir * 6;
      out.push(`<path d="M${r(cx - 5)},${r(y - 5)} L${r(cx + 5)},${r(y + 5)} M${r(cx - 5)},${r(y + 5)} L${r(cx + 5)},${r(y - 5)}" stroke="${COLORS.error}" stroke-width="2.2" stroke-linecap="round"/>`);
    }
    drawLabel((x1 + x2) / 2 - labelWidth / 2, y - 8);
  }
  out.push('</g>');
  return out.join('\n');
}
