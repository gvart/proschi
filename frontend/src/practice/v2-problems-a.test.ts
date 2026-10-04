import { describe, expect, it } from 'vitest';
import { defaultEngine } from '../hld/engine';
import { findProblem } from './problems';
import type { Problem } from './types';
import { parseSolution, runTests } from './workspace';

/**
 * Regression tests for the v2 checks of pastebin, rate-limiter,
 * url-shortener, chat, news-feed and notification-fanout
 * (docs/design/hld-and-practice.md §7): each problem has a plausible wrong
 * design, a small edit of the reference solution, that a v2 check catches.
 */

function problem(id: string): Problem {
  const p = findProblem(id);
  if (!p) throw new Error(`No problem ${id}`);
  return p;
}

/** The reference solution with each `[from, to]` applied once; every `from` must occur. */
function variant(p: Problem, edits: [string, string][]): string {
  return edits.reduce((source, [from, to]) => {
    expect(source, `${p.id} solution contains ${JSON.stringify(from)}`).toContain(from);
    return source.replace(from, () => to);
  }, p.solution);
}

/** Names of the requirements and tests the source fails; it must parse without errors. */
function failing(p: Problem, source: string): string[] {
  const parsed = parseSolution(p, source);
  expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  const run = runTests(parsed, defaultEngine);
  expect(run.blocked).toBeUndefined();
  return run.results.filter((r) => !r.passed).map((r) => r.name);
}

describe('pastebin', () => {
  const p = problem('pastebin');

  it('a Redis cache behind the API is too slow for popular pastes and is not the CDN', () => {
    const source = variant(p, [
      ['cdn    "CDN"          [AWS CloudFront] x2', 'cdn    "Load Balancer" [AWS Load Balancer] x2'],
      ['api    "Paste API"    [REST API]       x2', 'api    "Paste API"    [REST API]       x6'],
      ['user -> cdn\n', 'cache "Paste Cache" [Redis] x2\napi -> cache\nuser -> cdn\n'],
      [
        '    cdn --> user : 200 text\n',
        '    cdn -> api : ~10KB GET /k7Qz2\n    api -> cache : ~10KB GET paste:k7Qz2\n    cache --> api : text\n    api --> cdn : 200 text\n    cdn --> user : 200 text\n',
      ],
    ]);
    expect(failing(p, source)).toEqual(['p99 of Read paste scenario Cached < 30 ms', 'Popular pastes are served by the CDN']);
  });

  it('reading every paste from object storage costs too much egress', () => {
    const source = variant(p, [
      [
        '    cdn --> user : 200 text\n',
        '    cdn -> api : ~10KB GET /k7Qz2\n    api -> meta : SELECT Paste k7Qz2\n    meta --> api : expires tomorrow\n    api -> bodies : ~10KB GET pastes/k7Qz2\n    bodies --> api : text\n    api --> cdn : 200 text\n    cdn --> user : 200 text\n',
      ],
      ['api    "Paste API"    [REST API]       x2', 'api    "Paste API"    [REST API]       x4'],
    ]);
    expect(failing(p, source)).toContain('cost ≤ $6,000/month');
  });
});

describe('rate-limiter', () => {
  const p = problem('rate-limiter');

  it('reading the counter and incrementing it after the decision is not counting', () => {
    const source = variant(p, [
      ['limiter   -> counters : INCR rate:client-42', 'limiter   -> counters : GET rate:client-42'],
      ['    limiter --> gateway : 200 allow\n', '    limiter --> gateway : 200 allow\n    limiter ->> counters : INCR rate:client-42\n'],
    ]);
    expect(failing(p, source)).toEqual(['Every call is counted before it is let through']);
  });

  it('a direct connection from the client to the Orders API bypasses the limiter', () => {
    const source = variant(p, [['client  -> gateway\n', 'client  -> gateway\nclient  -> orders\n']]);
    expect(failing(p, source)).toEqual(['Rejected calls never reach the Orders API']);
  });
});

describe('url-shortener', () => {
  const p = problem('url-shortener');

  it('a cache miss that never fills the cache', () => {
    const source = variant(p, [['    api   ->> cache : SET code:aZ3x9\n', '']]);
    expect(failing(p, source)).toEqual(['Misses fill the cache']);
  });
});

