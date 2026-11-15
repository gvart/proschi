import { describe, expect, it } from 'vitest';
import { parse } from '../dsl/parser';
import { analyze } from './analyze';
import { availabilityRow, checkRow, costRow, deltaRows, designDelta, p99Row, utilizationRow } from './delta';
import { runTests } from './tests';
import { headlineOf } from './whatif';

const design = (replicas: string, cache: boolean, rps = '3k') => {
  const { diagram, diagnostics } = parse(`
shopper [Browser]
api [REST API] x3
${cache ? 'cache [Redis]' : ''}
db [PostgreSQL]${replicas}

shopper -> api
${cache ? 'api -> cache' : ''}
api -> db

usecase "Order status" {
  shopper -> api : GET /orders/42
  ${cache ? 'api -> cache : GET order' : 'api -> db : SELECT order'}
  api --> shopper : 200
}

usecase "Admin" {
  shopper -> api : GET /admin
  api --> shopper : 200
}

traffic {
  "Order status" ${rps} rps
}

requirements {
  p99 "Order status" < 50ms
  survive failure of db
}
`);
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return diagram;
};

describe('designDelta', () => {
  const before = design('', false);
  const after = design(' x2', true);
  const delta = designDelta(before, after);

  it('carries the structural diff', () => {
    expect(delta.diff.nodes.added.map((n) => n.id)).toEqual(['cache']);
    expect(delta.diff.nodes.changed.map((c) => c.key)).toEqual(['db']);
  });

  it('gives the headline of each side, as the what-if headline does', () => {
    expect(delta.total.before).toEqual(headlineOf(analyze(before)));
    expect(delta.total.after).toEqual(headlineOf(analyze(after)));
    expect(delta.total.after.costUsd).toBeGreaterThan(delta.total.before.costUsd);
  });

  it('gives each use case on both sides', () => {
    const status = delta.useCases.find((u) => u.name === 'Order status')!;
    expect(status.rps).toEqual({ before: 3000, after: 3000 });
    expect(status.p99Ms.after).toBeLessThan(status.p99Ms.before!);
    expect(delta.useCases.map((u) => u.name)).toEqual(['Order status', 'Admin']);
  });

  it('lists the checks that flipped, matched by name', () => {
    const survive = delta.checkChanges.find((c) => c.category === 'resilience');
    expect(survive).toMatchObject({ before: false, after: true });
    const results = runTests(after, analyze(after));
    expect(delta.checks.after).toEqual({ passed: results.filter((r) => r.passed).length, total: results.length });
    // A check that holds on both sides is not a change.
    expect(delta.checkChanges.every((c) => c.before !== c.after)).toBe(true);
  });

  it('lists a check only one side has, and puts what now fails first', () => {
    const extra = parse('a [Actor]\nb [REST API]\na -> b\nusecase "U" {\n  a -> b : GET\n  b --> a : 200\n}\ntraffic {\n  "U" 10 rps\n}').diagram;
    const withReq = parse(`a [Actor]\nb [REST API]\na -> b\nusecase "U" {\n  a -> b : GET\n  b --> a : 200\n}\ntraffic {\n  "U" 10 rps\n}\nrequirements {\n  p99 "U" < 1ms\n  cost <= 1 usd/month\n}`).diagram;
    const d = designDelta(extra, withReq);
    expect(d.checkChanges.map((c) => [c.before, c.after])).toEqual([
      [undefined, false],
      [undefined, false],
    ]);
    const back = designDelta(withReq, extra);
    expect(back.checkChanges.every((c) => c.after === undefined && c.before === false)).toBe(true);
  });

  it('lists the nodes whose utilisation moved past the threshold', () => {
    const hot = designDelta(design('', false, '3k'), design('', false, '9k'));
    expect(hot.utilization.length).toBeGreaterThan(0);
    for (const u of hot.utilization) expect(Math.abs(u.after! - u.before!)).toBeGreaterThanOrEqual(0.1);
    // Biggest move first.
    const moves = hot.utilization.map((u) => Math.abs(u.after! - u.before!));
    expect(moves).toEqual([...moves].sort((x, y) => y - x));
    expect(designDelta(before, before).utilization).toEqual([]);
    expect(designDelta(before, before, { utilizationThreshold: 0 }).utilization.length).toBe(analyze(before).nodes.length);
  });

  it('is empty between a design and itself', () => {
    const same = designDelta(before, before);
    expect(same.checkChanges).toEqual([]);
    expect(deltaRows(same).headline.every((r) => r.tone === 'same')).toBe(true);
  });
});

describe('delta rows', () => {
  it('formats cost with a sign, cheaper is better', () => {
    expect(costRow(1250, 1130)).toEqual({ label: 'Cost', before: '$1,250/mo', after: '$1,130/mo', change: '−$120/mo', tone: 'better' });
    expect(costRow(600, 1250)).toMatchObject({ change: '+$650/mo', tone: 'worse' });
    expect(costRow(600, 600.2)).toMatchObject({ change: 'same', tone: 'same' });
  });

  it('formats p99 as before→after, faster is better', () => {
    expect(p99Row('p99 · Read', 48, 31)).toMatchObject({ before: '48 ms', after: '31 ms', change: 'p99 48→31 ms', tone: 'better' });
    expect(p99Row('Worst p99', 31, 48).tone).toBe('worse');
    expect(p99Row('x', 31, 31.01)).toMatchObject({ change: 'same', tone: 'same' });
    expect(p99Row('x', undefined, 31)).toMatchObject({ before: '—', change: 'new', tone: 'same' });
  });

  it('formats availability, higher is better', () => {
    expect(availabilityRow('Availability', 0.999, 0.9999)).toMatchObject({ change: '99.9%→99.99%', tone: 'better' });
    expect(availabilityRow('Availability', 0.9999, 0.999).tone).toBe('worse');
  });

  it('formats a flipped check', () => {
    expect(checkRow({ name: 'survive failure of db', category: 'resilience', before: false, after: true })).toEqual({
      label: 'survive failure of db',
      before: 'fail',
      after: 'pass',
      change: '✓ now passes',
      tone: 'better',
    });
    expect(checkRow({ name: 'cost', category: 'cost', before: true, after: false })).toMatchObject({ change: '✗ now fails', tone: 'worse' });
    expect(checkRow({ name: 'cost', category: 'cost', before: true })).toMatchObject({ after: '—', change: 'removed' });
  });

  it('formats utilisation, saying when a node saturates', () => {
    expect(utilizationRow({ node: 'db', before: 0.62, after: 1.4 })).toMatchObject({ label: 'Utilisation · db', change: '62%→140%, saturated', tone: 'worse' });
    expect(utilizationRow({ node: 'db', before: 1.2, after: 0.5 })).toMatchObject({ change: '120%→50%, no longer saturated', tone: 'better' });
  });

  it('puts traffic changes before a use case’s p99 and skips use cases without traffic', () => {
    const rows = deltaRows(designDelta(design('', false, '3k'), design('', false, '9k')));
    expect(rows.useCases[0]).toMatchObject({ label: 'Traffic · Order status', change: '3k rps→9k rps' });
    expect(rows.useCases.some((r) => r.label.includes('Admin'))).toBe(false);
  });
});
