import { describe, expect, it } from 'vitest';
import type { Assertion, Requirement, Selector } from '../dsl/types';
import { runTests } from './tests';
import { at, diagramOf, type Extras } from './testDiagram';

type Loose<T> = T extends unknown ? Omit<T, 'loc'> : never;

const READ = `
client [Actor]
api [REST API]
db [PostgreSQL]
client -> api
api -> db
usecase "Read" {
  client -> api : GET /items
  api -> db : SELECT item
  db --> api : row
  api --> client : 200
}
`;

/** Runs one requirement against `source`. */
function req(source: string, requirement: Loose<Requirement>, extras: Extras = {}) {
  const results = runTests(diagramOf(source, { ...extras, requirements: [{ ...requirement, loc: at(7) }] as Extras['requirements'] }));
  expect(results).toHaveLength(1);
  return results[0];
}

/** Runs one assertion in a test block against `source`. */
function check(source: string, assertion: Loose<Assertion>, extras: Extras = {}) {
  const [result] = runTests(diagramOf(source, { ...extras, tests: [{ name: 't', assertions: [assertion] as NonNullable<Extras['tests']>[number]['assertions'] }] }));
  return result;
}

describe('results', () => {
  it('yields one result per requirement and test block, with stable ids, names and locations', () => {
    const results = runTests(
      diagramOf(READ, {
        traffic: [{ useCase: 'Read', rps: 100 }],
        requirements: [
          { kind: 'latency', percentile: 99, useCase: 'Read', maxMs: 50, loc: at(3) },
          { kind: 'latency', percentile: 95, maxMs: 300 },
          { kind: 'availability', useCase: 'Read', minPercent: 99.95 },
          { kind: 'availability', minPercent: 99 },
          { kind: 'durable', useCase: 'Read' },
          { kind: 'survive', target: 'any' },
          { kind: 'survive', target: { kind: 'cache' } },
          { kind: 'cost', maxUsdPerMonth: 3000 },
        ],
        tests: [
          { name: 'Reads hit the db', assertions: [{ kind: 'calls', useCase: 'Read', target: { node: 'db' }, quantifier: 'some' }], loc: at(20) },
          { name: 'Reads hit the db', assertions: [] },
        ],
      }),
    );
    expect(results.map((r) => [r.id, r.name, r.category])).toEqual([
      ['req:1', 'p99 of Read < 50 ms', 'latency'],
      ['req:2', 'p95 of every use case < 300 ms', 'latency'],
      ['req:3', 'availability of Read ≥ 99.95%', 'availability'],
      ['req:4', 'availability of every use case ≥ 99%', 'availability'],
      ['req:5', 'Read is durable', 'durability'],
      ['req:6', 'survive any node failure', 'resilience'],
      ['req:7', 'survive failure of any cache', 'resilience'],
      ['req:8', 'cost ≤ $3,000/month', 'cost'],
      ['test:Reads hit the db', 'Reads hit the db', 'flow'],
      ['test:Reads hit the db#2', 'Reads hit the db', 'flow'],
    ]);
    expect(results[0].loc).toEqual(at(3));
    expect(results[8].loc).toEqual(at(20));
    expect(results[8].assertions).toHaveLength(1);
    // Passing results carry no hint.
    for (const r of results.filter((r) => r.passed)) expect(r.hint).toBeUndefined();
    for (const r of results.filter((r) => !r.passed)) expect(r.hint).toBeTruthy();
  });

  it('returns nothing for a document without requirements or tests', () => {
    expect(runTests(diagramOf(READ))).toEqual([]);
  });
});

