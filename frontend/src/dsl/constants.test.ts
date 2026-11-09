import { describe, expect, it } from 'vitest';
import { parse } from './parser';
import { format } from './format';
import { tokenizeLine } from './lexer';

const base = `
api [REST API]
db  [PostgreSQL]
api -> db
usecase "Read" {
  api -> db : SELECT
}
`;

const messages = (source: string) => parse(source).diagnostics.map((d) => `${d.severity}: ${d.message}`);

describe('constants', () => {
  it('lexes $name and x$name as one token each, and = as an operator', () => {
    const { tokens, diagnostics } = tokenizeLine('let n = 3 api x$n $peak', 1);
    expect(diagnostics).toEqual([]);
    expect(tokens.map((t) => [t.kind, t.value])).toEqual([
      ['ident', 'let'],
      ['ident', 'n'],
      ['op', '='],
      ['number', '3'],
      ['ident', 'api'],
      ['const', 'x$n'],
      ['const', '$peak'],
    ]);
  });

  it('replaces every use with the value, in each place a literal of its kind goes', () => {
    const source = `let peak = 120k rps
let n = 3
let slo = 50ms
let budget = 500 usd/month
let hit = 90%
let fast = 4ms
let shards = 4
let factor = 1.5
api [REST API] x$n
db  [PostgreSQL]
api -> db
usecase "Read" {
  api -> db : SELECT
}
traffic {
  "Read" $peak
}
requirements {
  p99 "Read" < $slo
  availability >= $hit
  cost <= $budget
}
capacity {
  db $peak latency $fast shards $shards
}
whatif "More" {
  traffic "Read" x$factor
  db x$n
}
whatif "Fixed" {
  traffic "Read" $peak
}
`;
    const { diagram, diagnostics } = parse(source);
    expect(diagnostics).toEqual([]);
    expect(diagram.nodes.find((n) => n.id === 'api')!.replicas).toBe(3);
    expect(diagram.traffic![0].rps).toBe(120_000);
    expect(diagram.requirements!.map((r) => ('maxMs' in r ? r.maxMs : 'minPercent' in r ? r.minPercent : 'maxUsdPerMonth' in r ? r.maxUsdPerMonth : 0))).toEqual([50, 90, 500]);
    expect(diagram.capacity![0]).toMatchObject({ rps: 120_000, latencyMs: 4, shards: 4 });
    expect(diagram.whatifs![0].changes).toMatchObject([
      { kind: 'traffic', multiply: 1.5 },
      { kind: 'replicas', node: 'db', replicas: 3 },
    ]);
    expect(diagram.whatifs![1].changes).toMatchObject([{ kind: 'traffic', rps: 120_000 }]);
    expect(diagram.constants!.map((c) => [c.name, c.value, c.unit, c.text])).toEqual([
      ['peak', 120_000, 'rps', '120k rps'],
      ['n', 3, undefined, '3'],
      ['slo', 50, 'ms', '50ms'],
      ['budget', 500, 'usd/month', '500 usd/month'],
      ['hit', 90, '%', '90%'],
      ['fast', 4, 'ms', '4ms'],
      ['shards', 4, undefined, '4'],
      ['factor', 1.5, undefined, '1.5'],
    ]);
    expect(diagram.constants![0].loc).toEqual({ line: 1, col: 5, length: 4 });
  });

  it('may be used above its let line, and in a mix share', () => {
    const { diagram, diagnostics } = parse(`${base}traffic {\n  "Read" $rate mix "main" $all\n}\nlet rate = 2k rps\nlet all = 100%\n`);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(diagram.traffic![0].rps).toBe(2000);
  });

  it('leaves a document without constants as it was', () => {
    expect('constants' in parse(base).diagram).toBe(false);
  });

  it('reports an unknown name, with a suggestion when one is close', () => {
    expect(messages(`${base}traffic {\n  "Read" $peak\n}\n`)).toEqual(["error: Unknown constant '$peak'; define it with let peak = …"]);
    expect(messages(`let peak = 1k rps\n${base}traffic {\n  "Read" $paek\n}\n`)).toEqual(["error: Unknown constant '$paek'; did you mean '$peak'?"]);
  });

  it('reports a kind mismatch', () => {
    expect(messages(`let slo = 50ms\n${base}traffic {\n  "Read" $slo\n}\n`)).toEqual(["error: '$slo' is 50ms, a duration; expected a rate, e.g. 100k rps, 6k rpm or 1m rpd"]);
    expect(messages(`let peak = 1k rps\napi [REST API] x$peak\n`)).toEqual(["error: 'x$peak' needs a plain number, as in let peak = 3; '$peak' is 1k rps, a rate"]);
    expect(messages(`let n = 2.5\napi [REST API] x$n\n`)).toEqual(["error: A node needs a whole number of replicas, at least 1: x1, x2, … ('x$n' is 2.5)"]);
    expect(messages(`let n = 2\napi [REST API] $n\n`)).toEqual(['error: Write x$n for replicas']);
  });

  it('reports a constant defined twice, and one inside a block', () => {
    expect(messages('let a = 1\nlet a = 2\n')).toEqual(["error: Constant 'a' is defined twice (first on line 1)"]);
    expect(messages('group g {\n  let a = 1\n}\n')).toEqual(['error: Define constants at the top level, not inside a block']);
    expect(messages('let a = fast\n')).toEqual(["error: Expected a number or quantity after =, e.g. let a = 120k rps, not 'fast'"]);
  });

  it('keeps a node called let', () => {
    const { diagram, diagnostics } = parse('let [REST API]\n');
    expect(diagnostics).toEqual([]);
    expect(diagram.nodes[0].id).toBe('let');
  });

  it('formats let lines and constant uses without changing them', () => {
    const source = 'let   peak =   120k  rps\napi [REST API]  x$n\ntraffic {\n"Read"   $peak\n}\n';
    expect(format(source)).toBe('let peak = 120k rps\napi [REST API] x$n\ntraffic {\n  "Read" $peak\n}\n');
  });
});
