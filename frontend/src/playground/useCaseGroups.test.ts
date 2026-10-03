import { describe, expect, it } from 'vitest';
import { parse } from '../dsl';
import { groupByEndpoint } from './useCaseGroups';

const groups = (source: string) =>
  groupByEndpoint(parse(source).diagram.useCases).map((g) => [g.label, g.useCases.map((u) => u.name)]);

describe('groupByEndpoint', () => {
  it('groups use cases by the endpoint of their first step, in document order', () => {
    const source = `usecase "Create order" {
  web -> api : POST /orders
}
usecase "Get order" {
  web -> api : GET /orders/1
}
usecase "Create order twice" {
  web -> api : POST /orders
}
usecase "Nightly job" {
  cron -> api : run
}`;
    expect(groups(source)).toEqual([
      ['POST /orders', ['Create order', 'Create order twice']],
      ['GET /orders/{id}', ['Get order']],
      ['Other flows', ['Nightly job']],
    ]);
  });

  it('does not group when no use case starts with an HTTP call', () => {
    expect(groups('usecase "A" {\n  a -> b : run\n}')).toEqual([[undefined, ['A']]]);
  });

  it('groups calls under a path template used in the document', () => {
    const source = `usecase "Get order" {
  web -> api : GET /orders/{orderId}
}
usecase "Get a missing order" {
  web -> api : GET /orders/nope
}
usecase "Delete order" {
  web -> api : DELETE /orders/42
}
usecase "Delete another order" {
  web -> api : DELETE /orders/0b9c6f1e-1a2b-4c3d-8e9f-0a1b2c3d4e5f
}`;
    expect(groups(source)).toEqual([
      ['GET /orders/{orderId}', ['Get order', 'Get a missing order']],
      ['DELETE /orders/{id}', ['Delete order', 'Delete another order']],
    ]);
    // The use case keeps the literal endpoint.
    expect(parse(source).diagram.useCases[1].endpoint).toBe('GET /orders/nope');
  });
});
