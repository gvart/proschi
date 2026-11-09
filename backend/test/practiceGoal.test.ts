import { beforeEach, describe, expect, it } from 'vitest';
import { call, resetDatabase, signedInUser } from './helpers';

/** The practice page's learning goal kept with the account (users.practice_goal, docs/design/paid-plans.md P43). */

const me = async (token: string) => ((await (await call('/api/me', { token })).json()) as { user: { practiceGoal: unknown } }).user.practiceGoal;
const patch = (token: string, body: unknown) => call('/api/me', { method: 'PATCH', token, body });

describe('practice goal', () => {
  beforeEach(resetDatabase);

  it('is null until set, then kept, and other changes leave it as it is', async () => {
    const { token } = await signedInUser();
    expect(await me(token)).toBeNull();
    const res = await patch(token, { practiceGoal: { goals: ['habit', 'interview'], asked: true, streak: false } });
    expect(res.status).toBe(200);
    // In the page's order.
    expect(await res.json()).toMatchObject({ user: { practiceGoal: { goals: ['interview', 'habit'], asked: true, streak: false } } });
    expect(await me(token)).toEqual({ goals: ['interview', 'habit'], asked: true, streak: false });
    expect((await patch(token, { displayName: 'Ada' })).status).toBe(200);
    expect(await me(token)).toEqual({ goals: ['interview', 'habit'], asked: true, streak: false });
    expect((await patch(token, { practiceGoal: { goals: [], asked: true } })).status).toBe(200);
    expect(await me(token)).toEqual({ goals: [], asked: true });
  });

  it('refuses anything but a goal', async () => {
    const { token } = await signedInUser();
    for (const practiceGoal of [
      null,
      'habit',
      [],
      { goals: ['habit'] },
      { goals: 'habit', asked: true },
      { goals: ['fun'], asked: true },
      { goals: ['habit', 'habit'], asked: true },
      { goals: [], asked: 'yes' },
      { goals: [], asked: true, streak: 1 },
      { goals: [], asked: true, extra: 'x' },
    ]) {
      expect((await patch(token, { practiceGoal })).status, JSON.stringify(practiceGoal)).toBe(400);
    }
    expect(await me(token)).toBeNull();
  });

  it('is in the data export', async () => {
    const { token } = await signedInUser();
    await patch(token, { practiceGoal: { goals: ['solve'], asked: true } });
    const data = (await (await call('/api/me/export', { token })).json()) as { user: { practiceGoal: unknown } };
    expect(data.user.practiceGoal).toEqual({ goals: ['solve'], asked: true });
  });
});
