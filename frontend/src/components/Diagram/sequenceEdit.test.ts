import { describe, expect, it } from 'vitest';
import { groupParallel, moveStep, outlineOf, setStep, type EditResult, type OutlineStep } from '../../dsl/edit';
import { insertAt, insertedStep, movedStep, samePlaces, slotNear } from './sequenceEdit';
import { allSteps } from './sequenceLayout';

const SRC = [
  'web "Web" [Browser]',
  'api "API" [REST API]',
  'db "DB" [PostgreSQL]',
  'q "Events" [AWS SQS]',
  'web -> api : HTTPS',
  'api -> db : SQL',
  'usecase "Order" {',
  '  web -> api : POST /orders',
  '  api -> db : INSERT order',
  '  alt "Hit" {',
  '    api -> db : SELECT order',
  '  }',
  '  par {',
  '    api -> db : INSERT audit',
  '    api -> db : INSERT audit',
  '  }',
  '  api --> web : 201',
  '}',
  '',
].join('\n');

const ok = (r: EditResult): string => {
  if (r.error !== undefined) throw new Error(r.error);
  return r.source;
};
const steps = (text: string) => allSteps(outlineOf(text, 'Order')!.items);
const said = (s: OutlineStep | undefined) => s && `${s.line} ${s.from}>${s.to}:${s.label}`;
const reply = { from: 'db', to: 'api', kind: 'response' as const, label: 'ok' };

describe('adding a step at an insertion point', () => {
  it('writes it before a step, at the end of a scenario, a par block or the main flow, and right after a step', () => {
    expect(ok(insertAt(SRC, 'Order', { kind: 'before', line: 9 }, reply))).toContain('  web -> api : POST /orders\n  db --> api : ok\n  api -> db : INSERT order\n');
    expect(ok(insertAt(SRC, 'Order', { kind: 'scenario', name: 'Hit' }, reply))).toContain('    api -> db : SELECT order\n    db --> api : ok\n  }\n');
    expect(ok(insertAt(SRC, 'Order', { kind: 'par', line: 13 }, reply))).toContain('    api -> db : INSERT audit\n    db --> api : ok\n  }\n');
    expect(ok(insertAt(SRC, 'Order', { kind: 'end' }, reply))).toContain('  api --> web : 201\n  db --> api : ok\n}\n');
    // Right after a step that a block follows: before the block, which "before" can't say.
    expect(ok(insertAt(SRC, 'Order', { kind: 'after', line: 9 }, reply))).toContain('  api -> db : INSERT order\n  db --> api : ok\n  alt "Hit" {\n');
  });

  it("connects a step's components when they are not yet, and refuses a step to itself", () => {
    expect(ok(insertAt(SRC, 'Order', { kind: 'end' }, { from: 'api', to: 'q', kind: 'async', label: 'SEND' }))).toContain('api -> q');
    expect(insertAt(SRC, 'Order', { kind: 'end' }, { from: 'api', to: 'api', kind: 'request' }).error).toMatch(/one component to another/);
  });
});

describe('the selection after an edit', () => {
  it('finds the step an insertion added, its twin before it too', () => {
    const before = steps(SRC);
    const twin = { from: 'api', to: 'db', kind: 'request' as const, label: 'INSERT audit' };
    const slot = { kind: 'before' as const, line: 14 };
    expect(said(insertedStep(before, steps(ok(insertAt(SRC, 'Order', slot, twin))), slot))).toBe('14 api>db:INSERT audit');
    expect(said(insertedStep(before, steps(ok(insertAt(SRC, 'Order', { kind: 'par', line: 13 }, twin)))))).toBe('16 api>db:INSERT audit');
    // A connection written above the use case shifts every line.
    const connected = ok(insertAt(SRC, 'Order', { kind: 'end' }, { from: 'api', to: 'q', kind: 'async', label: 'SEND' }));
    expect(said(insertedStep(before, steps(connected)))).toBe('19 api>q:SEND');
    expect(insertedStep(before, before)).toBeUndefined();
  });

  it('keeps the places of steps changed in place or grouped, whatever they now say', () => {
    const before = steps(SRC);
    const changed = steps(ok(setStep(SRC, 9, { from: 'api', to: 'q', kind: 'async', label: 'SEND' })));
    expect(samePlaces(before, changed, [before[1]])?.map(said)).toEqual(['10 api>q:SEND']);
    const grouped = steps(ok(groupParallel(SRC, [8, 9])));
    expect(samePlaces(before, grouped, [before[0], before[1]])?.map(said)).toEqual(['9 web>api:POST /orders', '10 api>db:INSERT order']);
    expect(samePlaces(before, before.slice(1), [before[0]])).toBeUndefined();
  });

  it('follows a moved step past its twin', () => {
    const before = steps(SRC);
    const second = before.find((s) => s.line === 15)!;
    const moved = steps(ok(moveStep(SRC, 15, 'up')));
    expect(said(movedStep(moved, second, 'up'))).toBe('14 api>db:INSERT audit');
    expect(said(movedStep(steps(ok(moveStep(SRC, 9, 'up'))), before[1], 'up'))).toBe('8 api>db:INSERT order');
  });

  it('drops a drag at the nearest insertion point', () => {
    const slots = [{ y: 10 }, { y: 54 }, { y: 98 }];
    expect(slotNear(slots, 70)).toBe(slots[1]);
    expect(slotNear(slots, 400)).toBe(slots[2]);
    expect(slotNear([], 4)).toBeUndefined();
  });
});