describe('latency requirements', () => {
  const traffic = (rps: number) => ({ traffic: [{ useCase: 'Read', rps }] });

  it('passes under the limit and states the value and limit', () => {
    // p99 = 3 × (20 + 5 / 0.95) = 75.79 ms
    const r = req(READ, { kind: 'latency', percentile: 99, useCase: 'Read', maxMs: 100 }, traffic(1000));
    expect(r).toMatchObject({ passed: true, message: 'p99 of Read is 75.8 ms (limit 100 ms)' });
  });

  it('fails over the limit with a hint naming the slowest hop', () => {
    const r = req(READ, { kind: 'latency', percentile: 99, useCase: 'Read', maxMs: 50 }, traffic(1000));
    expect(r.passed).toBe(false);
    expect(r.message).toBe('p99 of Read is 75.8 ms (limit 50 ms)');
    expect(r.hint).toContain('api (REST API) at 20 ms');
  });

  it('names a hot node in the hint', () => {
    const r = req(READ, { kind: 'latency', percentile: 99, useCase: 'Read', maxMs: 50 }, traffic(1800));
    expect(r.hint).toContain('api (REST API) runs at 90%');
    expect(r.hint).toContain('add replicas');
  });

  it('fails every latency requirement touching a saturated node, naming it', () => {
    const r = req(READ, { kind: 'latency', percentile: 50, useCase: 'Read', maxMs: 10_000 }, traffic(6000));
    expect(r.passed).toBe(false);
    expect(r.message).toBe('p50 of Read: api is saturated (6k rps of 2k rps, 300%) (limit 10000 ms)');
    // 6000 / (2000 × 0.7) = 4.3 → 5 replicas
    expect(r.hint).toContain('x5 keeps it under 70%');
  });

  it('does not blame a saturated node the use case never sends load to', () => {
    const src = `${READ}
usecase "Other" {
  client -> api : GET /other
  api --> client : 200
}`;
    const r = req(src, { kind: 'latency', percentile: 99, useCase: 'Other', maxMs: 1000 }, {
      traffic: [{ useCase: 'Read', rps: 1000 }, { useCase: 'Other', rps: 100 }],
      capacity: [{ node: 'db', rps: 500 }],
    });
    expect(r.passed).toBe(true);
  });

  it('names the scenario that sets the percentile', () => {
    const src = `
client [Actor]
api [REST API]
db [PostgreSQL]
usecase "Get" {
  client -> api : GET
  alt "Fast" {
    api --> client : 200
  } alt "Slow" {
    api -> db : SELECT
    db --> api : row
    api --> client : 200
  }
}`;
    const r = req(src, { kind: 'latency', percentile: 99, useCase: 'Get', maxMs: 20 }, {
      traffic: [{ useCase: 'Get', rps: 1, mix: [{ scenario: 'Fast', share: 0.9 }, { scenario: 'Slow', share: 0.1 }] }],
    });
    expect(r.passed).toBe(false);
    expect(r.hint).toMatch(/^The "Slow" path \(10% of traffic\) sets p99\. Its slowest hop is api/);
  });

  it('checks every use case with traffic when no use case is named', () => {
    const src = `${READ}
usecase "Write" {
  client -> api : POST /items
  api -> db : INSERT
  db --> api : ok
  api --> client : 201
}
usecase "Idle" {
  client -> api : GET /idle
}`;
    const both = { traffic: [{ useCase: 'Read', rps: 100 }, { useCase: 'Write', rps: 100 }] };
    const ok = req(src, { kind: 'latency', percentile: 50, maxMs: 100 }, both);
    expect(ok.passed).toBe(true);
    expect(ok.message).toMatch(/^All 2 use cases hold; p50 of Read is .* ms, p50 of Write is .* ms \(limit 100 ms\)$/);
    const bad = req(src, { kind: 'latency', percentile: 50, maxMs: 10 }, both);
    expect(bad.passed).toBe(false);
    expect(bad.message).toMatch(/^p50 of Read is 16.\d ms; p50 of Write is 16.\d ms \(limit 10 ms\)$/);
  });

  it('fails when nothing has traffic or the use case does not exist', () => {
    expect(req(READ, { kind: 'latency', percentile: 50, maxMs: 100 })).toMatchObject({ passed: false, message: 'No use case has traffic, so there is nothing to measure' });
    const r = req(READ, { kind: 'latency', percentile: 50, useCase: 'Nope', maxMs: 100 });
    expect(r).toMatchObject({ passed: false, message: 'No use case named "Nope"', hint: 'Use one of "Read"' });
  });

  it('measures a named use case without traffic and says so', () => {
    expect(req(READ, { kind: 'latency', percentile: 50, useCase: 'Read', maxMs: 100 }).message).toBe('p50 of Read is 15 ms with no traffic (limit 100 ms)');
  });
});

