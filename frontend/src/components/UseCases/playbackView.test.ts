import { describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';
import type { FlowStep } from '../../dsl/types';
import { parse } from '../../dsl/parser';
import { framesOf, playbackView } from './playbackView';

const node = (id: string): Node => ({ id, position: { x: 0, y: 0 }, data: { name: id } });
const nodes = ['web', 'api', 'db', 'cache'].map(node);
const edges: Edge[] = [
  { id: 'e1', source: 'web', target: 'api' },
  { id: 'e2', source: 'api', target: 'db' },
];
const step = (from: string, to: string, extra: Partial<FlowStep> = {}): FlowStep =>
  ({ id: `${from}-${to}`, stepName: `${from} -> ${to}`, fromServiceId: from, toServiceId: to, executionType: 'SYNC_REQUEST_RESPONSE', ...extra }) as FlowStep;
const useCase = { id: 'uc', name: 'Place order', steps: [step('web', 'api'), step('api', 'db', { statusCode: 503 }), step('db', 'cache')] };

describe('playbackView', () => {
  it('draws the diagram as it is when nothing plays, with the playback edge type already set', () => {
    const view = playbackView(nodes, edges, undefined, 0);
    expect(view.active).toBe(false);
    expect(view.nodes).toBe(nodes);
    expect(view.edges.map((e) => e.type)).toEqual(['playback', 'playback']);
    expect(view.edges.every((e) => !e.data?.isActive)).toBe(true);
  });

  it('keeps every edge type when playback starts, so no edge remounts', () => {
    const idle = playbackView(nodes, edges, undefined, 0);
    const playing = playbackView(nodes, edges, useCase, 0);
    for (const edge of idle.edges) expect(playing.edges.find((e) => e.id === edge.id)?.type).toBe(edge.type);
  });

  it('picks out the current step and its edge', () => {
    const view = playbackView(nodes, edges, useCase, 1);
    expect([...view.highlighted].sort()).toEqual(['api', 'db']);
    expect([...view.errorNodes]).toEqual(['db']);
    const e2 = view.edges.find((e) => e.id === 'e2')!;
    expect(e2.data).toMatchObject({ isActive: true, isError: true });
    expect(view.edges.find((e) => e.id === 'e1')!.data.isActive).toBe(false);
    expect(view.nodes.find((n) => n.id === 'db')!.className).toBe('pc-failing');
    expect(view.nodes.find((n) => n.id === 'web')!.style?.opacity).toBe(0.45);
  });

  it('adds a hidden edge for a step between nodes that are not connected', () => {
    const view = playbackView(nodes, edges, useCase, 2);
    const extra = view.edges.find((e) => e.id === 'step:db->cache')!;
    expect(extra.type).toBe('playback');
    expect(extra.data.isActive).toBe(true);
    expect(playbackView(nodes, edges, useCase, 0).edges.find((e) => e.id === 'step:db->cache')!.style?.opacity).toBe(0);
  });
});

describe('frames', () => {
  const play = (body: string) => {
    const src = `user "U" [Actor]\napi "API" [REST API]\ndb "DB" [PostgreSQL]\nkafka "K" [Kafka]\nuser -> api\napi -> db\ndb -> kafka\nusecase "Sign up" {\n${body}\n}`;
    const result = parse(src);
    return result.diagram!.useCases[0].steps;
  };
  const shape = (steps: ReturnType<typeof play>) => framesOf(steps).map((f) => [f.steps.map((s) => s.toServiceId), f.responses.map((s) => s.toServiceId)]);

  it('gives a response written after other steps a frame of its own', () => {
    const steps = play('user -> api : POST /users\napi -> db : INSERT\ndb ->> kafka : CDC\napi --> user : 201');
    expect(steps).toHaveLength(3);
    expect(shape(steps)).toEqual([[['api'], []], [['db'], []], [['kafka'], []], [[], ['api']]]);
  });

  it('plays a response inside par together with the other branches', () => {
    const steps = play('user -> api : POST /users\napi -> db : INSERT\npar {\n  api --> user : 201\n  db ->> kafka : CDC\n}');
    expect(shape(steps)).toEqual([[['api'], []], [['db'], []], [['kafka'], ['api']]]);
  });

  it('keeps a response that directly follows its request in the same frame', () => {
    const steps = play('user -> api : GET /a\napi --> user : 200\napi -> db : SELECT\ndb --> api : rows');
    expect(shape(steps)).toEqual([[['api'], []], [['db'], []]]);
  });

  it('sends the answer back along the edge', () => {
    const steps = play('user -> api : POST /users\napi -> db : INSERT\napi --> user : 201');
    const nodes = ['user', 'api', 'db'].map(node);
    const edges: Edge[] = [{ id: 'e1', source: 'user', target: 'api' }, { id: 'e2', source: 'api', target: 'db' }];
    const out = playbackView(nodes, edges, { name: 'x', steps }, 0);
    expect(out.edges.find((e) => e.id === 'e1')!.data).toMatchObject({ isActive: true, isRequestResponse: false });
    const back = playbackView(nodes, edges, { name: 'x', steps }, 2);
    expect(back.edges.find((e) => e.id === 'e1')!.data).toMatchObject({ isActive: true, reverse: true });
    expect(back.edges.find((e) => e.id === 'e2')!.data.isActive).toBe(false);
  });
});
