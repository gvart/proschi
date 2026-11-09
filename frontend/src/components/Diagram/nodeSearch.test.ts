import { describe, expect, it } from 'vitest';
import { findNodes } from './nodeSearch';

const items = [
  { id: 'db', name: 'Orders DB', tech: 'PostgreSQL' },
  { id: 'api', name: 'API', tech: 'REST API' },
  { id: 'cache', name: 'Session cache', tech: 'Redis' },
  { id: 'web', name: 'Web app' },
];

const ids = (query: string) => findNodes(items, query).map((i) => i.id);

describe('findNodes', () => {
  it('lists every node by name for an empty query', () => {
    expect(ids(' ')).toEqual(['api', 'db', 'cache', 'web']);
  });

  it('ranks a whole or leading match above one inside a word', () => {
    expect(ids('api')).toEqual(['api']);
    expect(ids('ca')).toEqual(['cache']);
    expect(ids('o')[0]).toBe('db');
  });

  it('finds by id, tech and letters in order', () => {
    expect(ids('redis')).toEqual(['cache']);
    expect(ids('postgres')).toEqual(['db']);
    expect(ids('sscch')).toEqual(['cache']);
    expect(ids('zzz')).toEqual([]);
  });
});
