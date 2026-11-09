import { describe, expect, it } from 'vitest';
import { parse } from '../dsl/parser';
import { analyze } from './analyze';
import { runWhatIfs } from './whatif';

const aside = (extra = '') => `
user  [Browser]
api   [REST API] x4
cache [Redis]
db    [PostgreSQL]
user -> api
api -> cache
api -> db
usecase "Read" {
  user -> api : GET /item
  api -> cache : GET item
  api -> db : SELECT item
  api -> cache : SET item
  api --> user : 200
}
traffic {
  "Read" 1k rps
}
${extra}`;

const loads = (source: string) => {
  const { diagram, diagnostics } = parse(source);
  const analysis = analyze(diagram);
  return { diagnostics, diagram, load: Object.fromEntries(analysis.nodes.map((n) => [n.id, n.loadRps])) };
};

describe('cache hit rate', () => {
  it('parses hit in capacity and in a what-if', () => {
    const { diagram, diagnostics } = parse(aside('capacity {\n  cache hit 90%\n}\nwhatif "Cold cache" {\n  cache hit 40%\n}'));
    expect(diagnostics).toEqual([]);
    expect(diagram.capacity![0]).toMatchObject({ node: 'cache', hitPercent: 90 });
    expect(diagram.whatifs![0].changes).toMatchObject([{ kind: 'hit', node: 'cache', percent: 40 }]);
  });

  it('rejects a hit rate over 100% and warns on a node that is not a cache', () => {
    const messages = (capacity: string) => parse(aside(`capacity {\n  ${capacity}\n}`)).diagnostics.map((d) => [d.severity, d.message]);
    expect(messages('cache hit 120%')).toEqual([['error', 'A hit rate cannot be more than 100%']]);
    expect(messages('db hit 50%')).toEqual([['warning', "'db' is not a cache or CDN; a hit rate only means something for one"]]);
  });

  it('takes (1 − hit) of the rate on the cache-aside miss path', () => {
    const plain = loads(aside());
    const hit = loads(aside('capacity {\n  cache hit 90%\n}'));
    expect(plain.load.db).toBe(1000);
    expect(hit.load.db).toBeCloseTo(100, 9);
    // The lookup and the API are unchanged; the cache fill is a write, not a backing store read.
    expect(hit.load.api).toBe(1000);
    expect(hit.load.cache).toBe(plain.load.cache);
  });

  it('follows a read-through cache and a CDN origin fetch, and multiplies two caches', () => {
    const through = loads(`
user [Browser]
cdn  [CloudFront]
api  [REST API] x4
cache [Redis]
db   [PostgreSQL]
user -> cdn
cdn -> api
api -> cache
cache -> db
usecase "Read" {
  user -> cdn : GET /page
  cdn -> api : GET /page
  api -> cache : GET page
  cache -> db : SELECT page
}
traffic {
  "Read" 1k rps
}
capacity {
  cdn hit 80%
  cache hit 50%
}`);
    expect(through.diagnostics).toEqual([]);
    expect(through.load.cdn).toBe(1000);
    expect(through.load.api).toBeCloseTo(200, 9);
    expect(through.load.cache).toBeCloseTo(200, 9);
    expect(through.load.db).toBeCloseTo(100, 9);
  });

  it('leaves a use case with a traffic mix to its mix, and says so', () => {
    const mixed = aside('capacity {\n  cache hit 90%\n}').replace('"Read" 1k rps', '"Read" 1k rps mix "Read" 100%');
    const { diagnostics, load } = loads(mixed);
    expect(diagnostics.map((d) => [d.severity, d.message])).toEqual([
      ['info', `"Read" splits its traffic into scenarios with mix, so its mix decides the hits and misses of 'cache', not the 90% hit rate`],
    ]);
    expect(load.db).toBe(1000);
  });

  it('applies a what-if hit rate: a cold cache sends more to the database', () => {
    const { diagram } = parse(aside('capacity {\n  cache hit 90%\n}\nwhatif "Cold cache" {\n  cache hit 40%\n}'));
    const [cold] = runWhatIfs(diagram);
    expect(cold.analysis.nodes.find((n) => n.id === 'db')!.loadRps).toBeCloseTo(600, 9);
    expect(cold.options.hitRates).toEqual(new Map([['cache', 40]]));
  });
});