describe('chat', () => {
  const p = problem('chat');

  it('delivering before the ack holds up the sender', () => {
    const source = variant(p, [
      ['  ws       --> lb       : ACK {"id": "m_77"}\n  lb       --> sender   : ACK {"id": "m_77"}\n', ''],
      ['    ws       ->> broker    : PUBLISH gateway.ws-7 m_77\n', '    ws        -> broker    : PUBLISH gateway.ws-7 m_77\n    broker   --> ws        : ok\n'],
      [
        '    broker   ->> ws        : m_77 (on gateway ws-7)\n    ws       ->> recipient : MESSAGE m_77\n',
        '    ws        -> recipient : MESSAGE m_77\n    recipient --> ws       : delivered\n    ws --> lb : ACK {"id": "m_77"}\n    lb --> sender : ACK {"id": "m_77"}\n',
      ],
      ['    presence --> ws   : nil\n', '    presence --> ws   : nil\n    ws --> lb : ACK {"id": "m_77"}\n    lb --> sender : ACK {"id": "m_77"}\n'],
    ]);
    // Online delivery adds only a few milliseconds, so latency alone does not catch it.
    expect(failing(p, source)).toEqual(['Delivery happens after the ack']);
  });
});

describe('news-feed', () => {
  const p = problem('news-feed');

  it('fanning out inside the request waits for the graph, even with the event queued first', () => {
    const source = variant(p, [
      ['api    -> feeds     : ZREVRANGE\n', 'api    -> feeds     : ZREVRANGE\napi    -> graph     : followers\n'],
      [
        '  api    --> lb        : 201 {"id": "p_981"}\n',
        '  api     -> graph     : GET /users/7/followers\n  graph  --> api       : 200 [~200 follower ids]\n  api     -> feeds     : x200 ZADD feed:{follower} p_981\n  api    --> lb        : 201 {"id": "p_981"}\n',
      ],
    ]);
    expect(failing(p, source)).toContain('Fan-out runs behind a queue');
  });

  it('two feed cache nodes cannot take the 200x fan-out when one fails', () => {
    const source = variant(p, [['feeds     "Feed Cache"     [Redis]             x3', 'feeds     "Feed Cache"     [Redis]             x2']]);
    expect(failing(p, source)).toEqual(['survive any node failure']);
  });
});

describe('notification-fanout', () => {
  const p = problem('notification-fanout');

  it('a notifier that queues the event and then calls the provider makes the Order Service wait', () => {
    const source = variant(p, [
      ['orders -> events    : SendMessage\n', 'orders -> worker\nworker -> events\n'],
      [
        '  orders  -> events : SEND OrderShipped {"userId": 42, "orderId": 981}\n  events --> orders : 200 queued\n',
        '  orders  -> worker : OrderShipped {"userId": 42, "orderId": 981}\n  worker  -> events : SEND OrderShipped\n  events --> worker : ok\n  worker  -> email  : send "Your order is on its way"\n  email  --> worker : 202\n  worker --> orders : 202\n',
      ],
    ]);
    expect(failing(p, source)).toContain('The Order Service never waits for a provider');
  });

  it('a worker that polls the queue does not start delivery at the queue', () => {
    const source = variant(p, [
      ['events -> worker    : deliver\n', 'worker -> events    : receive\n'],
      ['  events -> worker : OrderShipped {"userId": 42, "orderId": 981}\n', '  worker  -> events : ReceiveMessage\n  events --> worker : OrderShipped {"userId": 42, "orderId": 981}\n'],
    ]);
    expect(failing(p, source)).toContain('Workers take events from the queue');
  });

  it('the SMS failover may check the primary in the background without losing the fallback', () => {
    const source = variant(p, [
      [
        '    smsBackup --> worker    : 202\n    worker    --> events    : delete\n',
        '    smsBackup --> worker    : 202\n    worker    --> events    : delete\n    worker     -> sms       : GET /messages/m_1/status\n    sms       --> worker    : 404 never sent\n',
      ],
    ]);
    expect(failing(p, source)).toEqual([]);
  });
});
