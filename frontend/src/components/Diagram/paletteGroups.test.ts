import { describe, expect, it } from 'vitest';
import { paletteGroups } from './paletteGroups';

const techs = (id: string, query?: string) => paletteGroups(query).find((g) => g.id === id)?.entries.map((e) => e.techStack) ?? [];

describe('paletteGroups', () => {
  it('groups the catalog by what a component does, generic ones first', () => {
    expect(paletteGroups().map((g) => g.label)).toEqual(['Clients', 'Edge & CDN', 'Compute & APIs', 'Data stores', 'Caches', 'Queues & streams', 'External', 'Shapes & notes']);
    expect(techs('clients')).toEqual(['Actor', 'Browser', 'Mobile App']);
    expect(techs('data').slice(0, 2)).toEqual(['Database', 'NoSQL Database']);
    expect(techs('data')).toContain('PostgreSQL');
    expect(techs('caches')[0]).toBe('Cache');
    expect(techs('caches')).toContain('Redis');
    expect(techs('queues')).toContain('Kafka');
    expect(techs('edge')).toEqual(expect.arrayContaining(['CDN', 'Load Balancer', 'API Gateway']));
    expect(techs('shapes')).toEqual(expect.arrayContaining(['Rectangle', 'Note']));
  });

  it('leaves groups out: they need a block in the text', () => {
    expect(paletteGroups().flatMap((g) => g.entries).some((e) => e.type === 'group')).toBe(false);
  });

  it('searches names, terms and aliases, every word', () => {
    expect(techs('caches', 'redis')[0]).toBe('Redis');
    expect(techs('caches', 'redis')).toContain('AWS ElastiCache');
    expect(paletteGroups('postgres').flatMap((g) => g.entries.map((e) => e.techStack))).toContain('PostgreSQL');
    expect(paletteGroups('no such thing')).toEqual([]);
  });
});
