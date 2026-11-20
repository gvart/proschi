import { describe, expect, it } from 'vitest';
import { outlineOf } from '../../dsl/edit';
import { stepEdge } from './flows';
import { allSteps, entrySteps, followStep, inParallel, laneOrder, layoutSequence, scenarioOfStep, SEQ, sequenceEntries, type Measure, type Slot } from './sequenceLayout';

const SRC = [
  'web "Web" [Browser]',
  'api "API" [REST API]',
  'cache "Cache" [Redis]',
  'db "DB" [PostgreSQL]',
  'q "Events" [AWS SQS]',
  'usecase "Order" {',
  '  web -> api : POST /orders',
  '  alt "Hit" {',
  '    api -> cache : GET order',
  '  } alt "Miss" {',
  '    api -> db : SELECT order',
  '    par {',
  '      api -> cache : SET order',
  '      api ->> q : SEND OrderRead',
  '    }',
  '  }',
  '  par {',
  '    api -> db : INSERT audit',
  '    api -x q : SEND audit',
  '  }',
  '  api --> web : 201',
  '}',
].join('\n');

const outline = outlineOf(SRC, 'Order')!;
const label = (s: { from: string; to: string; label: string }) => `${s.from}>${s.to}:${s.label}`;
/** Every character 8px wide, so the widths are easy to reason about. */
const FIXED: Measure = { name: (t) => t.length * 8, label: (t) => t.length * 8 };

describe('what a tab of the sequence shows', () => {
  it('the main flow folds each set of scenarios', () => {
    const entries = sequenceEntries(outline.items, '');
    expect(entries.map((e) => e.kind)).toEqual(['step', 'scenarios', 'parallel', 'step']);
    expect(entries[1]).toMatchObject({ kind: 'scenarios', names: ['Hit', 'Miss'], line: 8 });
    expect(entrySteps(entries).map(label)).toEqual(['web>api:POST /orders', 'api>db:INSERT audit', 'api>q:SEND audit', 'api>web:201']);
  });

  it('a scenario shows its branch, with its par blocks, in place of the set', () => {
    const entries = sequenceEntries(outline.items, 'Miss');
    expect(entries[1]).toMatchObject({ kind: 'scenario', name: 'Miss', line: 10, other: 0 });
    expect(entrySteps(entries).map(label)).toEqual([
      'web>api:POST /orders',
      'api>db:SELECT order',
      'api>cache:SET order',
      'api>q:SEND OrderRead',
      'api>db:INSERT audit',
      'api>q:SEND audit',
      'api>web:201',
    ]);
    // An unknown scenario is the main flow.
    expect(sequenceEntries(outline.items, 'Nope').map((e) => e.kind)).toEqual(['step', 'scenarios', 'parallel', 'step']);
  });

  it('orders the lanes as the components first appear, in every scenario, so they stay put across tabs', () => {
    expect(laneOrder(outline)).toEqual(['web', 'api', 'cache', 'db', 'q']);
    expect(laneOrder({ items: [] })).toEqual([]);
  });

  it('lists every step in text order, those of a par block in a scenario too', () => {
    expect(allSteps(outline.items).map((s) => s.line)).toEqual([7, 9, 11, 13, 14, 18, 19, 21]);
  });

  it('finds the scenario a step belongs to', () => {
    expect(scenarioOfStep(outline.items, 9)).toBe('Hit');
    expect(scenarioOfStep(outline.items, 13)).toBe('Miss');
    expect(scenarioOfStep(outline.items, 7)).toBeUndefined();
  });

  it('tells a step in a par block, of the main flow or of a scenario', () => {
    expect([13, 14, 18, 19].map((line) => inParallel(outline.items, line))).toEqual([true, true, true, true]);
    expect([7, 9, 11, 21].map((line) => inParallel(outline.items, line))).toEqual([false, false, false, false]);
  });
});

describe('following the selected step', () => {
  const step = (line: number, from: string, to: string, text = '') => ({ line, from, to, kind: 'request' as const, label: text });

  it('keeps the step on its line, with its new label', () => {
    expect(followStep(step(3, 'a', 'b', 'GET'), [step(3, 'a', 'b', 'POST')])).toEqual(step(3, 'a', 'b', 'POST'));
  });

  it('follows a step that moved, and drops one that is gone or ambiguous', () => {
    expect(followStep(step(3, 'a', 'b', 'GET'), [step(2, 'b', 'c'), step(5, 'a', 'b', 'GET')])).toEqual(step(5, 'a', 'b', 'GET'));
    expect(followStep(step(3, 'a', 'b', 'GET'), [step(3, 'b', 'c')])).toBeUndefined();
    expect(followStep(step(3, 'a', 'b', 'GET'), [step(4, 'a', 'b', 'GET'), step(6, 'a', 'b', 'GET')])).toBeUndefined();
    expect(followStep(undefined, [step(3, 'a', 'b')])).toBeUndefined();
  });
});

