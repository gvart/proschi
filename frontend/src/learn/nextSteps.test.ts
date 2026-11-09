import { describe, expect, it } from 'vitest';
import { nextSteps, type NextStepsInput } from './nextSteps';

const problems: NextStepsInput['problems'] = [
  { id: 'url-shortener', title: 'URL shortener', difficulty: 'easy' },
  { id: 'chat', title: 'Chat', difficulty: 'medium' },
  { id: 'feed', title: 'News feed', difficulty: 'hard' },
  { id: 'kv', title: 'Key-value store', difficulty: 'medium' },
  { id: 'cache', title: 'Read cache', difficulty: 'easy' },
];

const topics: NextStepsInput['topics'] = [
  { id: 'caching', title: 'Caching', mastery: 0.5, related: ['cache', 'url-shortener'] },
  { id: 'sharding', title: 'Sharding', mastery: 0.2, related: ['kv', 'feed'] },
  { id: 'queues', title: 'Queues', mastery: 0.9, related: ['chat'] },
];

const base: NextStepsInput = { topics, due: { total: 0, byTopic: {} }, problems, solved: [], attempted: [], mistakes: [] };

const kinds = (input: Partial<NextStepsInput>) => nextSteps({ ...base, ...input }).map((s) => s.key);

describe('rule-based next steps', () => {
  it('ranks a mistake, due cards, the challenge, weak skills and a started problem in that order, cut at the limit', () => {
    const input: NextStepsInput = {
      ...base,
      due: { total: 12, byTopic: { caching: 12 } },
      attempted: ['chat', 'feed'],
      mistakes: [{ problem: 'chat', title: 'Cache misses that never fill the cache', at: 100 }],
      challengeDone: false,
      limit: 10,
    };
    expect(nextSteps(input).map((s) => s.key)).toEqual(['retry:chat', 'review:caching', 'challenge:today', 'practise:kv', 'practise:url-shortener', 'finish:feed']);
    expect(nextSteps({ ...input, limit: undefined })).toHaveLength(4);
  });

  it('words each step with a reason', () => {
    const steps = nextSteps({ ...base, mistakes: [{ problem: 'chat', title: 'No replicas', at: 1 }], due: { total: 12, byTopic: { caching: 12 } }, challengeDone: false, streak: 4, limit: 10 });
    expect(steps[0]).toMatchObject({ title: 'Retry Chat', reason: 'You missed: No replicas.', problem: 'chat', minutes: 25 });
    expect(steps[1]).toMatchObject({ title: 'Review 12 due cards on Caching', topic: 'caching', minutes: 6 });
    expect(steps[2]).toMatchObject({ title: 'Do today’s daily challenge', reason: 'Five quick questions; keeps your 4-day streak going.' });
    expect(steps[3]).toMatchObject({ title: 'Try Key-value store', topic: 'sharding', reason: 'Practises Sharding, your weakest skill (20% mastered).' });
    expect(steps[4].reason).toBe('Practises Caching, one of your weaker skills (50% mastered).');
  });

  it('names the topics with the most due cards when they are spread', () => {
    const [step] = nextSteps({ ...base, due: { total: 9, byTopic: { caching: 3, sharding: 5, queues: 3 } } });
    expect(step).toMatchObject({ key: 'review:all', title: 'Review 9 due cards' });
    expect(step.topic).toBeUndefined();
    // Ties go to the weaker topic: caching (0.5) before queues (0.9).
    expect(step.reason).toContain('most on Sharding and Caching');
    expect(nextSteps({ ...base, due: { total: 1, byTopic: {} } })[0].title).toBe('Review 1 due card');
  });

  it('retries the latest mistake on an unsolved problem only', () => {
    const mistakes = [
      { problem: 'chat', title: 'A', at: 5 },
      { problem: 'kv', title: 'B', at: 9 },
      { problem: 'feed', title: 'C', at: 20 },
    ];
    expect(kinds({ mistakes, solved: ['feed'] })[0]).toBe('retry:kv');
    expect(kinds({ mistakes: [{ problem: 'gone', title: 'A', at: 1 }] })).not.toContain('retry:gone');
  });

  it('suggests the challenge only when known not to be played', () => {
    expect(kinds({ challengeDone: true })).not.toContain('challenge:today');
    expect(kinds({})).not.toContain('challenge:today');
    expect(nextSteps({ ...base, challengeDone: false })[0].reason).toBe('Five quick questions, new every day.');
  });

  it('practises weak topics with their easiest unsolved problem, a started one first', () => {
    expect(kinds({ solved: ['kv'] })).toEqual(['practise:feed', 'practise:url-shortener']);
    expect(kinds({ attempted: ['cache'] })).toEqual(['practise:kv', 'practise:cache']);
    // A strong topic is never practised; a topic with nothing left is skipped.
    expect(kinds({ solved: ['kv', 'feed', 'cache', 'url-shortener'] })).toEqual([]);
  });

  it('never repeats a problem, and leaves out the excluded ones', () => {
    const keys = kinds({ mistakes: [{ problem: 'kv', title: 'A', at: 1 }], attempted: ['kv', 'cache'], limit: 10 });
    expect(keys).toEqual(['retry:kv', 'practise:feed', 'practise:cache']);
    expect(kinds({ exclude: ['kv', 'cache'], limit: 10 })).toEqual(['practise:feed', 'practise:url-shortener']);
  });

  it('is deterministic and empty with nothing to do', () => {
    const input = { ...base, due: { total: 3, byTopic: { caching: 1, sharding: 1 } }, challengeDone: false };
    expect(nextSteps(input)).toEqual(nextSteps(input));
    expect(nextSteps({ ...base, topics: [] })).toEqual([]);
  });
});
