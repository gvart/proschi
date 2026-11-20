import { describe, expect, it } from 'vitest';
import { parse } from '../../dsl';
import { canvasActions, quickItems, type QuickItem } from './quickItems';

const noop = () => {};
const ACTIONS = canvasActions({ newUseCase: noop, addStep: noop, rename: noop, remove: noop, fit: noop });
const text = (item: QuickItem) => (item.kind === 'add' ? `add ${item.choice.name}` : item.action.label);
const items = (query: string, types = parse('').diagram.types ?? []) => quickItems(query, types, ACTIONS).map(text);

describe('quickItems', () => {
  it('lists every action with nothing typed, those the canvas cannot do now left out', () => {
    expect(items('')).toEqual(['New use case', 'Add step', 'Rename', 'Delete', 'Fit view', 'Switch to Code']);
    expect(canvasActions({ fit: noop }).map((a) => a.label)).toEqual(['Fit view', 'Switch to Code']);
  });

  it('adds the component a type name starts with, first', () => {
    expect(items('redis')[0]).toBe('add Redis');
    expect(items('postgres')[0]).toBe('add PostgreSQL');
    expect(items('queue')[0]).toMatch(/^add .*Queue/);
    // Even when other groups list more that only contain the words.
    expect(items('re').slice(0, 2)).toEqual(expect.arrayContaining(['add Redis', 'add REST API']));
  });

  it('puts the design’s own types first', () => {
    const { diagram } = parse('type OrdersDb extends PostgreSQL {}\ndb [OrdersDb]\n');
    expect(quickItems('orders', diagram.types ?? [], ACTIONS).map(text)[0]).toBe('add OrdersDb');
  });

  it('finds actions by their words, before components that only contain them', () => {
    expect(items('rename')).toEqual(['Rename']);
    expect(items('fit')[0]).toBe('Fit view');
    expect(items('code')[0]).toBe('Switch to Code');
    expect(items('use case')[0]).toBe('New use case');
    expect(items('step')[0]).toBe('Add step');
  });

  it('lists at most eight components, and nothing for words nothing has', () => {
    expect(items('a').filter((t) => t.startsWith('add ')).length).toBeLessThanOrEqual(8);
    expect(items('no such thing')).toEqual([]);
  });
});
