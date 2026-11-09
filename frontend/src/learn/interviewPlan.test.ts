import { describe, expect, it } from 'vitest';
import { addDays, buildPlan, carryOver, itemDone, phaseOf, phaseSplit, pickable, readPlanSettings, type PlanActivity, type PlanInput } from './interviewPlan';

const problems: PlanInput['problems'] = [
  { id: 'url-shortener', title: 'URL shortener', difficulty: 'easy' },
  { id: 'cache', title: 'Read cache', difficulty: 'easy' },
  { id: 'chat', title: 'Chat', difficulty: 'medium' },
  { id: 'kv', title: 'Key-value store', difficulty: 'medium' },
  { id: 'feed', title: 'News feed', difficulty: 'hard' },
  { id: 'payments', title: 'Payments', difficulty: 'hard' },
];

const topics: PlanInput['topics'] = [
  { id: 'caching', title: 'Caching', mastery: 0.5, related: ['cache', 'url-shortener'] },
  { id: 'sharding', title: 'Sharding', mastery: 0.2, related: ['kv', 'feed'] },
  { id: 'queues', title: 'Queues', mastery: 0.9, related: ['chat'] },
];

const today = '2026-11-09';
const base: PlanInput = {
  today,
  settings: { date: '2026-11-19', minutes: 45, start: today },
  topics,
  due: { total: 0, byTopic: {} },
  problems,
  solved: [],
  attempted: [],
  mistakes: [],
  roadmap: ['url-shortener', 'cache', 'kv', 'chat', 'feed', 'payments'],
};

const plan = (input: Partial<PlanInput> = {}) => buildPlan({ ...base, ...input });

describe('interview plan phases', () => {
  it('splits the days into learning, mock interviews, review and a rest day', () => {
    expect(phaseSplit(0)).toEqual({ learn: 0, mock: 0, review: 0, rest: 0 });
    expect(phaseSplit(1)).toEqual({ learn: 0, mock: 0, review: 0, rest: 1 });
    expect(phaseSplit(3)).toEqual({ learn: 1, mock: 0, review: 1, rest: 1 });
    expect(phaseSplit(10)).toEqual({ learn: 4, mock: 3, review: 2, rest: 1 });
    // Long plans cap the mock and review days.
    expect(phaseSplit(90)).toEqual({ learn: 74, mock: 10, review: 5, rest: 1 });
  });

  it('dates the phases from the start, so they stay put as days pass', () => {
    const settings = { date: '2026-11-19', start: today };
    const phases = Array.from({ length: 11 }, (_, i) => phaseOf(settings, addDays(today, i)));
    expect(phases).toEqual(['learn', 'learn', 'learn', 'learn', 'mock', 'mock', 'mock', 'review', 'review', 'rest', 'interview']);
    expect(phaseOf(settings, '2026-11-20')).toBeUndefined();
    // A start after the day counts from the day.
    expect(phaseOf({ date: '2026-11-19', start: '2026-11-12' }, today)).toBe('learn');
  });
});

