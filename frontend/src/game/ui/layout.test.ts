import { describe, expect, it } from 'vitest';
import { gameContent } from '../content';
import { layoutBoard, placeComponent, pointOn, removeNode, toggleWire } from './layout';

const { content } = gameContent();
const components = new Map(content.components.map((c) => [c.id, c]));
const shortly = content.scenarios.find((s) => s.id === 'shortly')!;
const ping = content.scenarios.find((s) => s.id === 'ping')!;
const ctx = { components, scenario: shortly };

describe('board edits', () => {
  it('puts a load balancer in front of what Users called, and taking it out wires Users back', () => {
    const { board, id } = placeComponent(shortly.start.board, 'lb', ctx);
    expect(id).toBe('lb');
    expect(board.edges).toContainEqual(['users', 'lb']);
    expect(board.edges).toContainEqual(['lb', 'api']);
    expect(board.edges).not.toContainEqual(['users', 'api']);
    expect(removeNode(board, 'lb', ctx).edges).toContainEqual(['users', 'api']);
  });

  it('wires a second app server like the first, and a cache from every app server', () => {
    const withLb = placeComponent(shortly.start.board, 'lb', ctx).board;
    const { board, id } = placeComponent(withLb, 'app', ctx);
    expect(id).toBe('app');
    expect(board.edges).toEqual(expect.arrayContaining([['lb', 'app'], ['app', 'db']]));
    const cached = placeComponent(board, 'cache', ctx).board;
    expect(cached.edges).toEqual(expect.arrayContaining([['api', 'cache'], ['app', 'cache']]));
  });

  it('gives a worker the queue and the stores and providers the app servers reach', () => {
    const pctx = { components, scenario: ping };
    let board = placeComponent(ping.start.board, 'queue', pctx).board;
    board = placeComponent(board, 'worker', pctx).board;
    expect(board.edges).toEqual(expect.arrayContaining([['api', 'queue'], ['queue', 'worker'], ['worker', 'db'], ['worker', 'push']]));
  });

  it('refuses wires that make no sense, and explains why', () => {
    expect(toggleWire(shortly.start.board, 'users', 'db', ctx)).toEqual({ error: expect.stringMatching(/Clients don't call data stores/) });
    const off = toggleWire(shortly.start.board, 'api', 'db', ctx);
    expect('board' in off && off.board.edges).toEqual([['users', 'api']]);
  });
});

describe('board layout', () => {
  it('stacks the rows from Users down and spreads each row', () => {
    const board = placeComponent(placeComponent(shortly.start.board, 'lb', ctx).board, 'app', ctx).board;
    const layout = layoutBoard(board, components, shortly, 600);
    const users = layout.nodes.get('users')!;
    const lb = layout.nodes.get('lb')!;
    const [api, app] = [layout.nodes.get('api')!, layout.nodes.get('app')!];
    expect(users.y).toBeLessThan(lb.y);
    expect(lb.y).toBeLessThan(api.y);
    expect(api.y).toBe(app.y);
    expect(api.x).toBeLessThan(app.x);
    expect(layout.ghost('compute')).toEqual({ x: 500, y: api.y });
    const mid = pointOn(lb, api, 0.5);
    expect(mid.y).toBeGreaterThan(lb.y);
    expect(mid.y).toBeLessThan(api.y);
  });
});
