import { describe, expect, it } from 'vitest';
import { addWhatIf, rateText, scaleTraffic } from './edit';
import { parse } from './parser';

const DOC = `client [Actor]
api [REST API]
cache [Redis]
usecase "Read" {
  client -> api
  api -> cache
}
usecase "Write" {
  client -> api
}
traffic {
  "Read" 100k rps # the busy one
  "Write" 1.5k rps
}
`;

describe('addWhatIf', () => {
  it('appends a block with traffic multipliers, fractional ones too, and nodes down', () => {
    const { source, name } = addWhatIf(DOC, 'Traffic ×3', { traffic: [{ useCase: 'Read', multiply: 3 }, { useCase: 'Write', multiply: 0.75 }], fail: ['cache'] });
    expect(name).toBe('Traffic ×3');
    expect(source).toBe(`${DOC}\nwhatif "Traffic ×3" {\n  traffic "Read" x3\n  traffic "Write" x0.75\n  fail cache\n}\n`);
    const { diagram, diagnostics } = parse(source);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(diagram.whatifs?.[0].changes.map((c) => c.kind)).toEqual(['traffic', 'traffic', 'fail']);
    expect(diagram.whatifs?.[0].changes[1]).toMatchObject({ multiply: 0.75 });
  });

  it('gives a taken name a number', () => {
    const once = addWhatIf(DOC, 'cache down', { fail: ['cache'] }).source;
    const twice = addWhatIf(once, 'cache down', { fail: ['cache'] });
    expect(twice.name).toBe('cache down (2)');
    expect(addWhatIf(twice.source, 'cache down', { fail: ['cache'] }).name).toBe('cache down (3)');
  });

  it('writes into an empty document', () => {
    expect(addWhatIf('', 'W', { fail: ['a'] }).source).toBe('whatif "W" {\n  fail a\n}\n');
  });
});

describe('scaleTraffic', () => {
  it('multiplies every rate in place, keeping comments', () => {
    const scaled = scaleTraffic(DOC, 3);
    expect(scaled).toContain('  "Read" 300k rps # the busy one\n');
    expect(scaled).toContain('  "Write" 4.5k rps\n');
    expect(parse(scaled).diagram.traffic?.map((t) => t.rps)).toEqual([300_000, 4500]);
  });

  it('writes fractions down and other units in rps', () => {
    expect(parse(scaleTraffic(DOC, 0.5)).diagram.traffic?.map((t) => t.rps)).toEqual([50_000, 750]);
    const perMinute = 'a -> b\nusecase "U" {\n  a -> b\n}\ntraffic {\n  "U" 600 rpm\n}\n';
    expect(scaleTraffic(perMinute, 2)).toContain('"U" 20 rps');
  });

  it('formats rates', () => {
    expect([rateText(40), rateText(1500), rateText(300_000), rateText(1_250_000), rateText(0.5)]).toEqual(['40 rps', '1.5k rps', '300k rps', '1.25m rps', '0.5 rps']);
  });
});