describe('interview plan days', () => {
  it('has a day from today to the interview, ending with the rest day and the interview', () => {
    const days = plan();
    expect(days).toHaveLength(11);
    expect(days[0].day).toBe(today);
    expect(days.at(-2)).toMatchObject({ phase: 'rest', items: [{ kind: 'recap' }] });
    expect(days.at(-1)).toMatchObject({ day: '2026-11-19', phase: 'interview', items: [] });
  });

  it('fills learning days with problems for the weakest skill first, within the minutes', () => {
    const due = { total: 6, byTopic: { caching: 6 } };
    // 45 minutes: the cards and one medium problem (35 min).
    expect(plan({ due })[0].items.map((i) => i.key)).toEqual(['cards:due', 'problem:kv']);
    // An hour: the cards and two problems, a medium and an easy one.
    const days = plan({ due, settings: { ...base.settings, minutes: 60 } });
    expect(days[0].items.map((i) => i.key)).toEqual(['cards:due', 'problem:kv', 'problem:url-shortener']);
    expect(days[0].items.map((i) => i.minutes)).toEqual([3, 35, 20]);
    expect(days[0].items[0]).toMatchObject({ title: 'Review 6 due cards', count: 6 });
    expect(days[0].items[1].reason).toMatch(/Sharding, your weakest skill/);
    // Later days go on with what is left, never repeating a problem.
    const problemsPlanned = days.flatMap((d) => d.items.filter((i) => i.kind === 'problem').map((i) => i.problem));
    expect(new Set(problemsPlanned).size).toBe(problemsPlanned.length);
    expect(days[1].items[0].problem).toBe('feed');
    expect(days[1].items[0].minutes).toBe(45);
  });

  it('never plans a tutorial', () => {
    const withTutorial = { ...base, problems: [{ id: 'hello', title: 'Hello', difficulty: 'easy' as const }, ...problems], roadmap: ['hello', ...base.roadmap] };
    expect(buildPlan(withTutorial).some((d) => d.items.some((i) => i.problem === 'hello'))).toBe(true);
    const days = buildPlan({ ...withTutorial, skip: ['hello'], carry: ['hello'] });
    expect(days.some((d) => d.items.some((i) => i.problem === 'hello'))).toBe(false);
  });

  it('gives each mock day an interview on a different unsolved medium or hard problem', () => {
    const days = plan();
    const mocks = days.filter((d) => d.phase === 'mock').map((d) => d.items[0]);
    expect(mocks.map((m) => m.kind)).toEqual(['interview', 'interview', 'interview']);
    expect(new Set(mocks.map((m) => m.problem)).size).toBe(3);
    for (const m of mocks) expect(problems.find((p) => p.id === m.problem)!.difficulty).not.toBe('easy');
  });

  it('revises two topics a day in the review phase, weakest first, a new pair each day', () => {
    const review = plan().filter((d) => d.phase === 'review');
    expect(review.map((d) => d.items.map((i) => i.key))).toEqual([
      ['cards:due', 'topic:sharding', 'topic:caching'],
      ['cards:due', 'topic:queues', 'topic:sharding'],
    ]);
  });

  it('is the same for the same input', () => {
    expect(plan({ due: { total: 3, byTopic: {} } })).toEqual(plan({ due: { total: 3, byTopic: {} } }));
  });

  it('keeps today as pinned and plans later days around its problems', () => {
    const pinned = [{ kind: 'problem' as const, key: 'problem:feed', problem: 'feed', title: 'Try News feed', reason: 'x', minutes: 40 }];
    const days = plan({ pinned });
    expect(days[0].items).toEqual(pinned);
    expect(days.slice(1).some((d) => d.items.some((i) => i.problem === 'feed' && i.kind === 'problem'))).toBe(false);
  });

  it('re-flows: problems left open on the last plan day come first today', () => {
    const last = { day: '2026-11-08', items: [{ kind: 'problem' as const, key: 'problem:chat', problem: 'chat', title: 'Try Chat', reason: '', minutes: 25 }] };
    const carry = carryOver(last, today, new Set());
    expect(carry).toEqual(['chat']);
    expect(carryOver(last, today, new Set(['chat']))).toEqual([]);
    expect(carryOver({ ...last, day: today }, today, new Set())).toEqual([]);
    const days = plan({ carry });
    expect(days[0].items[0]).toMatchObject({ problem: 'chat', carried: true, title: 'Finish Chat' });
  });

  it('revises when nothing is left to learn, and is empty after the interview', () => {
    const days = plan({ solved: problems.map((p) => p.id) });
    // No cards due today: the topics only; later days keep a slot for the cards due then.
    expect(days[0].items.map((i) => i.kind)).toEqual(['topic', 'topic']);
    expect(days[1].items.map((i) => i.kind)).toEqual(['cards', 'topic', 'topic']);
    expect(plan({ today: '2026-11-20' })).toEqual([]);
  });

  it('is only the rest day and the interview the day before', () => {
    const days = plan({ settings: { date: '2026-11-10', minutes: 45, start: today } });
    expect(days.map((d) => d.phase)).toEqual(['rest', 'interview']);
  });
});

describe('ticking today off', () => {
  const none: PlanActivity = { solved: new Set(), dueNow: 4, reviewsToday: 0, topicsReviewed: new Set(), interviews: 0, ticked: new Set() };
  it('ticks each kind from what was done', () => {
    expect(itemDone({ kind: 'problem', key: 'problem:kv', problem: 'kv', title: '', reason: '', minutes: 1 }, { ...none, solved: new Set(['kv']) })).toBe(true);
    expect(itemDone({ kind: 'cards', key: 'cards:due', count: 4, title: '', reason: '', minutes: 1 }, none)).toBe(false);
    expect(itemDone({ kind: 'cards', key: 'cards:due', count: 4, title: '', reason: '', minutes: 1 }, { ...none, reviewsToday: 4 })).toBe(true);
    expect(itemDone({ kind: 'cards', key: 'cards:due', title: '', reason: '', minutes: 1 }, { ...none, dueNow: 0 })).toBe(true);
    expect(itemDone({ kind: 'topic', key: 'topic:caching', topic: 'caching', title: '', reason: '', minutes: 1 }, { ...none, topicsReviewed: new Set(['caching']) })).toBe(true);
    expect(itemDone({ kind: 'interview', key: 'interview:kv', title: '', reason: '', minutes: 1 }, { ...none, interviews: 1 })).toBe(true);
    expect(itemDone({ kind: 'recap', key: 'recap', title: '', reason: '', minutes: 1 }, none)).toBe(false);
    expect(itemDone({ kind: 'recap', key: 'recap', title: '', reason: '', minutes: 1 }, { ...none, ticked: new Set(['recap']) })).toBe(true);
  });
});

describe('plan settings', () => {
  it('reads valid settings only', () => {
    expect(readPlanSettings({ date: '2026-12-01', minutes: 45, start: today })).toEqual({ date: '2026-12-01', minutes: 45, start: today });
    expect(readPlanSettings({ date: '2026-12-01', minutes: 5, start: today })).toBeUndefined();
    expect(readPlanSettings({ date: '2026-02-30', minutes: 45, start: today })).toBeUndefined();
    expect(readPlanSettings({ date: '2026-11-01', minutes: 45, start: today })).toBeUndefined();
    expect(readPlanSettings(null)).toBeUndefined();
  });

  it('takes dates from tomorrow to 180 days ahead', () => {
    expect(pickable(today, today)).toBe(false);
    expect(pickable('2026-11-10', today)).toBe(true);
    expect(pickable(addDays(today, 180), today)).toBe(true);
    expect(pickable(addDays(today, 181), today)).toBe(false);
  });
});
