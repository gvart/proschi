import { describe, expect, it } from 'vitest';
import { parse } from '../../dsl';
import { addComponent, addStarter, idFromName, isGeneratedId, nameNode, namedElsewhere, STARTERS } from './addFlow';

describe('addComponent', () => {
  it('builds a chain, each connection labelled with its target type’s protocol', () => {
    let source = '';
    let from: string | undefined;
    for (const tech of ['Actor', 'REST API', 'PostgreSQL']) {
      const result = addComponent(source, tech, { from });
      source = result.source;
      from = result.id;
    }
    expect(source).toBe('actor "Actor" [Actor]\nrest_api "REST API" [REST API]\nactor -> rest_api : HTTP\npostgresql "PostgreSQL" [PostgreSQL]\nrest_api -> postgresql : SQL\n');
  });

  it('adds alone without a selection, and numbers a second of a kind', () => {
    const first = addComponent('', 'Redis');
    expect(addComponent(first.source, 'Redis').id).toBe('redis2');
  });
});

describe('nameNode', () => {
  const source = 'rest_api "REST API" [REST API]\napi "API" [REST API]\nclient -> rest_api : HTTP\n';

  it('renames a generated id after the name, everywhere', () => {
    expect(nameNode(source, 'rest_api', 'Orders API')).toEqual({ source: 'orders_api "Orders API" [REST API]\napi "API" [REST API]\nclient -> orders_api : HTTP\n', id: 'orders_api' });
  });

  it('never touches an id the reader typed', () => {
    expect(nameNode(source, 'api', 'Orders API')).toEqual({ source: source.replace('"API"', '"Orders API"'), id: 'api' });
  });

  it('keeps the id when told to, or when the name gives the same id; does nothing for the same name', () => {
    expect(nameNode(source, 'rest_api', 'Orders', { keepId: true }).id).toBe('rest_api');
    expect(nameNode(source, 'rest_api', 'Rest API').id).toBe('rest_api');
    expect(nameNode(source, 'rest_api', 'REST API').source).toBe(source);
    expect(nameNode(source, 'rest_api', '  ').source).toBe(source);
  });

  it('numbers an id another node has', () => {
    expect(nameNode(source, 'rest_api', 'Api').id).toBe('api2');
  });
});

describe('ids', () => {
  it('tell a generated id from a typed one', () => {
    expect(idFromName('Orders API')).toBe('orders_api');
    expect(isGeneratedId('postgresql2', 'PostgreSQL')).toBe(true);
    expect(isGeneratedId('db', 'PostgreSQL')).toBe(false);
    expect(isGeneratedId('postgresql_x', 'PostgreSQL')).toBe(false);
  });

  it('know when an imported file names an id', () => {
    const { diagram } = parse('import "given.proschi"\nredis [Redis]\npg [PostgreSQL]\n', { resolve: (path) => (path === 'given.proschi' ? { path, source: 'client -> redis\n' } : undefined) });
    expect(namedElsewhere(diagram, 'redis')).toBe(true);
    expect(namedElsewhere(diagram, 'pg')).toBe(false);
  });
});

describe('STARTERS', () => {
  it.each(STARTERS.map((s) => [s.label, s] as const))('%s writes a clean design', (_label, starter) => {
    const { diagram, diagnostics } = parse(addStarter('', starter));
    expect(diagnostics).toEqual([]);
    expect(diagram.nodes).toHaveLength(starter.parts.length);
    expect(diagram.edges).toHaveLength(starter.parts.filter((p) => p.from !== undefined).length);
  });
});
