import { describe, expect, it } from 'vitest';
import listings from 'virtual:practice-listings';
import { examples, parse } from '../dsl';
import { problems } from '../practice/catalog';
import { matchesGallery, patternTags, solutionSource } from './gallery';
import { referenceSolution } from './referenceSolutions';

const tagsOf = (source: string) => patternTags(parse(source).diagram);

describe('patternTags', () => {
  it('derives patterns from node kinds, replicas, shards and flows', () => {
    expect(
      tagsOf(`title "T"
user [Actor]
cdn [CDN]
api [REST API] x3
db [PostgreSQL] x2
cache [Redis]
q [Kafka]
a [Worker]
b [Worker]
user -> cdn
cdn -> api
api -> db
api -> cache
api -> q
q -> a
q -> b
capacity {
  db shards 4
}
usecase "U" {
  user -> api : GET /x
  api ->> q : Evt
  api --> user : 429
}`),
    ).toEqual(['cache', 'CDN', 'queue', 'fan-out', 'sharding', 'replication', 'rate limiting', 'async', 'error paths']);
  });

  it('tags every example but the basic one', () => {
    for (const e of examples.filter((x) => x.id !== 'hello')) expect(tagsOf(e.source).length, e.id).toBeGreaterThan(0);
    expect(tagsOf(examples.find((e) => e.id === 'url-shortener')!.source)).toContain('HLD');
  });
});

describe('reference solutions', () => {
  it('has the given and solution of every listed problem', () => {
    expect(listings.length).toBe(problems.length);
    for (const p of listings) expect(referenceSolution(p.id), p.id).toBeDefined();
    expect(referenceSolution('nope')).toBeUndefined();
  });

  it.each(problems.map((p) => [p.id, p.title]))('opens the %s solution as one document without errors', (id, title) => {
    const files = referenceSolution(id)!;
    const source = solutionSource(files.given, files.solution, title);
    const { diagram, diagnostics } = parse(source);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(diagram.title).toBe(`${title}: reference solution`);
    expect(source).not.toContain('import "problem.proschi"');
    expect(diagram.useCases.length).toBeGreaterThan(0);
    expect(patternTags(diagram).length).toBeGreaterThan(0);
  });
});

describe('matchesGallery', () => {
  const item = { id: 'x', title: 'News feed', description: 'Fan out posts', tags: ['cache', 'queue'], keywords: 'Redis Kafka' };
  it('matches every word anywhere, and the selected tag', () => {
    expect(matchesGallery(item, '')).toBe(true);
    expect(matchesGallery(item, 'feed kafka')).toBe(true);
    expect(matchesGallery(item, 'feed postgres')).toBe(false);
    expect(matchesGallery(item, '', 'queue')).toBe(true);
    expect(matchesGallery(item, '', 'CDN')).toBe(false);
  });
});