describe('availability requirements', () => {
  it('compares the computed availability with the limit', () => {
    // 0.995 × 0.9995 = 99.45%
    const bad = req(READ, { kind: 'availability', useCase: 'Read', minPercent: 99.9 });
    expect(bad).toMatchObject({ passed: false, message: 'availability of Read is 99.45% (limit 99.9%)' });
    expect(bad.hint).toContain('The weakest link is api (REST API) at 99.5%: add a replica (x2)');

    const good = req(READ, { kind: 'availability', useCase: 'Read', minPercent: 99.9 }, { replicas: { api: 2 } });
    expect(good).toMatchObject({ passed: true, message: 'availability of Read is 99.947%' + ' (limit 99.9%)' });
  });

  it('checks every use case when none has traffic', () => {
    expect(req(READ, { kind: 'availability', minPercent: 99 }).passed).toBe(true);
  });
});

describe('durable requirement', () => {
  const doc = (write: string) => `
client [Actor]
api [REST API]
db [PostgreSQL]
cache [Redis]
q [Kafka]
worker [REST API]
usecase "Save" {
  client -> api : POST /items
${write}
}`;

  it('passes with a synchronous write to a durable node before the entry response', () => {
    const r = req(doc('  api -> db : INSERT\n  db --> api : ok\n  api --> client : 201'), { kind: 'durable', useCase: 'Save' });
    expect(r).toMatchObject({ passed: true, message: '"Save" writes to a durable store before responding' });
  });

  it('accepts a queue as a durable store', () => {
    expect(req(doc('  api -> q : ItemSaved\n  api --> client : 202'), { kind: 'durable', useCase: 'Save' }).passed).toBe(true);
  });

  it('fails for an async write', () => {
    const r = req(doc('  api ->> db : INSERT\n  api --> client : 201'), { kind: 'durable', useCase: 'Save' });
    expect(r).toMatchObject({ passed: false, message: '"Save" writes to a durable store only asynchronously: api ->> db : INSERT at line 10' });
    expect(r.hint).toContain('synchronous request (->)');
  });

  it('fails for a write after responding', () => {
    const r = req(doc('  api ->> q : ItemSaved\n  api --> client : 202\n  q ->> worker : ItemSaved\n  worker -> db : INSERT'), { kind: 'durable', useCase: 'Save' });
    expect(r.passed).toBe(false);
    // The queue send is async; the database write comes after the response.
    expect(r.message).toContain('writes to a durable store only asynchronously: api ->> q : ItemSaved');
    const after = req(doc('  api --> client : 202\n  worker -> db : INSERT'), { kind: 'durable', useCase: 'Save' });
    expect(after).toMatchObject({ passed: false, message: '"Save" writes to a durable store only after responding: worker -> db : INSERT at line 11' });
    expect(after.hint).toContain('before the step that answers');
  });

  it('fails for a write to a volatile node, or a failed write', () => {
    expect(req(doc('  api -> cache : SET\n  api --> client : 201'), { kind: 'durable', useCase: 'Save' }).message).toBe(
      '"Save" never writes to a durable store before responding',
    );
    expect(req(doc('  api -x db : INSERT\n  api --> client : 201'), { kind: 'durable', useCase: 'Save' }).passed).toBe(false);
  });

  it('follows capacity overrides of durability', () => {
    expect(req(doc('  api -> cache : SET\n  api --> client : 201'), { kind: 'durable', useCase: 'Save' }, { capacity: [{ node: 'cache', durable: true }] }).passed).toBe(true);
  });

  it('checks every success scenario and skips error scenarios', () => {
    const src = doc(`  alt "Created" {
    api -> db : INSERT
    api --> client : 201
  } alt "Queued" {
    api ->> q : later
    api --> client : 202
  } alt "Invalid" {
    api --> client : 400
  }`);
    const r = req(src, { kind: 'durable', useCase: 'Save' });
    expect(r).toMatchObject({ passed: false, message: '"Queued" writes to a durable store only asynchronously: api ->> q : later at line 14' });
  });

  it('fails for an unknown use case or one without success scenarios', () => {
    expect(req(READ, { kind: 'durable', useCase: 'Nope' }).passed).toBe(false);
    const r = req(doc('  api --> client : 500'), { kind: 'durable', useCase: 'Save' });
    expect(r).toMatchObject({ passed: false, message: '"Save" has no success scenario to check' });
  });
});

