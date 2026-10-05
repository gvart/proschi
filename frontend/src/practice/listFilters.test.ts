import { describe, expect, it } from 'vitest';
import { activeFilters, NO_FILTERS } from './listFilters';

describe('activeFilters', () => {
  it('is empty with no filter set', () => expect(activeFilters(NO_FILTERS)).toEqual([]));

  it('names each set filter, in the panel order', () => {
    expect(activeFilters({ difficulty: 'hard', tag: 'caching', company: 'Twitter', status: 'todo' })).toEqual([
      { key: 'difficulty', label: 'Difficulty: Hard' },
      { key: 'tag', label: 'Tag: caching' },
      { key: 'company', label: 'Company: Twitter' },
      { key: 'status', label: 'Status: To do' },
    ]);
    expect(activeFilters({ ...NO_FILTERS, status: 'solved' })).toEqual([{ key: 'status', label: 'Status: Solved' }]);
  });
});
