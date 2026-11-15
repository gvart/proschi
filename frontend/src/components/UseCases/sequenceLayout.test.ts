import { describe, expect, it } from 'vitest';
import { parse } from '../../dsl/parser';
import { framesOf } from './playbackView';
import {
  SEQ,
  ZOOM,
  arrowPoints,
  clampZoom,
  cutLabel,
  fitZoom,
  layoutSequence,
  litParticipants,
  lookAt,
  packetWindows,
  pointAlong,
  type SeqMessageRow,
} from './sequenceLayout';

const source = `user [Actor]
api [REST API]
db [PostgreSQL]
mail [Email Service]
user -> api
api -> db
api -> mail

usecase "Place order" {
  user -> api : POST /orders
  api -> db : INSERT order
  db --> api : 1 row
  section "Notify" {
    par {
      api -> mail : send receipt
      api -> db : INSERT audit
    }
  }
  api --> user : 201 {"id": 42}
}

usecase "Down" {
  user -> api : GET /orders
  api -x db : SELECT
  api --> user : 503
}
`;

const { diagram, diagnostics } = parse(source);
const layout = (name: string) => {
  const useCase = diagram.useCases.find((u) => u.name === name)!;
  const scenario = useCase.scenarios[0];
  return { scenario, layout: layoutSequence(useCase, scenario, diagram.nodes) };
};

