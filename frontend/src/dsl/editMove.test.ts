import { describe, expect, it } from 'vitest';
import { addScenario, moveStepTo, outlineOf, type EditResult } from './edit';

/** The source of an edit that must succeed. */
const ok = (r: EditResult): string => {
  if (r.error !== undefined) throw new Error(r.error);
  return r.source;
};

const SRC = [
  'web "Web" [Browser]',
  'api "API" [REST API]',
  'db "DB" [PostgreSQL]',
  'q "Events" [AWS SQS]',
  '',
  'usecase "Order" {',
  '  web -> api : POST /orders {',
  '    "sku": 7',
  '  }',
  '  api -> db : SELECT stock',
  '  alt "In stock" {',
  '    db --> api : 1 row',
  '  } alt "Sold out" {',
  '    db --> api : 0 rows',
  '  }',
  '  par {',
  '    api -> db : INSERT order',
  '    api ->> q : SEND OrderPlaced',
  '  }',
  '  api --> web : 201',
  '}',
  '',
].join('\n');

/** The use case's lines, from its opening to its closing. */
const body = (text: string) => text.slice(text.indexOf('usecase "Order"')).trimEnd().split('\n');

describe('moving a step to a place', () => {
  it('moves a step before another, its multi-line payload whole', () => {
    const next = ok(moveStepTo(SRC, 7, { kind: 'before', line: 20 }));
    expect(body(next)).toEqual([
      'usecase "Order" {',
      '  api -> db : SELECT stock',
      '  alt "In stock" {',
      '    db --> api : 1 row',
      '  } alt "Sold out" {',
      '    db --> api : 0 rows',
      '  }',
      '  par {',
      '    api -> db : INSERT order',
      '    api ->> q : SEND OrderPlaced',
      '  }',
      '  web -> api : POST /orders {',
      '    "sku": 7',
      '  }',
      '  api --> web : 201',
      '}',
    ]);
  });

  it('moves a step after another, up the flow too', () => {
    const next = ok(moveStepTo(SRC, 20, { kind: 'after', line: 10 }));
    expect(body(next).slice(4, 6)).toEqual(['  api -> db : SELECT stock', '  api --> web : 201']);
    expect(body(next).at(-2)).toBe('  }');
  });

  it("moves a step into a scenario's branch and a par block, indented there", () => {
    const into = ok(moveStepTo(SRC, 10, { kind: 'scenario', name: 'Sold out' }));
    expect(body(into).slice(6, 10)).toEqual(['  } alt "Sold out" {', '    db --> api : 0 rows', '    api -> db : SELECT stock', '  }']);
    const par = ok(moveStepTo(SRC, 20, { kind: 'par', line: 16 }));
    expect(body(par).slice(10, 15)).toEqual(['  par {', '    api -> db : INSERT order', '    api ->> q : SEND OrderPlaced', '    api --> web : 201', '  }']);
  });

  it("moves a step out of a block, to the main flow's end", () => {
    const next = ok(moveStepTo(SRC, 14, { kind: 'end' }));
    expect(body(next).slice(7, 10)).toEqual(['  } alt "Sold out" {', '  }', '  par {']);
    expect(body(next).slice(-3)).toEqual(['  api --> web : 201', '  db --> api : 0 rows', '}']);
  });

  it('takes away a par block its last step leaves', () => {
    const one = ok(moveStepTo(SRC, 18, { kind: 'end' }));
    const alone = ok(moveStepTo(one, 17, { kind: 'before', line: 10 }));
    expect(body(alone)).not.toContain('  par {');
    expect(body(alone).slice(4, 6)).toEqual(['  api -> db : INSERT order', '  api -> db : SELECT stock']);
    expect(outlineOf(alone, 'Order')!.items.some((i) => i.kind === 'parallel')).toBe(false);
  });

  it('leaves the text as it is where the step already is, and refuses what is not a step or a place', () => {
    expect(ok(moveStepTo(SRC, 10, { kind: 'before', line: 10 }))).toBe(SRC);
    expect(ok(moveStepTo(SRC, 12, { kind: 'scenario', name: 'In stock' }))).toBe(SRC);
    expect(ok(moveStepTo(SRC, 10, { kind: 'after', line: 7 }))).toBe(SRC);
    expect(ok(moveStepTo(SRC, 20, { kind: 'end' }))).toBe(SRC);
    expect(moveStepTo(SRC, 11, { kind: 'end' }).error).toBeDefined();
    expect(moveStepTo(SRC, 10, { kind: 'scenario', name: 'Nope' }).error).toBeDefined();
    expect(moveStepTo(SRC, 10, { kind: 'before', line: 1 }).error).toBeDefined();
  });
});

describe('adding a scenario to a set', () => {
  const TWO = SRC.replace('  par {', '  api -> q : SEND x\n  alt "Fast" {\n  }\n  par {');
  it('adds to the set asked for, by default the last', () => {
    const first = ok(addScenario(TWO, 'Order', 'Back order', 0));
    expect(body(first).slice(7, 11)).toEqual(['  } alt "Sold out" {', '    db --> api : 0 rows', '  }', '  alt "Back order" {']);
    const last = ok(addScenario(TWO, 'Order', 'Slow'));
    expect(body(last).slice(11, 15)).toEqual(['  alt "Fast" {', '  }', '  alt "Slow" {', '  }']);
    expect(addScenario(TWO, 'Order', 'X', 5).error).toBeDefined();
  });
});
