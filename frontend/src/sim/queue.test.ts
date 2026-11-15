import { describe, expect, it } from 'vitest';
import { parse } from '../dsl/parser';
import { format } from '../dsl/format';
import { diffDiagrams } from '../dsl/diff';
import { analyze, queueOf } from './analyze';
import { formatCount, formatDuration } from './format';
import { analysisOverlay } from './overlay';
import { runTests } from './tests';
import { loadHintsOf } from '../components/Playground/loadHints';

const orders = (extra = '', rps = '4k rps') => `
user   [Browser]
api    [REST API] x4
events [Kafka] x3
worker [Worker] x3
user -> api
api -> events
events -> worker
usecase "Place order" {
  user -> api : POST /orders
  api ->> events : publish order
  api --> user : 202
  events ->> worker : order placed
}
traffic {
  "Place order" ${rps}
}
${extra}`;

const run = (source: string) => {
  const { diagram, diagnostics } = parse(source);
  const analysis = analyze(diagram);
  return { diagram, diagnostics, analysis, events: analysis.nodes.find((n) => n.id === 'events')! };
};

describe('queue backlog and lag', () => {
  it('parses drain in capacity and lag in requirements', () => {
    const { diagram, diagnostics } = parse(orders('capacity {\n  events drain 5k rps\n}\nrequirements {\n  lag "Place order" < 30s\n}'));
    expect(diagnostics).toEqual([]);
    expect(diagram.capacity![0]).toMatchObject({ node: 'events', drainRps: 5000 });
    expect(diagram.requirements![0]).toMatchObject({ kind: 'lag', useCase: 'Place order', maxMs: 30_000 });
  });

  it('warns about drain on a node that is not a queue, and needs a use case for lag', () => {
    const messages = (extra: string) => parse(orders(extra)).diagnostics.map((d) => [d.severity, d.message]);
    expect(messages('capacity {\n  api drain 5k rps\n}')).toEqual([['warning', "'api' is not a queue or broker; a drain rate only means something for one"]]);
    expect(messages('requirements {\n  lag < 30s\n}')).toEqual([['error', 'Expected a use case name in quotes, e.g. lag "Place order" < 30s']]);
    expect(messages('requirements {\n  lag "Nope" < 30s\n}').map(([, m]) => m)).toEqual([expect.stringContaining('Nope')]);
  });

  it('has a queueing delay as lag while the consumers keep up', () => {
    const q = queueOf(4000, 5000);
    expect(q).toMatchObject({ inflowRps: 4000, drainRps: 5000, utilization: 0.8, backlogPerHour: 0 });
    // ρ ÷ (μ − λ) = 0.8 ÷ 1000 s.
    expect(q.lagMs).toBeCloseTo(0.8, 12);
    expect(queueOf(0, 5000).lagMs).toBe(0);
  });

  it('grows a backlog at the difference when more flows in than drains', () => {
    const q = queueOf(6000, 5000);
    expect(q.backlogPerHour).toBe(3_600_000);
    expect(q.lagMs).toBe(Infinity);
    expect(queueOf(10, 0)).toMatchObject({ backlogPerHour: 36_000, lagMs: Infinity, utilization: Infinity });
  });

  it('analyses the queue at its inflow, and warns when it falls behind', () => {
    const keeps = run(orders('capacity {\n  events drain 5k rps\n}'));
    expect(keeps.events.queue).toMatchObject({ inflowRps: 4000, drainRps: 5000, backlogPerHour: 0 });
    expect(keeps.analysis.warnings).toEqual([]);
    const behind = run(orders('capacity {\n  events drain 3k rps\n}'));
    expect(behind.events.queue!.backlogPerHour).toBe(3_600_000);
    expect(behind.analysis.warnings).toContain(
      "'events' falls behind: 4k rps flows in and its consumers drain 3k rps, so the backlog grows by 3.6M messages an hour. Drain faster or send it less.",
    );
    expect(run(orders()).events.queue).toBeUndefined();
  });

  it('checks lag against the queues the use case sends to', () => {
    const passes = run(orders('capacity {\n  events drain 5k rps\n}\nrequirements {\n  lag "Place order" < 30s\n}'));
    expect(runTests(passes.diagram, passes.analysis)[0]).toMatchObject({
      name: 'lag of Place order < 30 s',
      category: 'latency',
      passed: true,
      message: 'Lag of "Place order" is 0.8 ms at events, its consumers 80% busy (limit 30 s)',
    });
    const behind = run(orders('capacity {\n  events drain 3k rps\n}\nrequirements {\n  lag "Place order" < 30s\n}'));
    expect(runTests(behind.diagram, behind.analysis)[0]).toMatchObject({
      passed: false,
      message: '"Place order" falls behind at events: 4k rps flows in, its consumers drain 3k rps, and the backlog grows by 3.6M messages an hour (limit 30 s)',
      hint: 'Drain events faster than 4k rps: more consumers, or capacity { events drain 5.8k rps }',
    });
    const none = run(orders('requirements {\n  lag "Place order" < 30s\n}'));
    expect(runTests(none.diagram, none.analysis)[0]).toMatchObject({
      passed: false,
      message: '"Place order" sends to no queue with a drain rate, so it has no lag to measure',
      hint: 'Say how fast its consumers take messages: capacity { events drain 1k rps }',
    });
  });

  it('shows backlog or lag on the queue in the overlay, through its utilisation', () => {
    const behind = run(orders('capacity {\n  events drain 3k rps\n}'));
    const node = analysisOverlay(behind.diagram, behind.analysis).nodes.events;
    expect(node).toMatchObject({ backlogPerHour: 3_600_000, saturated: true });
    expect(node.utilization).toBeCloseTo(4 / 3, 12);
    const keeps = run(orders('capacity {\n  events drain 5k rps\n}'));
    expect(analysisOverlay(keeps.diagram, keeps.analysis).nodes.events).toMatchObject({ lagMs: expect.closeTo(0.8, 12), utilization: 0.8, saturated: false });
  });

  it('adds the backlog or lag to the web editor\'s load hint on the queue', () => {
    const hint = (source: string) => {
      const { diagram, analysis } = run(source);
      return loadHintsOf(diagram, analysis).find((h) => h.line === diagram.nodes.find((n) => n.id === 'events')!.loc.line)!;
    };
    expect(hint(orders('capacity {\n  events drain 3k rps\n}'))).toMatchObject({ label: expect.stringMatching(/ · backlog \+3\.6M\/h$/), saturated: true });
    expect(hint(orders('capacity {\n  events drain 5k rps\n}'))).toMatchObject({ label: expect.stringMatching(/ · lag 0\.8 ms$/), saturated: false });
    expect(hint(orders()).label).not.toContain('lag');
  });

  it('formats long waits and message counts', () => {
    expect([formatDuration(450), formatDuration(12_000), formatDuration(250_000), formatDuration(9_000_000), formatDuration(Infinity)]).toEqual(['450 ms', '12 s', '4.2 min', '2.5 h', '∞']);
    expect([formatCount(950), formatCount(12_500), formatCount(3_600_000)]).toEqual(['950', '12.5k', '3.6M']);
  });

  it('keeps lag apart in a diff and formats the lines as written', () => {
    const before = parse(orders('requirements {\n  lag "Place order" < 30s\n}')).diagram;
    const after = parse(orders('requirements {\n  lag "Place order" < 10s\n}')).diagram;
    expect(diffDiagrams(before, after).requirements.changed.map((c) => c.key)).toEqual(['lag Place order']);
    expect(format(orders('capacity {\n  events   drain 5k rps\n}'))).toContain('  events drain 5k rps');
  });
});
