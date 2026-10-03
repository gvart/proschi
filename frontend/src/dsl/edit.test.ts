import { describe, expect, it } from 'vitest';
import { addConnection, clearPositions, renameNode, setNodePosition } from './edit';
import { parse } from './parser';

describe('setNodePosition', () => {
  it('adds pos to a node, keeping a trailing comment', () => {
    expect(setNodePosition('api "API" [REST API] # entry\ndb', 'api', { x: 10.4, y: -20.6 })).toBe(
      'api "API" [REST API] pos 10,-21 # entry\ndb'
    );
  });

  it('replaces an existing pos', () => {
    expect(setNodePosition('api pos 1,2 @team', 'api', { x: 30, y: 40 })).toBe('api pos 30,40 @team');
  });

  it('puts group positions before the brace', () => {
    const src = 'group vpc "VPC" {\n  a\n}';
    const moved = setNodePosition(src, 'vpc', { x: 5, y: 6 });
    expect(moved).toBe('group vpc "VPC" pos 5,6 {\n  a\n}');
    expect(setNodePosition(moved, 'vpc', { x: 7, y: 8 })).toBe('group vpc "VPC" pos 7,8 {\n  a\n}');
    expect(parse(moved).diagram.nodes[0].position).toEqual({ x: 5, y: 6 });
  });

  it('edits indented nodes inside groups', () => {
    expect(setNodePosition('group g {\n  svc [Redis]\n}', 'svc', { x: 1, y: 2 })).toBe('group g {\n  svc [Redis] pos 1,2\n}');
  });

  it('declares implicit nodes before the first use case', () => {
    const src = 'a -> b\n\nusecase U {\n  a -> b\n}\n';
    const result = setNodePosition(src, 'b', { x: 3, y: 4 });
    expect(result).toBe('a -> b\nb pos 3,4\n\nusecase U {\n  a -> b\n}\n');
    expect(parse(result).diagnostics).toEqual([]);
  });

  it('appends implicit nodes when there is no use case', () => {
    expect(setNodePosition('a -> b', 'b', { x: 0, y: 0 })).toBe('a -> b\nb pos 0,0\n');
  });
});

describe('renameNode', () => {
  it('replaces the display name', () => {
    expect(renameNode('api "Old" [REST API]', 'api', 'New name')).toBe('api "New name" [REST API]');
  });

  it('adds a name when there is none', () => {
    expect(renameNode('api [REST API]', 'api', 'Gateway')).toBe('api "Gateway" [REST API]');
    expect(renameNode('group g {\n}', 'g', 'Zone')).toBe('group g "Zone" {\n}');
  });

  it('escapes quotes and ignores empty names', () => {
    const renamed = renameNode('api', 'api', 'Say "hi"');
    expect(renamed).toBe('api "Say \\"hi\\""');
    expect(parse(renamed).diagram.nodes[0].name).toBe('Say "hi"');
    expect(renameNode('api', 'api', '   ')).toBe('api');
  });

  it('declares implicit nodes', () => {
    expect(renameNode('a -> b', 'b', 'Bee')).toBe('a -> b\nb "Bee"\n');
  });
});

describe('addConnection', () => {
  it('adds a connection once', () => {
    const once = addConnection('a\nb\n', 'a', 'b');
    expect(once).toBe('a\nb\na -> b\n');
    expect(addConnection(once, 'a', 'b')).toBe(once);
    expect(addConnection(once, 'a', 'a')).toBe(once);
  });

  it('keeps use cases last', () => {
    expect(addConnection('a\nusecase U {\n}', 'a', 'b')).toBe('a\na -> b\nusecase U {\n}');
  });
});

describe('clearPositions', () => {
  it('removes every pos and nothing else', () => {
    const src = 'group g "G" pos 1,2 {\n  a [Redis] pos 3,4 @t # c\n}\nb pos 5,6\nb -> a : pos 9,9';
    const cleared = clearPositions(src);
    expect(cleared).toBe('group g "G" {\n  a [Redis] @t # c\n}\nb\nb -> a : pos 9,9');
    expect(parse(cleared).diagram.nodes.every((n) => !n.position)).toBe(true);
  });
});
