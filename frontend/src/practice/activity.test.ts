import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardReview } from '../learn/review';
import { computeStreak, DEFAULT_GOAL, type DayActivity } from '../learn/streak';
import { localActivity, recordLocalRun, RUN_DAYS_KEY, withOutbox } from './activity';
import { CHALLENGE_KEY, type ChallengeResult } from './challenge/store';
import { accountStore, CARDS_OUTBOX_KEY } from './review/store';

const api = vi.hoisted(() => vi.fn());
vi.mock('../services/api', async (importOriginal) => ({ ...(await importOriginal<object>()), api }));

const TODAY = '2026-10-20';
const YESTERDAY = '2026-10-19';
const review = (id: string, day = TODAY): CardReview => ({ id, cardId: `card-${id}`, version: 1, rating: 3, reviewedAt: 1_700_000_000, durationMs: 1000, day });

let storage: Map<string, string>;
let writable: boolean;

beforeEach(() => {
  storage = new Map();
  writable = true;
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (!writable) throw new Error('blocked');
      storage.set(k, v);
    },
  });
  api.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

const outbox = (byUser: Record<string, CardReview[]>) => storage.set(CARDS_OUTBOX_KEY, JSON.stringify(byUser));

describe('the streak with the outbox (signed in)', () => {
  const server: DayActivity[] = [
    { day: YESTERDAY, reviews: 10, solves: 0 },
    { day: TODAY, reviews: 6, solves: 0, newCards: 2 },
  ];

  it('counts the user’s unsent reviews on their days, each once, and no other user’s', () => {
    outbox({ u1: [review('a'), review('b'), review('a'), review('c', YESTERDAY)], u2: [review('x'), review('y')] });
    expect(withOutbox(server, 'u1')).toEqual([
      { day: YESTERDAY, reviews: 11, solves: 0, newCards: 0 },
      { day: TODAY, reviews: 8, solves: 0, newCards: 2 },
    ]);
    // Today's goal of 10 is not met by the server's 6, and is with four more pending.
    expect(computeStreak(server, TODAY, DEFAULT_GOAL).todayDone).toBe(false);
    outbox({ u1: [review('a'), review('b'), review('c'), review('d')] });
    expect(computeStreak(withOutbox(server, 'u1'), TODAY, DEFAULT_GOAL).todayDone).toBe(true);
  });

  it('leaves the activity alone with nothing pending or no storage', () => {
    expect(withOutbox(server, 'u1')).toBe(server);
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => undefined,
    });
    expect(withOutbox(server, 'u1')).toBe(server);
  });

  it('does not count a review twice once it is sent, even when the outbox cannot drop it', async () => {
    const store = accountStore('u1');
    store.add(review('a'));
    store.add(review('b'));
    expect(withOutbox(server, 'u1').find((d) => d.day === TODAY)?.reviews).toBe(8);

    // Sent, but the browser's storage now refuses writes: the outbox still lists both.
    writable = false;
    api.mockResolvedValue({ states: {} });
    await store.flush();
    expect(api).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.get(CARDS_OUTBOX_KEY)!).u1).toHaveLength(2);
    // The server's counts now hold them; the outbox adds nothing.
    const after = [server[0], { ...server[1], reviews: 8 }];
    expect(withOutbox(after, 'u1')).toBe(after);
  });
});

describe('the streak in a build without accounts', () => {
  const result = (day: string, localDay?: string): ChallengeResult => ({
    day,
    score: 100,
    maxScore: 600,
    correct: 1,
    perfect: false,
    totalMs: 1000,
    results: [{ cardId: 'policy', answer: 1, ms: 1000, correct: true, points: 100, bonus: 0 }],
    ...(localDay ? { localDay } : {}),
  });

  it('counts the daily challenges kept in this browser on the day they were played, older results on their UTC day', () => {
    // Played late on the 19th in a time zone behind UTC, where it was already the 20th's challenge; and one kept before the local day was recorded.
    storage.set(CHALLENGE_KEY, JSON.stringify({ [TODAY]: result(TODAY, YESTERDAY), '2026-10-17': result('2026-10-17') }));
    expect(localActivity()).toEqual([
      { day: '2026-10-17', reviews: 0, solves: 0, newCards: 0, challenges: 1 },
      { day: YESTERDAY, reviews: 0, solves: 0, newCards: 0, challenges: 1 },
    ]);
    expect(computeStreak(localActivity(), TODAY)).toMatchObject({ current: 1, todayDone: false });
  });

  it('counts finished Arcade runs by day, forgetting days the streak no longer looks at', () => {
    recordLocalRun(TODAY);
    recordLocalRun(TODAY);
    recordLocalRun('not a day');
    expect(localActivity()).toEqual([{ day: TODAY, reviews: 0, solves: 0, newCards: 0, runs: 2 }]);
    expect(computeStreak(localActivity(), TODAY)).toMatchObject({ current: 1, todayDone: true, todayProgress: 1 });
    storage.set(RUN_DAYS_KEY, JSON.stringify({ '2024-01-01': 1, [TODAY]: 2, bad: 'x' }));
    recordLocalRun(TODAY);
    expect(JSON.parse(storage.get(RUN_DAYS_KEY)!)).toEqual({ [TODAY]: 3 });
  });

  it('survives malformed storage', () => {
    storage.set(RUN_DAYS_KEY, '[1, 2]');
    storage.set(CHALLENGE_KEY, '"nope"');
    expect(localActivity()).toEqual([]);
  });
});
