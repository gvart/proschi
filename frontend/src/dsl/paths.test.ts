import { describe, expect, it } from 'vitest';
import { endpointGroupKey, isTemplate, matchesTemplate, templatize } from './paths';

describe('path templates', () => {
  it('recognises {param} segments', () => {
    expect(isTemplate('/orders/{id}')).toBe(true);
    expect(isTemplate('GET /orders/{id}/items')).toBe(true);
    expect(isTemplate('/orders')).toBe(false);
    expect(isTemplate('/orders/{id')).toBe(false);
  });

  it('matches exactly one non-empty segment per parameter', () => {
    expect(matchesTemplate('/orders/{id}', '/orders/42')).toBe(true);
    expect(matchesTemplate('/orders/{id}/items/{item}', '/orders/42/items/a-1')).toBe(true);
    expect(matchesTemplate('/orders/{id}', '/orders/')).toBe(false);
    expect(matchesTemplate('/orders/{id}', '/orders/42/items')).toBe(false);
    expect(matchesTemplate('/orders/{id}', '/users/42')).toBe(false);
    expect(matchesTemplate('/orders/{id}', '/orders/42?full=1')).toBe(true);
  });

  it('folds numeric and UUID segments into {id}', () => {
    expect(templatize('/orders/42/items/7')).toBe('/orders/{id}/items/{id}');
    expect(templatize('/users/3f2b8c1e-9d4a-4e2b-8f1a-0c9d8e7f6a5b')).toBe('/users/{id}');
    expect(templatize('/orders/order-789')).toBe('/orders/order-789');
    expect(templatize('/v2/orders')).toBe('/v2/orders');
  });

  it('picks a group key: the template itself, a matching template, or folded ids', () => {
    const all = ['GET /orders/{orderId}', 'GET /orders/order-789', 'DELETE /orders/order-789', 'GET /users/42'];
    expect(endpointGroupKey('GET /orders/{orderId}', all)).toBe('GET /orders/{orderId}');
    expect(endpointGroupKey('GET /orders/order-789', all)).toBe('GET /orders/{orderId}');
    // A template only collects calls with the same method.
    expect(endpointGroupKey('DELETE /orders/order-789', all)).toBe('DELETE /orders/order-789');
    expect(endpointGroupKey('GET /users/42', all)).toBe('GET /users/{id}');
  });
});