describe('survive requirement (failure injection)', () => {
  it('fails for a single-replica node a use case needs, naming both', () => {
    const r = req(READ, { kind: 'survive', target: 'any' });
    expect(r.passed).toBe(false);
    expect(r.message).toBe('Losing api (REST API) breaks "Read" (and 1 more)');
    expect(r.hint).toContain('Add a replica (x2 on api) or a fallback scenario in "Read"');
  });

  it('passes when every needed node has spare replicas', () => {
    const r = req(READ, { kind: 'survive', target: 'any' }, { replicas: { api: 2, db: 2 }, traffic: [{ useCase: 'Read', rps: 1000 }] });
    expect(r).toMatchObject({ passed: true, message: 'Every use case keeps working after losing any of 2 nodes' });
  });

  it('fails when the remaining replicas cannot carry the load', () => {
    // 3000 rps on 2 × 2000: losing one leaves 2000 for 3000.
    const r = req(READ, { kind: 'survive', target: { node: 'api' } }, { replicas: { api: 2, db: 2 }, traffic: [{ useCase: 'Read', rps: 3000 }] });
    expect(r).toMatchObject({ passed: false, message: 'Losing one of 2 api replicas leaves 2k rps for 3k rps (150%)' });
    expect(r.hint).toContain('x3');
  });

  it('passes for a single-replica node with a fallback scenario', () => {
    const src = `
client [Actor]
api [REST API]
cache [Redis]
db [PostgreSQL]
usecase "Get" {
  client -> api : GET
  alt "Hit" {
    api -> cache : GET
    cache --> api : v
  } alt "Cache down" {
    api -x cache : GET
    api -> db : SELECT
    db --> api : v
  }
  api --> client : 200
}`;
    expect(req(src, { kind: 'survive', target: { kind: 'cache' } })).toMatchObject({ passed: true, message: 'Every use case keeps working after losing cache' });
    expect(req(src, { kind: 'survive', target: { tech: 'redis' } }).passed).toBe(true);
    // The fallback itself needs the database.
    expect(req(src, { kind: 'survive', target: { node: 'db' } }).message).toBe('Losing db (PostgreSQL) breaks "Get"');
  });

  it('does not count an error scenario as a fallback', () => {
    const src = `
client [Actor]
api [REST API]
cache [Redis]
usecase "Get" {
  client -> api : GET
  alt "Hit" {
    api -> cache : GET
    api --> client : 200
  } alt "Cache down" {
    api -x cache : GET
    api --> client : 503
  }
}`;
    expect(req(src, { kind: 'survive', target: { node: 'cache' } }).passed).toBe(false);
  });

  it('leaves clients and external systems out of any node failure', () => {
    const src = `
client [Actor]
api [REST API]
pay [Payment Gateway]
usecase "Pay" {
  client -> api : POST
  api -> pay : charge
  api --> client : 200
}`;
    expect(req(src, { kind: 'survive', target: 'any' }, { replicas: { api: 2 } }).passed).toBe(true);
    expect(req(src, { kind: 'survive', target: { node: 'pay' } }).message).toBe('Losing pay (Payment Gateway) breaks "Pay"');
  });

  it('fails for a selector that matches nothing', () => {
    expect(req(READ, { kind: 'survive', target: { kind: 'queue' } })).toMatchObject({ passed: false, message: 'No node matches any queue' });
  });
});

describe('cost requirement', () => {
  it('compares the total with the limit and names the biggest items', () => {
    expect(req(READ, { kind: 'cost', maxUsdPerMonth: 500 })).toMatchObject({ passed: true, message: 'Total cost is $500/month (limit $500/month)' });
    const r = req(READ, { kind: 'cost', maxUsdPerMonth: 1000 }, { replicas: { db: 3 } });
    expect(r).toMatchObject({ passed: false, message: 'Total cost is $1,300/month (limit $1,000/month)' });
    expect(r.hint).toContain('db $1,200/month (3 replicas), api $100/month');
  });
});