describe('layoutSequence', () => {
  it('parses the fixture', () => {
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('puts one column per participant, in the order they appear, left to right and apart', () => {
    const { layout: l } = layout('Place order');
    expect(l.columns.map((c) => c.name)).toEqual(['user', 'api', 'db', 'mail']);
    expect(l.columns.map((c) => c.node?.techStack)).toEqual(['Actor', 'REST API', 'PostgreSQL', 'Email Service']);
    for (let i = 1; i < l.columns.length; i++) {
      const [a, b] = [l.columns[i - 1], l.columns[i]];
      expect(b.x - a.x).toBeGreaterThanOrEqual((a.width + b.width) / 2);
    }
    expect(l.width).toBeGreaterThan(l.columns.at(-1)!.x + l.columns.at(-1)!.width / 2);
  });

  it('lays the messages out top to bottom, with the answers back in place', () => {
    const { layout: l } = layout('Place order');
    expect(l.rows.map((r) => `${r.message.kind}:${r.message.from}>${r.message.to}`)).toEqual([
      'request:user>api',
      'request:api>db',
      'response:db>api',
      'request:api>mail',
      'request:api>db',
      'response:api>user',
    ]);
    const ys = l.rows.map((r) => r.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(l.height).toBeGreaterThan(ys.at(-1)!);
  });

  it('frames the section and the par around their messages', () => {
    const { layout: l } = layout('Place order');
    const section = l.boxes.find((b) => b.kind === 'section')!;
    const par = l.boxes.find((b) => b.kind === 'par')!;
    expect(section).toMatchObject({ name: 'Notify', depth: 0 });
    expect(par.depth).toBe(1);
    expect(par.dividers).toHaveLength(1);
    const inPar = l.rows.filter((r) => r.message.to === 'mail' || r.message.label === 'INSERT audit');
    for (const r of inPar) {
      expect(r.y).toBeGreaterThan(par.top);
      expect(r.y).toBeLessThan(par.bottom);
    }
    expect(section.top).toBeLessThan(par.top);
    expect(section.bottom).toBeGreaterThanOrEqual(par.bottom);
    // Outermost frames first, so nested ones draw over them.
    expect(l.boxes[0]).toBe(section);
  });

  it('gives every message the playback frame it plays in', () => {
    const { scenario, layout: l } = layout('Place order');
    expect(l.frameCount).toBe(framesOf(scenario.steps).length);
    // The order, the insert (answered with it), the par group, then the 201: written after other steps, it plays on its own.
    expect(l.rows.map((r) => r.frame)).toEqual([0, 1, 1, 2, 2, 3]);
  });

  it('lights the frame playing, keeps the ones before and fades the ones to come', () => {
    const { layout: l } = layout('Place order');
    expect(l.rows.map((r) => lookAt(r, 1))).toEqual(['past', 'lit', 'lit', 'future', 'future', 'future']);
    expect([...litParticipants(l.rows, 1)]).toEqual([
      ['api', 'active'],
      ['db', 'active'],
    ]);
  });

  it('marks a call that never got an answer, and the node it went to', () => {
    const { layout: l } = layout('Down');
    const failed = l.rows.find((r) => r.message.failed)!;
    expect(failed.message).toMatchObject({ from: 'api', to: 'db', error: true });
    expect(litParticipants(l.rows, failed.frame).get('db')).toBe('failing');
    const answer = l.rows.find((r) => r.message.kind === 'response')!;
    expect(answer.message).toMatchObject({ status: 503, error: true });
  });

  it('sends the packet out and back in one step for a call answered with it, like the canvas', () => {
    const { layout: l } = layout('Place order');
    // The insert goes out in the first half and its 1 row comes back in the second.
    expect([...packetWindows(l.rows, 1)]).toEqual([
      [1, [0, 50]],
      [2, [50, 100]],
    ]);
    // The par group's calls travel side by side, and the 201 written after them takes its step alone.
    expect([...packetWindows(l.rows, 2)]).toEqual([
      [3, [0, 100]],
      [4, [0, 100]],
    ]);
    expect([...packetWindows(l.rows, 3)]).toEqual([[5, [0, 100]]]);
    // A call answered later takes its whole step too.
    expect([...packetWindows(l.rows, 0)]).toEqual([[0, [0, 100]]]);
  });

  it('gives a failed call the whole step, though it never arrives', () => {
    const { layout: l } = layout('Down');
    const failed = l.rows.find((r) => r.message.failed)!;
    expect(packetWindows(l.rows, failed.frame).get(failed.index)).toEqual([0, 100]);
  });

  it('runs the packet along the arrow, stopping short of the lifeline', () => {
    const { layout: l } = layout('Place order');
    const answer = l.rows[2]; // db --> api, right to left
    const points = arrowPoints(answer);
    expect(points).toEqual([
      { x: answer.x1, y: answer.y },
      { x: answer.x2 + 3, y: answer.y },
    ]);
    expect(pointAlong(points, 0)).toEqual(points[0]);
    expect(pointAlong(points, 0.5).x).toBeCloseTo((answer.x1 + answer.x2 + 3) / 2);
    expect(pointAlong(points, 1)).toEqual(points[1]);
    expect(pointAlong(points, 2)).toEqual(points[1]);
  });

  it('runs the packet round the loop of a message to itself', () => {
    const points = arrowPoints({ message: { failed: false } as SeqMessageRow['message'], x1: 100, x2: 100, y: 50 });
    // 38 out, 20 down, 35 back: 93 in all.
    expect(pointAlong(points, 38 / 93)).toEqual({ x: 138, y: 50 });
    expect(pointAlong(points, 48 / 93)).toEqual({ x: 138, y: 60 });
    expect(pointAlong(points, 1)).toEqual({ x: 103, y: 70 });
  });

  it('widens the gap between lifelines for a long label', () => {
    const long = parse(`a [Service]
b [Service]
a -> b
usecase "Long" {
  a -> b : POST /a/really/long/path/that/needs/plenty/of/room {"k": 1}
}
`).diagram;
    const useCase = long.useCases[0];
    const l = layoutSequence(useCase, useCase.scenarios[0], long.nodes);
    const row = l.rows[0];
    expect(Math.abs(row.x2 - row.x1)).toBeGreaterThanOrEqual(row.label.length * SEQ.charWidth);
  });
});

describe('cutLabel', () => {
  it('cuts long labels with an ellipsis and leaves short ones alone', () => {
    expect(cutLabel('GET /x')).toBe('GET /x');
    const cut = cutLabel('x'.repeat(200));
    expect(cut).toHaveLength(SEQ.labelChars);
    expect(cut.endsWith('…')).toBe(true);
  });
});

describe('fitZoom', () => {
  const size = { width: 1000, height: 600 };
  it('fits the width, never past 100% nor below the floor', () => {
    expect(fitZoom(size, 2000, 500, 'width')).toBe(1);
    expect(fitZoom(size, 808, 500, 'width')).toBeCloseTo(0.8);
    expect(fitZoom(size, 300, 500, 'width')).toBe(ZOOM.widthFloor);
  });
  it('fits the whole diagram, by whichever side is tighter', () => {
    const tall = fitZoom(size, 2000, 352, 'all');
    expect(tall).toBeCloseTo(344 / (SEQ.header + 600 + 24));
    expect(fitZoom(size, 10, 10, 'all')).toBe(ZOOM.min);
  });
  it('zooms past 100% to fit a small diagram in a big pane, up to the maximum', () => {
    expect(fitZoom(size, 1208, 2000, 'all')).toBeCloseTo(1.2);
    expect(fitZoom(size, 5000, 5000, 'all')).toBe(ZOOM.max);
  });
  it('keeps zoom within its limits', () => {
    expect(clampZoom(9)).toBe(ZOOM.max);
    expect(clampZoom(0.01)).toBe(ZOOM.min);
  });
});
