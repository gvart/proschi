import { describe, expect, it } from 'vitest';
import { format } from './format';
import { parse } from './parser';

const BASE = `
client [Actor]
api [REST API]
cache [Redis]
db [PostgreSQL] x2
usecase "Read" {
  client -> api : GET /items
  api -> db : SELECT item
  api --> client : 200
}
traffic {
  "Read" 1k rps
}
`;

describe('whatif blocks', () => {
  it('parses traffic, fail and replica changes', () => {
    const { diagram, diagnostics, blocks } = parse(`${BASE}whatif "Black Friday" {
  traffic "Read" x3
  fail cache
  db x4
}
whatif "Launch" {
  traffic "Read" 50k rps
}
`);
    expect(diagnostics).toEqual([]);
    expect(diagram.whatifs?.map((w) => ({ name: w.name, changes: w.changes.map((c) => ({ ...c, loc: undefined })) }))).toEqual([
      {
        name: 'Black Friday',
        changes: [
          { kind: 'traffic', useCase: 'Read', multiply: 3 },
          { kind: 'fail', node: 'cache' },
          { kind: 'replicas', node: 'db', replicas: 4 },
        ],
      },
      { name: 'Launch', changes: [{ kind: 'traffic', useCase: 'Read', rps: 50_000 }] },
    ]);
    expect(diagram.whatifs?.[0].loc).toMatchObject({ line: 14, col: 8 });
    expect(blocks?.filter((b) => b.kind === 'whatif')).toEqual([
      { kind: 'whatif', start: 14, end: 18 },
      { kind: 'whatif', start: 19, end: 21 },
    ]);
    // No node is created from the lines of the block.
    expect(diagram.nodes.map((n) => n.id)).toEqual(['client', 'api', 'cache', 'db']);
  });

  it('leaves whatifs out of a document without them', () => {
    expect('whatifs' in parse(BASE).diagram).toBe(false);
  });

  it('keeps whatif usable as a node id', () => {
    const { diagram, diagnostics } = parse('whatif "What if" [Service]\nwhatif -> other');
    expect(diagnostics).toEqual([]);
    expect(diagram.nodes.map((n) => n.id)).toEqual(['whatif', 'other']);
    expect(diagram.whatifs).toBeUndefined();
  });

  it('takes fractional traffic multipliers, but whole replicas', () => {
    const { diagram, diagnostics } = parse(`${BASE}whatif "W" {\n  traffic "Read" x1.5\n  db x2.5\n}\nwhatif "Half" {\n  traffic "Read" x0.5\n}\n`);
    expect(diagram.whatifs?.map((w) => w.changes.map((c) => ('multiply' in c ? c.multiply : undefined)))).toEqual([[1.5], [0.5]]);
    expect(diagnostics.map((d) => [d.severity, d.line, d.message])).toEqual([['error', 16, 'Replicas are a whole number, e.g. db x4']]);
    expect(format('whatif "W" {\ntraffic "Read"   x1.5\n}\n')).toBe('whatif "W" {\n  traffic "Read" x1.5\n}\n');
  });

  it('reads `fail x2` as the replicas of a node called fail', () => {
    const { diagram } = parse(`fail [Service]\nwhatif "W" {\n  fail x2\n}`);
    expect(diagram.whatifs?.[0].changes[0]).toMatchObject({ kind: 'replicas', node: 'fail', replicas: 2 });
  });

  it('warns about unknown nodes and use cases, and an empty what-if', () => {
    const { diagnostics } = parse(`${BASE}whatif "W" {
  traffic "Write" x2
  fail redis
  dbx x3
}
whatif "Empty" {
}
`);
    expect(diagnostics.map((d) => [d.severity, d.line, d.message])).toEqual([
      ['warning', 15, "Unknown use case 'Write'"],
      ['warning', 16, "Unknown node 'redis' in what-if"],
      ['warning', 17, "Unknown node 'dbx' in what-if"],
      ['warning', 19, "What-if 'Empty' changes nothing"],
    ]);
  });

  it('reports malformed lines, duplicates and misplaced blocks', () => {
    const { diagnostics } = parse(`${BASE}whatif "W" {
  traffic Read x2
  traffic "Read" 5ms
  fail
  db x0
  cache x2
  cache x3
  fail api
  fail api
  traffic "Read" x2
  traffic "Read" 2k rps
  db replicas 2
}
whatif "W" {
}
group g {
  whatif "Inner" {
  }
}
`);
    expect(diagnostics.map((d) => [d.severity, d.line, d.message])).toEqual([
      ['error', 15, 'Expected a use case name in quotes, e.g. traffic "Checkout" x3 or traffic "Checkout" 50k rps'],
      ['error', 16, "Expected a rate, e.g. 100k rps, 6k rpm or 1m rpd, not '5ms'"],
      ['error', 17, 'Expected the node that fails, e.g. fail cache'],
      ['error', 18, 'A what-if needs at least one replica, x1; to take a node down, write fail <node>'],
      ['error', 20, "Replicas of 'cache' are set twice in this what-if"],
      ['error', 22, "'api' fails twice in this what-if"],
      ['error', 24, "Traffic of 'Read' is changed twice in this what-if"],
      ['error', 25, 'Expected a what-if change: traffic "Use case" x3, traffic "Use case" 50k rps, fail <node> or <node> x4'],
      ['error', 27, "Duplicate what-if 'W' (first on line 14)"],
      ['error', 30, 'whatif is only allowed at the top level'],
    ]);
  });

  it('formats a whatif block as plain lines at one indent', () => {
    expect(format('whatif   "W"  {\ntraffic "Read"   x3\n      fail cache\ndb   x4\n}\n')).toBe('whatif "W" {\n  traffic "Read" x3\n  fail cache\n  db x4\n}\n');
  });
});
