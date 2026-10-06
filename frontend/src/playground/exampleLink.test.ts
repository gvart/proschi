import { describe, expect, it } from 'vitest';
import { examples, parse } from '../dsl';
import { format } from '../dsl/format';
import { defaultEngine } from '../hld/engine';
import { EXAMPLE_PARAM, FIRST_RUN_SOURCE, exampleFromSearch, exampleHref, withoutExample } from './exampleLink';
import { currentDoc, initialState } from './documents';

describe('example links', () => {
  it('name a bundled example by its id', () => {
    for (const e of examples) expect(exampleFromSearch(`?${EXAMPLE_PARAM}=${e.id}`)?.example).toBe(e);
    expect(exampleFromSearch('?tour=0&example=url-shortener')?.example?.id).toBe('url-shortener');
  });

  it('are null without the parameter, and carry the id alone when it is unknown', () => {
    expect(exampleFromSearch('')).toBeNull();
    expect(exampleFromSearch('?tour=1')).toBeNull();
    expect(exampleFromSearch('?example=nope')).toEqual({ id: 'nope' });
  });

  it('leave the rest of the query alone when taken out of it', () => {
    expect(withoutExample('?example=login')).toBe('');
    expect(withoutExample('?tour=0&example=login')).toBe('?tour=0');
    expect(withoutExample('')).toBe('');
  });

  it('round-trip through exampleHref', () => {
    expect(exampleHref('login', './app/')).toBe('./app/?example=login');
    for (const e of examples) expect(exampleFromSearch(exampleHref(e.id).slice(2))?.example?.id).toBe(e.id);
  });
});

describe('the first-run document', () => {
  const { diagram, diagnostics } = parse(FIRST_RUN_SOURCE);

  it('is a small, valid, canonically formatted design with a use case to play', () => {
    expect(diagnostics).toEqual([]);
    expect(format(FIRST_RUN_SOURCE)).toBe(FIRST_RUN_SOURCE);
    expect(diagram.nodes.length).toBeLessThanOrEqual(4);
    expect(diagram.useCases[0]?.scenarios[0]?.steps.length).toBeGreaterThan(0);
  });

  it('has traffic and requirements, so the tour can show Results, and they pass', () => {
    expect(diagram.traffic?.length).toBeGreaterThan(0);
    const results = defaultEngine.runTests(diagram, defaultEngine.analyze(diagram));
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.filter((r) => !r.passed).map((r) => r.message)).toEqual([]);
  });

  it('is what an empty browser opens', () => {
    const state = initialState({ stored: null, legacySource: null, sharedSource: null, fallbackSource: FIRST_RUN_SOURCE });
    expect(currentDoc(state).source).toBe(FIRST_RUN_SOURCE);
  });
});
