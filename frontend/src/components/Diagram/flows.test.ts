import { describe, expect, it } from 'vitest';
import { parse } from '../../dsl/parser';
import { outlineOf } from '../../dsl/edit';
import { defaultStepKind, missingScenarios, missingUseCases, nextPick, openRequest, outlineSteps } from './flows';

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

  it('finds the request Reply answers: the latest one still open', () => {
    const step = (from: string, to: string, kind: 'request' | 'response' | 'async') => ({ line: 0, from, to, kind, label: '' });
    expect(openRequest([])).toBeUndefined();
    expect(openRequest([step('web', 'api', 'request'), step('api', 'db', 'request')])).toEqual({ from: 'api', to: 'db' });
    expect(openRequest([step('web', 'api', 'request'), step('api', 'db', 'request'), step('db', 'api', 'response')])).toEqual({ from: 'web', to: 'api' });
    expect(openRequest([step('web', 'api', 'request'), step('api', 'q', 'async'), step('api', 'web', 'response')])).toBeUndefined();
  });

  it('picks a step on the canvas: start, then target, then over again', () => {
    expect(nextPick({}, 'a')).toEqual({ from: 'a' });
    expect(nextPick({ from: 'a' }, 'a')).toEqual({ from: 'a' });
    expect(nextPick({ from: 'a' }, 'b')).toEqual({ from: 'a', to: 'b' });
    expect(nextPick({ from: 'a', to: 'b' }, 'c')).toEqual({ from: 'c' });
  });

  it('names the use cases and scenarios the traffic asks for that are missing', () => {
    const { diagram } = parse(src);
    expect(missingUseCases(diagram, ['Redirect'])).toEqual(['Shorten']);
    expect(missingScenarios(diagram, 'Redirect', ['Cache hit'])).toEqual(['Cache miss']);
    expect(missingScenarios(diagram, 'Shorten', [])).toEqual([]);
  });
});
