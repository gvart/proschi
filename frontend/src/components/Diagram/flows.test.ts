import { describe, expect, it } from 'vitest';
import { parse } from '../../dsl/parser';
import { outlineOf } from '../../dsl/edit';
import { choiceOfScenario, defaultStepKind, missingScenarios, missingUseCases, nextPick, openRequest, outlineSteps, scenarioOfChoice } from './flows';

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

describe('the scenario Play plays and the branches Flows shows', () => {
  const src = [
    'shopper [Client]',
    'api [Service]',
    'cache [Redis]',
    'db [Postgres]',
    'usecase "Checkout" {',
    '  shopper -> api : POST /checkout',
    '  alt "Cart cached" {',
    '    api -> cache : GET cart',
    '    alt "Warm" {',
    '      cache --> api : hit',
    '    } alt "Cold" {',
    '      cache --> api : miss',
    '    }',
    '  } alt "Cart expired" {',
    '    api -> db : SELECT cart',
    '  }',
    '  api -> cache : SET cart',
    '  alt "Paid" {',
    '    api -> db : INSERT order',
    '  } alt "Declined" {',
    '    api --> shopper : 402',
    '  }',
    '}',
  ].join('\n');
  const useCase = parse(src).diagram.useCases[0];
  const sets = outlineOf(src, 'Checkout')!.items.flatMap((i) => (i.kind === 'scenarios' ? [i.branches.map((b) => b.name)] : []));

  it('finds the first scenario whose path takes the branch of each set, a nested set between', () => {
    expect(sets).toEqual([
      ['Cart cached', 'Cart expired'],
      ['Paid', 'Declined'],
    ]);
    expect(scenarioOfChoice(useCase.scenarios, ['Cart cached', 'Paid'])).toBe('cart-cached-warm-paid');
    expect(scenarioOfChoice(useCase.scenarios, ['Cart expired', 'Declined'])).toBe('cart-expired-declined');
    expect(scenarioOfChoice(useCase.scenarios, ['Declined', 'Cart expired'])).toBeUndefined();
    expect(scenarioOfChoice(useCase.scenarios, [])).toBe(useCase.scenarios[0].id);
  });

  it('reads the branch of each set back from a scenario, and the two agree', () => {
    for (const s of useCase.scenarios) {
      const choice = choiceOfScenario(s.name, sets);
      const names = sets.map((_, i) => choice[i]);
      expect(names.every(Boolean)).toBe(true);
      // Back to a scenario with those branches (with a nested set, its first branch).
      expect(choiceOfScenario(useCase.scenarios.find((x) => x.id === scenarioOfChoice(useCase.scenarios, names))!.name, sets)).toEqual(choice);
    }
    expect(choiceOfScenario('Cart cached › Cold › Declined', sets)).toEqual({ 0: 'Cart cached', 1: 'Declined' });
    expect(choiceOfScenario('Checkout', sets)).toEqual({});
  });
});