describe('the sequence layout', () => {
  const lanes = laneOrder(outline);
  const names = (id: string) => id.toUpperCase();

  it('puts the lanes left to right, at least the least gap apart, and numbers the messages in order', () => {
    const layout = layoutSequence(sequenceEntries(outline.items, 'Miss'), lanes, names, FIXED);
    expect(layout.lanes.map((l) => l.id)).toEqual(lanes);
    for (let i = 1; i < layout.lanes.length; i++) expect(layout.lanes[i].x - layout.lanes[i - 1].x).toBeGreaterThanOrEqual(SEQ.minGap);
    expect(layout.messages.map((m) => m.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // Each a row below the last.
    const ys = layout.messages.map((m) => m.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    expect(new Set(ys).size).toBe(ys.length);
  });

  it('draws a message from its lane to the other, and an answer back', () => {
    const layout = layoutSequence(sequenceEntries(outline.items, ''), lanes, names, FIXED);
    const x = (id: string) => layout.lanes.find((l) => l.id === id)!.x;
    const first = layout.messages[0];
    expect([first.x1, first.x2]).toEqual([x('web'), x('api')]);
    const answer = layout.messages.at(-1)!;
    expect(answer.step.kind).toBe('response');
    expect([answer.x1, answer.x2]).toEqual([x('api'), x('web')]);
  });

  it('widens the gaps so a long label fits over its arrow', () => {
    const long = 'x'.repeat(30);
    const src = `usecase "U" {\n  a -> b : ${long}\n  b -> c : y\n}`;
    const o = outlineOf(src, 'U')!;
    const layout = layoutSequence(sequenceEntries(o.items, ''), laneOrder(o), names, FIXED);
    const [a, b, c] = layout.lanes;
    expect(b.x - a.x).toBeGreaterThanOrEqual(30 * 8 + SEQ.labelChrome);
    expect(c.x - b.x).toBe(SEQ.minGap);
    // A label past the widest is cut, so it widens no further.
    const longer = `usecase "U" {\n  a -> b : ${'x'.repeat(200)}\n}`;
    const cut = layoutSequence(sequenceEntries(outlineOf(longer, 'U')!.items, ''), ['a', 'b'], names, FIXED);
    expect(cut.messages[0].labelWidth).toBe(SEQ.labelMax);
    expect(cut.lanes[1].x - cut.lanes[0].x).toBe(SEQ.labelMax + SEQ.labelChrome);
  });

  it('gives back the widening to fit the width it has, down to a label of its least width', () => {
    const src = `usecase "U" {\n  a -> b : ${'x'.repeat(30)}\n  b -> c : y\n}`;
    const o = outlineOf(src, 'U')!;
    const wide = layoutSequence(sequenceEntries(o.items, ''), laneOrder(o), names, FIXED);
    const fitted = layoutSequence(sequenceEntries(o.items, ''), laneOrder(o), names, FIXED, wide.width - 40);
    const gap = (l: typeof wide) => l.lanes[1].x - l.lanes[0].x;
    expect(gap(fitted)).toBeCloseTo(gap(wide) - 40, 0);
    expect(fitted.lanes[2].x - fitted.lanes[1].x).toBe(SEQ.minGap);
    // Never closer than the headers need, however narrow.
    // Never narrower than a label of SEQ.labelMin: the pane scrolls instead.
    const narrow = layoutSequence(sequenceEntries(o.items, ''), laneOrder(o), names, FIXED, 100);
    expect(gap(narrow)).toBe(SEQ.labelMin + SEQ.labelChrome);
    expect(narrow.width).toBeGreaterThan(100);
    // A label shorter than that keeps its whole width.
    const short = outlineOf(`usecase "U" {\n  a -> b : ${'x'.repeat(20)}\n  b -> c : ${'y'.repeat(30)}\n}`, 'U')!;
    const tight = layoutSequence(sequenceEntries(short.items, ''), laneOrder(short), names, FIXED, 100);
    expect(tight.lanes[1].x - tight.lanes[0].x).toBe(Math.max(SEQ.minGap, 20 * 8 + SEQ.labelChrome));
    expect(layoutSequence(sequenceEntries(o.items, ''), laneOrder(o), names, FIXED, 5000).lanes).toEqual(wide.lanes);
  });

  it('frames a par block and the chosen scenario around their messages, the par block inside the scenario', () => {
    const layout = layoutSequence(sequenceEntries(outline.items, 'Miss'), lanes, names, FIXED);
    const scenario = layout.frames.find((f) => f.kind === 'scenario')!;
    const [inner, outer] = layout.frames.filter((f) => f.kind === 'parallel');
    expect(scenario.title).toBe('Scenario: Miss');
    expect(inner.title).toBe('At the same time');
    const inside = (a: { x: number; y: number; width: number; height: number }, b: typeof a) => a.x > b.x && a.y > b.y && a.x + a.width < b.x + b.width && a.y + a.height < b.y + b.height;
    expect(inside(inner, scenario)).toBe(true);
    expect(inside(outer, scenario)).toBe(false);
    // Each frame holds its messages' rows.
    const rows = (f: typeof inner) => layout.messages.filter((m) => m.y > f.y && m.y < f.y + f.height).map((m) => m.step.label);
    expect(rows(inner)).toEqual(['SET order', 'SEND OrderRead']);
    expect(rows(outer)).toEqual(['INSERT audit', 'SEND audit']);
    expect(rows(scenario)).toEqual(['SELECT order', 'SET order', 'SEND OrderRead']);
    // Nothing reaches past the left margin.
    expect(Math.min(...layout.frames.map((f) => f.x))).toBeGreaterThanOrEqual(SEQ.margin);
    expect(layout.width).toBeGreaterThanOrEqual(Math.max(...layout.frames.map((f) => f.x + f.width)));
  });

  it('notes a folded set of scenarios across the lanes', () => {
    const layout = layoutSequence(sequenceEntries(outline.items, ''), lanes, names, FIXED);
    expect(layout.notes).toHaveLength(1);
    expect(layout.notes[0]).toMatchObject({ kind: 'scenarios', names: ['Hit', 'Miss'] });
    expect(layout.notes[0].x).toBeLessThan(layout.lanes[0].x);
    expect(layout.notes[0].x + layout.notes[0].width).toBeGreaterThan(layout.lanes.at(-1)!.x);
  });

  it('has an insertion point before each message, at the end of each frame and of the diagram', () => {
    const layout = layoutSequence(sequenceEntries(outline.items, 'Miss'), lanes, names, FIXED);
    const kinds = layout.slots.map((s) => (s.slot.kind === 'before' || s.slot.kind === 'after' ? `${s.slot.kind} ${s.slot.line}` : s.slot.kind === 'scenario' ? `scenario ${s.slot.name}` : s.slot.kind === 'par' ? `par ${s.slot.line}` : s.slot.kind));
    // Right after a step a frame follows, too (7 before the scenario, 11 before its par block).
    expect(kinds).toEqual(['before 7', 'after 7', 'before 11', 'after 11', 'before 13', 'before 14', 'par 12', 'scenario Miss', 'before 18', 'before 19', 'par 17', 'before 21', 'end']);
    // Top to bottom, each "+" at its row's top edge, a frame's inside its left edge, the main flow's in the margin.
    const ys = layout.slots.map((s) => s.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    for (const m of layout.messages) expect(layout.slots.find((s) => s.slot.kind === 'before' && s.slot.line === m.step.line)!.y).toBe(m.y - SEQ.row / 2);
    const scenario = layout.frames.find((f) => f.kind === 'scenario')!;
    expect(layout.slots.find((s) => s.slot.kind === 'before' && s.slot.line === 11)!.x).toBe(scenario.x + 4);
    expect(layout.slots[0].x).toBe(2);
    expect(layout.slots.map((s) => s.index)).toEqual([0, 1, 1, 2, 2, 3, 4, 4, 4, 5, 6, 6, 7]);
    expect(layout.slots.at(-1)!.y).toBeLessThan(layout.height);
  });

  it('widens a par frame for its actions', () => {
    const layout = layoutSequence(sequenceEntries(outline.items, ''), lanes, names, FIXED);
    expect(layout.frames[0].width).toBeGreaterThanOrEqual(FIXED.name('At the same time') + 40 + SEQ.frameActions);
  });

  it('lays out an empty use case as no lanes and no rows', () => {
    const layout = layoutSequence([], [], names, FIXED);
    expect(layout.lanes).toEqual([]);
    expect(layout.messages).toEqual([]);
    expect(layout.adds).toEqual([]);
    expect(layout.draft).toBeUndefined();
    expect(layout.height).toBe(SEQ.top + SEQ.bottom);
  });
});

describe('what the view adds to the rows', () => {
  const lanes = laneOrder(outline);
  const names = (id: string) => id.toUpperCase();
  const entries = sequenceEntries(outline.items, 'Miss');
  const plain = layoutSequence(entries, lanes, names, FIXED);
  const y = (l: typeof plain, line: number) => l.messages.find((m) => m.step.line === line)!.y;

  it('makes room under a step: every row below it moves down by it, and the frames around it grow', () => {
    // Under SET order (13), in the par block in the scenario.
    const roomy = layoutSequence(entries, lanes, names, FIXED, undefined, { room: { line: 13, below: 50 } });
    for (const m of plain.messages) expect(y(roomy, m.step.line)).toBe(m.step.line <= 13 ? m.y : m.y + 50);
    const grown = (kind: 'parallel' | 'scenario', line: number) => {
      const [a, b] = [plain, roomy].map((l) => l.frames.find((f) => f.kind === kind && f.line === line)!);
      return [b.y - a.y, b.height - a.height];
    };
    expect(grown('parallel', 12)).toEqual([0, 50]);
    expect(grown('scenario', 10)).toEqual([0, 50]);
    expect(grown('parallel', 17)).toEqual([50, 0]);
    expect(roomy.height).toBe(plain.height + 50);
    // The "+" before the next row is under the room, at that row's top.
    expect(roomy.slots.find((s) => s.slot.kind === 'before' && s.slot.line === 14)!.y).toBe(y(roomy, 14) - SEQ.row / 2);
  });

  it('puts a draft row at its insertion point, before a step, after one, or at the end of a frame or of the flow', () => {
    const at = (slot: Slot) => layoutSequence(entries, lanes, names, FIXED, undefined, { draft: { slot, height: 60 } });
    const before = at({ kind: 'before', line: 13 });
    expect(before.draft).toMatchObject({ top: y(plain, 13) - SEQ.row / 2, height: 60 });
    expect(y(before, 13)).toBe(y(plain, 13) + 60);
    expect(y(before, 11)).toBe(y(plain, 11));
    const after = at({ kind: 'after', line: 13 });
    expect(after.draft!.top).toBe(y(plain, 13) + SEQ.row / 2);
    expect(y(after, 14)).toBe(y(plain, 14) + 60);
    // At the end of the par block: inside its frame, after its last row.
    const par = at({ kind: 'par', line: 12 });
    const frame = par.frames.find((f) => f.kind === 'parallel' && f.line === 12)!;
    expect(par.draft!.top).toBe(y(plain, 14) + SEQ.row / 2);
    expect(par.draft!.top + 60).toBeLessThan(frame.y + frame.height);
    const end = at({ kind: 'end' });
    expect(end.draft!.top).toBeGreaterThan(Math.max(...end.messages.map((m) => m.y)));
    expect(end.height).toBe(plain.height + 60);
    // Nowhere else, and only once.
    expect(at({ kind: 'before', line: 999 }).draft).toBeUndefined();
  });

  it('adds an "Add step" row at the end of the flow and of each frame, inside it', () => {
    const layout = layoutSequence(entries, lanes, names, FIXED, undefined, { adds: true });
    const kinds = layout.adds.map((a) => (a.slot.kind === 'par' ? `par ${a.slot.line}` : a.slot.kind === 'scenario' ? `scenario ${a.slot.name}` : a.slot.kind));
    expect(kinds).toEqual(['par 12', 'scenario Miss', 'par 17', 'end']);
    for (const a of layout.adds.slice(0, -1)) {
      const frame = layout.frames.find((f) => (a.slot.kind === 'par' ? f.kind === 'parallel' && f.line === (a.slot as { line: number }).line : f.kind === 'scenario'))!;
      expect(a.x).toBe(frame.x + 4);
      expect(a.y).toBeGreaterThan(frame.y);
      expect(a.y + SEQ.add).toBeLessThanOrEqual(frame.y + frame.height);
    }
    const end = layout.adds.at(-1)!;
    expect(end.x).toBe(2);
    expect(end.y).toBeGreaterThan(Math.max(...layout.frames.map((f) => f.y + f.height)));
    expect(layout.height).toBe(plain.height + 4 * SEQ.add);
  });
});

describe('the view around it', () => {
  it('finds the connection a step travels, either way', () => {
    const edges = [
      { id: 'e1', source: 'web', target: 'api' },
      { id: 'e2', source: 'api', target: 'db' },
    ];
    expect(stepEdge({ from: 'web', to: 'api' }, edges)).toBe('e1');
    expect(stepEdge({ from: 'db', to: 'api' }, edges)).toBe('e2');
    expect(stepEdge({ from: 'web', to: 'db' }, edges)).toBeUndefined();
  });
});
