import { describe, expect, it } from 'vitest';
import { parse } from '../dsl/parser';
import { analyze } from './analyze';
import { analysisOverlay, bottlenecksOf, busiestOf, criticalPathOf, edgeOverlays } from './overlay';

const source = `
user [Actor]
api [REST API] x2
db [PostgreSQL]
mail [Message Queue]
user -> api
api -> db
api -> mail

usecase "Buy" {
  user -> api : POST /buy
  api -> db : insert
  api ->> mail : receipt
}

traffic {
  "Buy" 800 rps
}

capacity {
  db 1000 rps shards 2
}
`;

describe('analysisOverlay under a what-if', () => {
  const diagram = parse(source).diagram;
  const buy = diagram.useCases[0].id;

  it('carries the analysed rates, not the traffic block', () => {
    const overlay = analysisOverlay(diagram, analyze(diagram, { trafficRps: new Map([[buy, 2400]]) }));
    expect(overlay.flows.find((f) => f.from === 'user' && f.to === 'api')?.rps).toBe(2400);
    expect(overlay.nodes.db.saturated).toBe(true);
    expect(overlay.nodes.db.bottleneck).toBe(true);
  });

  it('marks failed nodes down and drops the flows to them', () => {
    const overlay = analysisOverlay(diagram, analyze(diagram, { failed: new Set(['mail']) }));
    expect(overlay.nodes.mail.down).toBe(true);
    expect(overlay.nodes.db.down).toBeUndefined();
    expect(overlay.flows.some((f) => f.to === 'mail')).toBe(false);
    expect(overlay.flows.find((f) => f.to === 'db')?.rps).toBe(800);
  });
});

describe('analysisOverlay', () => {
  const diagram = parse(source).diagram;
  const overlay = analysisOverlay(diagram, analyze(diagram));

  it('gives working nodes their utilisation, replicas and shards', () => {
    expect(overlay.nodes.api.replicas).toBe(2);
    expect(overlay.nodes.db.shards).toBe(2);
    expect(overlay.nodes.db.utilization).toBeGreaterThan(0);
    expect(overlay.nodes.user.utilization).toBeUndefined();
  });

  it('sums the flows of the traffic, async ones marked', () => {
    expect(overlay.flows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 'user', to: 'api', rps: 800, async: false }),
        expect.objectContaining({ from: 'api', to: 'db', rps: 800, async: false }),
        expect.objectContaining({ from: 'api', to: 'mail', rps: 800, async: true }),
      ]),
    );
  });
});

const busy = `
user [Actor]
api [REST API]
cache [Redis]
db [PostgreSQL]
user -> api
api -> cache
api -> db
db -> api

usecase "Read" {
  user -> api : GET
  api -> cache : get
}

usecase "Write" {
  user -> api : POST
  api -> db : insert
}

traffic {
  "Read" 900 rps
  "Write" 100 rps
}

capacity {
  api 1000 rps
  db 120 rps
}
`;

describe('overlay of a busier design', () => {
  const diagram = parse(busy).diagram;
  const analysis = analyze(diagram);
  const overlay = analysisOverlay(diagram, analysis);

  it('gives each flow the latency its target adds', () => {
    const api = analysis.nodes.find((n) => n.id === 'api')!;
    const flow = overlay.flows.find((f) => f.from === 'user' && f.to === 'api')!;
    expect(flow.latencyMs).toBeCloseTo(api.latencyMs);
  });

  it('marks nodes at 70% or more as bottlenecks', () => {
    // api runs at 100% of 1000 rps; db at 100 of 120 rps (83%).
    expect(bottlenecksOf(analysis).sort()).toEqual(['api', 'db']);
    expect(overlay.nodes.api.bottleneck).toBe(true);
    expect(overlay.nodes.cache.bottleneck).toBeUndefined();
  });

  it('marks nothing while every node has room, but still names the busiest', () => {
    const calm = parse(busy.replace('api 1000 rps', 'api 2000 rps').replace('db 120 rps', 'db 1000 rps')).diagram;
    const a = analyze(calm);
    expect(bottlenecksOf(a)).toEqual([]);
    expect(analysisOverlay(calm, a).nodes.api.bottleneck).toBeUndefined();
    expect(busiestOf(a)?.id).toBe('api');
    expect(busiestOf(a)!.utilization).toBeCloseTo(0.5);
  });

  it('has no bottleneck without load', () => {
    const idle = parse(busy.replace(/traffic \{[^}]*\}/, '')).diagram;
    expect(bottlenecksOf(analyze(idle))).toEqual([]);
    expect(busiestOf(analyze(idle))).toBeUndefined();
    expect(analysisOverlay(idle, analyze(idle)).critical).toBeUndefined();
  });

  it('draws the p99 path of the busiest use case, or of the one picked', () => {
    expect(overlay.critical).toMatchObject({ useCase: 'Read', nodes: ['user', 'api', 'cache'] });
    expect(overlay.critical!.p99Ms).toBeCloseTo(analysis.useCases.find((u) => u.name === 'Read')!.percentiles.p99);
    const write = criticalPathOf(diagram, analysis, 'Write')!;
    expect(write.links).toEqual([
      { from: 'user', to: 'api' },
      { from: 'api', to: 'db' },
    ]);
    // An unknown pick falls back to the busiest.
    expect(criticalPathOf(diagram, analysis, 'nope')!.useCase).toBe('Read');
  });

  it('sums the flows on each edge in both directions and tints it by its target', () => {
    const edges = edgeOverlays(diagram.edges, overlay);
    const byPair = (s: string, t: string) => edges[diagram.edges.find((e) => e.source === s && e.target === t)!.id];
    expect(byPair('user', 'api')).toMatchObject({ rps: 1000, async: false, critical: true, saturated: true });
    expect(byPair('user', 'api').utilization).toBeCloseTo(1);
    expect(byPair('api', 'cache')).toMatchObject({ rps: 900, critical: true });
    expect(byPair('api', 'db')).toMatchObject({ rps: 100 });
    expect(byPair('api', 'db').critical).toBeUndefined();
    expect(byPair('api', 'db').latencyMs).toBeCloseTo(analysis.nodes.find((n) => n.id === 'db')!.latencyMs);
    // The reverse edge carries the same requests, matched the other way round.
    expect(byPair('db', 'api')).toMatchObject({ rps: 100 });
  });

  it('leaves out edges that carry nothing', () => {
    const quiet = parse(busy.replace('"Write" 100 rps', '')).diagram;
    const edges = edgeOverlays(quiet.edges, analysisOverlay(quiet, analyze(quiet)));
    const db = quiet.edges.find((e) => e.source === 'api' && e.target === 'db')!;
    expect(edges[db.id]).toBeUndefined();
  });
});
