import { describe, expect, it } from 'vitest';
import { parsePlanState } from './planStore';

describe('the plan kept in this browser', () => {
  const settings = { date: '2026-12-01', minutes: 45, start: '2026-11-09' };
  const item = { kind: 'problem', key: 'problem:chat', problem: 'chat', title: 'Try Chat', reason: 'x', minutes: 25 };

  it('reads back what was kept', () => {
    const state = { settings, last: { day: '2026-11-09', items: [item] }, ticked: { day: '2026-11-09', keys: ['recap'] } };
    expect(parsePlanState(state)).toEqual(state);
  });

  it('drops what is malformed', () => {
    expect(parsePlanState(null)).toEqual({});
    expect(parsePlanState({ settings: { ...settings, minutes: 3 } })).toEqual({});
    expect(parsePlanState({ settings, last: { day: 'today', items: [item] } })).toEqual({ settings });
    expect(parsePlanState({ settings, last: { day: '2026-11-09', items: [{ ...item, kind: 'nap' }] } })).toEqual({ settings });
    expect(parsePlanState({ ticked: { day: '2026-11-09', keys: ['a', 3] } })).toEqual({ ticked: { day: '2026-11-09', keys: ['a'] } });
  });
});
