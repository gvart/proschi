import { describe, expect, it } from 'vitest';
import { parse } from '../../dsl';
import { firstMatch, paletteGroups, typeChoices } from './paletteGroups';

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

  it('adds the entry named like the search on Enter, whatever its group', () => {
    expect(firstMatch(paletteGroups('redis'), 'redis')?.techStack).toBe('Redis');
    expect(firstMatch(paletteGroups('cache'), 'cache')?.techStack).toBe('Cache');
    expect(firstMatch(paletteGroups('rest api'), 'rest api')?.techStack).toBe('REST API');
    expect(firstMatch(paletteGroups('postgres'), 'postgres')?.techStack).toBe('PostgreSQL');
    expect(firstMatch(paletteGroups('no such thing'), 'no such thing')).toBeUndefined();
  });
});

describe('typeChoices', () => {
  const { diagram } = parse('type OrdersDb extends PostgreSQL {\n  doc "Orders and their lines"\n  op read listOrders\n}\ntype abstract Store extends Database {}\ndb [OrdersDb]\n');

  it("lists the document's own types first, then the catalog grouped as the palette groups it", () => {
    const groups = typeChoices(diagram.types ?? []);
    expect(groups[0]).toEqual({ id: 'design', label: 'In this design', choices: [{ name: 'OrdersDb', icon: 'PostgreSQL', doc: 'Orders and their lines' }] });
    expect(groups.slice(1).map((g) => g.label)).toEqual(paletteGroups().map((g) => g.label));
    expect(groups.find((g) => g.id === 'data')?.choices.find((c) => c.name === 'PostgreSQL')?.doc).toBeTruthy();
  });

  it('searches both, and leaves abstract types out', () => {
    expect(typeChoices(diagram.types ?? [], 'orders')[0].choices.map((c) => c.name)).toEqual(['OrdersDb']);
    expect(typeChoices(diagram.types ?? [], 'store').some((g) => g.id === 'design')).toBe(false);
    expect(typeChoices([], 'redis').find((g) => g.id === 'caches')?.choices[0].name).toBe('Redis');
  });
});