describe('test blocks', () => {
  const SHOP = `
client [Actor]
gw [AWS API Gateway]
api [REST API]
cache [Redis]
db [PostgreSQL]
q [Kafka]
client -> gw
gw -> api
api -> cache
api -> db
api -> q
usecase "Get" {
  client -> gw : GET /items/1
  gw -> api : GET /items/1
  alt "Hit" {
    api -> cache : GET item
    cache --> api : item
    api --> gw : 200
  } alt "Miss" {
    api -> cache : GET item
    cache --> api : nil
    api -> db : SELECT
    db --> api : row
    api --> gw : 200
  } alt "Cache down" {
    api -x cache : GET item
    api -> db : SELECT
    db --> api : row
    api --> gw : 200
  } alt "Missing" {
    api -> db : SELECT
    db --> api : none
    api --> gw : 404
  }
  gw --> client : 200
}
usecase "Save" {
  client -> gw : POST /items
  gw -> api : POST /items
  alt "Created" {
    api -> db : INSERT
    db --> api : ok
    api ->> q : ItemCreated
    api --> gw : 201
    gw --> client : 201
  } alt "Invalid" {
    api --> gw : 400
    gw --> client : 400
  }
}`;

  describe('calls', () => {
    it('some: holds when a scenario calls a matching node', () => {
      expect(check(SHOP, { kind: 'calls', useCase: 'Get', target: { kind: 'cache' }, quantifier: 'some' })).toMatchObject({
        passed: true,
        message: '"Get" calls any cache in "Hit", "Miss", "Cache down"',
      });
      expect(check(SHOP, { kind: 'calls', useCase: 'Save', target: { kind: 'cache' }, quantifier: 'some' })).toMatchObject({
        passed: false,
        message: '"Save" never calls any cache',
      });
    });

    it('some: counts failed calls as calls and honours the scenario filter', () => {
      expect(check(SHOP, { kind: 'calls', useCase: 'Get', scenario: 'Cache down', target: { node: 'cache' }, quantifier: 'some' }).passed).toBe(true);
      expect(check(SHOP, { kind: 'calls', useCase: 'Get', scenario: 'Missing', target: { node: 'cache' }, quantifier: 'some' })).toMatchObject({
        passed: false,
        message: '"Get" scenario "Missing" never calls cache',
      });
    });

    it('every: lists the scenarios that miss the call', () => {
      expect(check(SHOP, { kind: 'calls', useCase: 'Get', target: { node: 'api' }, quantifier: 'every' }).passed).toBe(true);
      expect(check(SHOP, { kind: 'calls', useCase: 'Get', target: { kind: 'database' }, quantifier: 'every' })).toMatchObject({
        passed: false,
        message: '"Get" does not call any database in "Hit"',
      });
    });

    it('never: holds when no scenario calls it, and names the offender', () => {
      expect(check(SHOP, { kind: 'calls', useCase: 'Get', scenario: 'Hit', target: { kind: 'database' }, quantifier: 'never' })).toMatchObject({
        passed: true,
        message: '"Get" scenario "Hit" never calls any database',
      });
      const r = check(SHOP, { kind: 'calls', useCase: 'Get', target: { kind: 'database' }, quantifier: 'never' });
      expect(r).toMatchObject({ passed: false, message: '"Miss" calls db (PostgreSQL): api -> db : SELECT at line 23' });
      expect(r.hint).toContain('Take the call to db out of "Miss"');
    });

    it('never holds for a selector that matches nothing; some and every fail', () => {
      expect(check(SHOP, { kind: 'calls', useCase: 'Get', target: { kind: 'search' }, quantifier: 'never' }).passed).toBe(true);
      expect(check(SHOP, { kind: 'calls', useCase: 'Get', target: { kind: 'search' }, quantifier: 'some' })).toMatchObject({ passed: false, message: 'No node matches any search' });
      expect(check(SHOP, { kind: 'calls', useCase: 'Get', target: { node: 'ghost' }, quantifier: 'every' }).message).toBe('No node matches ghost');
    });

    it('fails for an unknown use case or scenario', () => {
      expect(check(SHOP, { kind: 'calls', useCase: 'Nope', target: { node: 'db' }, quantifier: 'some' }).message).toBe('No use case named "Nope"');
      const r = check(SHOP, { kind: 'calls', useCase: 'Get', scenario: 'Nope', target: { node: 'db' }, quantifier: 'some' });
      expect(r.message).toBe('"Get" has no scenario "Nope"; it has "Hit", "Miss", "Cache down", "Missing"');
    });
  });

  describe('selectors', () => {
    it('match by node id, tech (ignoring case) and kind', () => {
      const some = (target: Selector) =>
        check(SHOP, { kind: 'calls', useCase: 'Get', scenario: 'Hit', target, quantifier: 'some' }).passed;
      expect(some({ node: 'cache' })).toBe(true);
      expect(some({ node: 'Cache' })).toBe(false);
      expect(some({ tech: 'redis' })).toBe(true);
      expect(some({ tech: 'Redis' })).toBe(true);
      expect(some({ tech: 'Memcached' })).toBe(false);
      expect(some({ kind: 'cache' })).toBe(true);
      expect(some({ kind: 'edge' })).toBe(true);
      expect(some({ kind: 'database' })).toBe(false);
    });

    it('never match groups or text nodes', () => {
      const src = `${SHOP}
group grp "Group" {
  inner [REST API]
}
note [Sticky Note] "n"`;
      expect(check(src, { kind: 'replicas', target: { node: 'grp' }, min: 1 }).message).toBe('No node matches grp');
      expect(check(src, { kind: 'replicas', target: { node: 'note' }, min: 1 }).message).toBe('No node matches note');
    });

    it('treat implicit nodes as shapes (clients)', () => {
      const src = `
api [REST API]
usecase "U" {
  user -> api : GET
}`;
      expect(check(src, { kind: 'calls', useCase: 'U', target: { kind: 'service' }, quantifier: 'some' }).passed).toBe(true);
      expect(check(src, { kind: 'replicas', target: { kind: 'client' }, min: 1 })).toMatchObject({ passed: true, message: 'user has 1 replica (minimum 1)' });
    });

    it('find scenarios by full name, id, case-insensitively and with > for ›', () => {
      const src = `
api [REST API]
db [PostgreSQL]
usecase "U" {
  alt "Outer" {
    alt "Inner A" {
      api -> db : x
    } alt "Inner B" {
      api -> api : y
    }
  }
}`;
      for (const scenario of ['Outer › Inner A', 'outer > inner a', 'outer-inner-a']) {
        expect(check(src, { kind: 'hasScenario', useCase: 'U', scenario }).passed, scenario).toBe(true);
      }
      expect(check(src, { kind: 'hasScenario', useCase: 'u', scenario: 'Inner A' }).passed).toBe(false);
    });
  });

  describe('before', () => {
    it('holds when X comes before Y in every scenario that calls Y', () => {
      expect(check(SHOP, { kind: 'before', useCase: 'Get', first: { kind: 'cache' }, then: { kind: 'database' } })).toMatchObject({ passed: false, message: 'In "Missing", db is called (api -> db : SELECT at line 32) but any cache never is' });
      const src = SHOP.replace(/ {4}api -> db : SELECT\n {4}db --> api : none\n {4}api --> gw : 404/, '    api -> cache : GET item\n    api -> db : SELECT\n    api --> gw : 404');
      expect(check(src, { kind: 'before', useCase: 'Get', first: { kind: 'cache' }, then: { kind: 'database' } })).toMatchObject({
        passed: true,
        message: '"Get" calls any cache before any database in all 3 scenarios that call any database',
      });
    });

    it('fails when Y comes first', () => {
      const src = `
api [REST API]
cache [Redis]
db [PostgreSQL]
usecase "U" {
  api -> db : SELECT
  api -> cache : SET
}`;
      expect(check(src, { kind: 'before', useCase: 'U', first: { node: 'cache' }, then: { node: 'db' } })).toMatchObject({ passed: false, message: 'In "U", db is called (api -> db : SELECT at line 6) before cache (api -> cache : SET at line 7)' });
    });

    it('fails when no scenario calls Y', () => {
      expect(check(SHOP, { kind: 'before', useCase: 'Save', first: { node: 'db' }, then: { node: 'cache' } })).toMatchObject({ passed: false, message: '"Save" never calls cache' });
    });

    it('limits itself to one scenario', () => {
      expect(check(SHOP, { kind: 'before', useCase: 'Get', scenario: 'Miss', first: { node: 'cache' }, then: { node: 'db' } }).passed).toBe(true);
    });

    it('follows sequence order across par groups', () => {
      const src = `
api [REST API]
cache [Redis]
db [PostgreSQL]
usecase "U" {
  par {
    api -> cache : GET
    api -> db : SELECT
  }
}`;
      expect(check(src, { kind: 'before', useCase: 'U', first: { node: 'cache' }, then: { node: 'db' } }).passed).toBe(true);
      expect(check(src, { kind: 'before', useCase: 'U', first: { node: 'db' }, then: { node: 'cache' } }).passed).toBe(false);
    });
  });

  describe('writes before responding', () => {
    it('holds for a synchronous write before the entry response in every success scenario', () => {
      expect(check(SHOP, { kind: 'writesBeforeResponding', useCase: 'Save', target: { node: 'db' } })).toMatchObject({
        passed: true,
        message: '"Save" writes to db before responding',
      });
    });

    it('fails for async writes, writes after responding and missing writes', () => {
      expect(check(SHOP, { kind: 'writesBeforeResponding', useCase: 'Save', target: { node: 'q' } })).toMatchObject({
        passed: false,
        message: '"Created" writes to q only asynchronously: api ->> q : ItemCreated at line 44',
      });
      const after = `
client [Actor]
api [REST API]
db [PostgreSQL]
usecase "U" {
  client -> api : POST
  api --> client : 202
  api -> db : INSERT
}`;
      // A step after the response, sent by the entry's callee, comes after the response in sequence order.
      expect(check(after, { kind: 'writesBeforeResponding', useCase: 'U', target: { node: 'db' } }).message).toBe('"U" writes to db only after responding: api -> db : INSERT at line 8');
      // A SELECT is a read (§7.2): it does not count as writing the database.
      const reads = check(SHOP, { kind: 'writesBeforeResponding', useCase: 'Get', target: { node: 'db' } });
      expect(reads.message).toBe(
        '"Hit" never writes to db before responding; "Miss" only reads from db before responding: api -> db : SELECT at line 23 is a read; ' +
          '"Cache down" only reads from db before responding: api -> db : SELECT at line 28 is a read; ' +
          '"Missing" only reads from db before responding: api -> db : SELECT at line 32 is a read',
      );
      expect(reads.hint).toBe('Add a synchronous write (->) to db before the entry request is answered');
    });

    it('fails for a scenario filter that is an error path', () => {
      expect(check(SHOP, { kind: 'writesBeforeResponding', useCase: 'Save', scenario: 'Invalid', target: { node: 'db' } }).message).toBe(
        '"Save" has no success scenario to check',
      );
    });
  });

  describe('responds', () => {
    it('matches an exact status or a class', () => {
      expect(check(SHOP, { kind: 'responds', useCase: 'Save', status: '201' })).toMatchObject({ passed: true, message: '"Save" responds 201 in "Created"' });
      expect(check(SHOP, { kind: 'responds', useCase: 'Save', status: '4xx' })).toMatchObject({ passed: true, message: '"Save" responds 400 in "Invalid"' });
      expect(check(SHOP, { kind: 'responds', useCase: 'Save', status: '409' })).toMatchObject({ passed: false, message: '"Save" never responds 409; it answers 201, 400' });
      expect(check(SHOP, { kind: 'responds', useCase: 'Save', status: '5xx' }).passed).toBe(false);
    });

    it('honours the scenario filter', () => {
      expect(check(SHOP, { kind: 'responds', useCase: 'Save', scenario: 'Invalid', status: '201' }).passed).toBe(false);
    });
  });

  describe('has scenario', () => {
    it('checks that the scenario exists', () => {
      expect(check(SHOP, { kind: 'hasScenario', useCase: 'Get', scenario: 'Cache down' })).toMatchObject({ passed: true, message: '"Get" has scenario "Cache down"' });
      const r = check(SHOP, { kind: 'hasScenario', useCase: 'Save', scenario: 'Duplicate' });
      expect(r).toMatchObject({ passed: false, message: '"Save" has no scenario "Duplicate"; it has "Created", "Invalid"' });
      expect(r.hint).toBe('Add alt "Duplicate" { … } to "Save"');
    });
  });

  describe('handles failure', () => {
    it('holds when a success scenario contains a failed call to the node', () => {
      expect(check(SHOP, { kind: 'handlesFailure', useCase: 'Get', target: { kind: 'cache' } })).toMatchObject({
        passed: true,
        message: '"Get" handles a failed call to any cache in "Cache down"',
      });
      expect(check(SHOP, { kind: 'handlesFailure', useCase: 'Get', target: { node: 'db' } })).toMatchObject({
        passed: false,
        message: 'No success scenario of "Get" has a failed call to db',
      });
    });
  });

  describe('no path', () => {
    it('allows chains through other nodes but not a direct connection', () => {
      expect(check(SHOP, { kind: 'noPath', from: { kind: 'client' }, to: { kind: 'database' } })).toMatchObject({
        passed: true,
        message: 'No connection or step goes directly from any client to any database',
      });
      const direct = `${SHOP}\nclient -> db`;
      const line = direct.split('\n').indexOf('client -> db') + 1;
      const r = check(direct, { kind: 'noPath', from: { kind: 'client' }, to: { kind: 'database' } });
      expect(r).toMatchObject({ passed: false, message: `The connection client -> db (line ${line}) goes directly from any client to any database` });
      expect(r.hint).toContain('Route it through');
    });

    it('takes the connection direction as written', () => {
      expect(check(SHOP, { kind: 'noPath', from: { node: 'api' }, to: { node: 'gw' } }).passed).toBe(true);
      expect(check(SHOP, { kind: 'noPath', from: { node: 'gw' }, to: { node: 'api' } }).message).toMatch(/^The connection gw -> api \(line \d+\)/);
    });

    it('fails for a use case step that goes directly', () => {
      const src = `
client [Actor]
api [REST API]
db [PostgreSQL]
usecase "Peek" {
  client -> api : GET
  alt "Direct" {
    client -> db : SELECT
  } alt "Proper" {
    api -> db : SELECT
  }
}`;
      expect(check(src, { kind: 'noPath', from: { node: 'client' }, to: { kind: 'database' } }).message).toBe(
        'The step client -> db in "Peek" scenario "Direct" (line 8) goes directly from client to any database',
      );
    });

    it('holds when a selector matches nothing', () => {
      expect(check(SHOP, { kind: 'noPath', from: { kind: 'search' }, to: { node: 'db' } }).passed).toBe(true);
    });
  });

  describe('replicas', () => {
    it('requires every matching node to have the minimum', () => {
      expect(check(SHOP, { kind: 'replicas', target: { node: 'api' }, min: 2 }, { replicas: { api: 3 } })).toMatchObject({ passed: true, message: 'api has 3 replicas (minimum 2)' });
      const r = check(SHOP, { kind: 'replicas', target: { kind: 'service' }, min: 2 });
      expect(r).toMatchObject({ passed: false, message: 'api has 1 replica (minimum 2)', hint: 'Declare api with x2' });
    });
  });

  it('passes a block only when every assertion holds, and reports each one', () => {
    const [result] = runTests(
      diagramOf(SHOP, {
        tests: [
          {
            name: 'Cache first',
            loc: at(50),
            assertions: [
              { kind: 'calls', useCase: 'Get', target: { kind: 'cache' }, quantifier: 'some', loc: at(51) },
              { kind: 'responds', useCase: 'Save', status: '409', loc: at(52) },
              { kind: 'hasScenario', useCase: 'Save', scenario: 'Dup', loc: at(53) },
            ],
          },
        ],
      }),
    );
    expect(result).toMatchObject({ id: 'test:Cache first', passed: false, loc: at(50) });
    expect(result.message).toBe('"Save" never responds 409; it answers 201, 400; "Save" has no scenario "Dup"; it has "Created", "Invalid"');
    expect(result.hint).toBe('Add a scenario (alt) whose entry request is answered with 409');
    expect(result.assertions!.map((a) => [a.passed, a.loc.line])).toEqual([
      [true, 51],
      [false, 52],
      [false, 53],
    ]);
    const [ok] = runTests(
      diagramOf(SHOP, { tests: [{ name: 'ok', assertions: [{ kind: 'calls', useCase: 'Get', target: { kind: 'cache' }, quantifier: 'some' }, { kind: 'hasScenario', useCase: 'Get', scenario: 'Hit' }] }] }),
    );
    expect(ok).toMatchObject({ passed: true, message: 'All 2 assertions hold' });
  });
});
