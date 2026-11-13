import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../src/cli';

const BEFORE = `title "Orders"
shopper [Browser]
api [REST API] x2
db [PostgreSQL]
shopper -> api
api -> db

usecase "Order status" {
  shopper -> api : GET /orders/42
  api -> db : SELECT order
  api --> shopper : 200
}

traffic {
  "Order status" 2k rps
}

requirements {
  p99 "Order status" < 50ms
  survive failure of db
}
`;

const AFTER = BEFORE.replace('api [REST API] x2', 'api [REST API] x3\ncache [Redis]')
  .replace('db [PostgreSQL]', 'db [PostgreSQL] x2')
  .replace('api -> db\n', 'api -> db\napi -> cache\n')
  .replace('api -> db : SELECT order', 'api -> cache : GET order:42')
  .replace('2k rps', '3k rps');

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'proschi-diff-')));
writeFileSync(join(dir, 'proschi.json'), '{}');
writeFileSync(join(dir, 'before.proschi'), BEFORE);
writeFileSync(join(dir, 'after.proschi'), AFTER);
writeFileSync(join(dir, 'broken.proschi'), BEFORE.replace('api -> db\n', 'api -> \n'));

async function diff(...args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(['diff', ...args], (s) => out.push(s), (s) => err.push(s));
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('proschi diff', () => {
  it('prints the structural diff, then what the change does in the simulation', async () => {
    const { code, out, err } = await diff(join(dir, 'before.proschi'), join(dir, 'after.proschi'));
    expect(err).toBe('');
    expect(code).toBe(0);
    const sim = out.slice(out.indexOf('\n\nSimulation') + 2);
    expect(out).toContain('Nodes\n  + cache');
    expect(sim).toBe(
      [
        'Simulation',
        '  Cost          $600/mo  →  $1,250/mo  +$650/mo  worse',
        '  Worst p99     59.9 ms  →  38.2 ms              better',
        '  Availability  99.947%  →  99.89%               worse',
        '  Checks: 0 of 2 pass → 2 of 2 pass',
        '',
        'Checks that changed',
        '  p99 of Order status < 50 ms  fail  →  pass  ✓ now passes  better',
        '  survive failure of db        fail  →  pass  ✓ now passes  better',
        '',
        'Per use case',
        '  Traffic · Order status       2k rps   →  3k rps',
        '  p99 · Order status           59.9 ms  →  38.2 ms    better',
        '  Availability · Order status  99.947%  →  99.89%     worse',
        '',
        'Load that moved',
        '  Utilisation · db  10%  →  0%    better',
      ].join('\n'),
    );
  });

  it('prints JSON with the diff and the deltas', async () => {
    const { code, out } = await diff('--json', join(dir, 'before.proschi'), join(dir, 'after.proschi'));
    expect(code).toBe(0);
    const json = JSON.parse(out);
    expect(json.summary.total).toEqual({ added: 2, removed: 0, changed: 5 });
    expect(json.delta.total.before.costUsd).toBeCloseTo(600, 0);
    expect(json.delta.checkChanges.map((c: { before: boolean; after: boolean }) => [c.before, c.after])).toEqual([
      [false, true],
      [false, true],
    ]);
    expect(json.delta.useCases[0]).toMatchObject({ name: 'Order status', rps: { before: 2000, after: 3000 } });
    expect(json.delta.diff).toBeUndefined();
  });

  it('says no changes, with no simulation section, for the same design', async () => {
    const { code, out } = await diff(join(dir, 'before.proschi'), join(dir, 'before.proschi'));
    expect(code).toBe(0);
    expect(out.split('\n').slice(1)).toEqual(['', 'No changes']);
  });

  it('warns about a side with errors, and checks its arguments', async () => {
    const broken = await diff(join(dir, 'broken.proschi'), join(dir, 'after.proschi'));
    expect(broken.code).toBe(0);
    expect(broken.err).toMatch(/broken\.proschi has 1 error\(s\); the diff covers what parsed/);
    expect((await diff(join(dir, 'before.proschi'))).code).toBe(2);
    expect((await diff('--nope', 'a', 'b')).code).toBe(2);
    const missing = await diff(join(dir, 'before.proschi'), join(dir, 'missing.proschi'));
    expect(missing.code).toBe(1);
    expect(missing.err).toMatch(/^error: /);
  });
});
