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
      ['GET /orders/1', ['Get order']],
      ['Other flows', ['Nightly job']],
    ]);
  });

  it('does not group when no use case starts with an HTTP call', () => {
    expect(groups('usecase "A" {\n  a -> b : run\n}')).toEqual([[undefined, ['A']]]);
  });
});
