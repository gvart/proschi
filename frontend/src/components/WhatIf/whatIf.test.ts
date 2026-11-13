import { describe, expect, it } from 'vitest';
import { parse } from '../../dsl/parser';
import { formatMultiplier, isActive, liveChanges, liveOptions, MULTIPLIERS, NO_WHATIF, stopOf, toggleFailed, totalRps, whatIfLabel } from './whatIf';

const { diagram } = parse(`client [Actor]
api [REST API]
cache [Redis]
db [PostgreSQL]
usecase "Read" {
  client -> api
  api -> cache
}
usecase "Write" {
  client -> api
  api -> db
}
usecase "Idle" {
  client -> api
}
traffic {
  "Read" 100k rps
  "Write" 2k rps
}
whatif "Black Friday" {
  traffic "Read" x3
  fail cache
}
`);
const read = diagram.useCases[0].id;
const write = diagram.useCases[1].id;

describe('the live what-if', () => {
  it('changes nothing as it starts', () => {
    expect(isActive(NO_WHATIF)).toBe(false);
    expect(liveOptions(diagram, NO_WHATIF)).toBeUndefined();
    expect(whatIfLabel(diagram, NO_WHATIF)).toBe('As written');
  });

  it('multiplies every use case with traffic, and takes nodes down', () => {
    const w = toggleFailed({ multiplier: 3, failed: [] }, 'cache');
    const options = liveOptions(diagram, w)!;
    expect([...options.trafficRps!]).toEqual([
      [read, 300_000],
      [write, 6000],
    ]);
    expect([...options.failed!]).toEqual(['cache']);
    expect(whatIfLabel(diagram, w)).toBe('Traffic ×3, cache down');
    expect(liveChanges(diagram, w)).toEqual({
      traffic: [
        { useCase: 'Read', multiply: 3 },
        { useCase: 'Write', multiply: 3 },
      ],
      fail: ['cache'],
    });
    expect(toggleFailed(w, 'cache').failed).toEqual([]);
  });

  it('forgets nodes that are gone', () => {
    const w = { multiplier: 1, failed: ['gone', 'db'] };
    expect([...liveOptions(diagram, w)!.failed!]).toEqual(['db']);
    expect(whatIfLabel(diagram, w)).toBe('db down');
    expect(liveOptions(diagram, { multiplier: 1, failed: ['gone'] })).toBeUndefined();
  });

  it('previews a saved block, and none once it is gone', () => {
    const options = liveOptions(diagram, { ...NO_WHATIF, saved: 'Black Friday' })!;
    expect(options.trafficRps?.get(read)).toBe(300_000);
    expect([...options.failed!]).toEqual(['cache']);
    expect(liveOptions(diagram, { ...NO_WHATIF, saved: 'Gone' })).toBeUndefined();
    expect(whatIfLabel(diagram, { ...NO_WHATIF, saved: 'Black Friday' })).toBe('Black Friday');
  });

  it('steps the slider from ×0.5 to ×10 and formats it', () => {
    expect(MULTIPLIERS[0]).toBe(0.5);
    expect(MULTIPLIERS[MULTIPLIERS.length - 1]).toBe(10);
    expect(MULTIPLIERS[stopOf(1)]).toBe(1);
    expect(MULTIPLIERS[stopOf(2.9)]).toBe(3);
    expect([formatMultiplier(3), formatMultiplier(0.75), formatMultiplier(7.5)]).toEqual(['×3.0', '×0.75', '×7.5']);
    expect(totalRps(diagram)).toBe(102_000);
  });
});
