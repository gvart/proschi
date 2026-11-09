import { describe, expect, it } from 'vitest';
import { parse } from '../../dsl/parser';
import { outlineOf } from '../../dsl/edit';
import { defaultStepKind, labelSuggestions, missingScenarios, missingUseCases, outlineSteps } from './flows';

describe('flows builder suggestions', () => {
  const src = [
    'traffic {',
    '  "Redirect" 10 rps mix "Cache hit" 90%, "Cache miss" 10%',
    '  "Shorten" 1 rps',
    '}',
    'usecase "Redirect" {',
    '  v -> api : GET /x',
    '  api -> cache : GET',
    '  alt "Cache hit" {',
    '    cache --> api : target',
    '  }',
    '}',
  ].join('\n');

  it('answers an open request by default', () => {
    const steps = outlineSteps(outlineOf(src, 'Redirect')!.items);
    expect(steps.map((s) => `${s.from}${s.kind === 'response' ? '-->' : '->'}${s.to}`)).toEqual(['v->api', 'api->cache', 'cache-->api']);
    expect(defaultStepKind(steps, 'api', 'v')).toBe('response');
    // The cache already answered.
    expect(defaultStepKind(steps, 'cache', 'api')).toBe('request');
    expect(defaultStepKind(steps, 'api', 'db')).toBe('request');
  });

  it('offers labels that fit the target', () => {
    expect(labelSuggestions('request', 'database')).toContain('SELECT');
    expect(labelSuggestions('request', 'cache')).toEqual(['GET', 'SET']);
    expect(labelSuggestions('request', 'service')[0]).toBe('GET /');
    expect(labelSuggestions('response', 'client')).toContain('200 OK');
    expect(labelSuggestions('async', 'queue')).toContain('publish event');
  });

  it('names the use cases and scenarios the traffic asks for that are missing', () => {
    const { diagram } = parse(src);
    expect(missingUseCases(diagram, ['Redirect'])).toEqual(['Shorten']);
    expect(missingScenarios(diagram, 'Redirect', ['Cache hit'])).toEqual(['Cache miss']);
    expect(missingScenarios(diagram, 'Shorten', [])).toEqual([]);
  });
});
