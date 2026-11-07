import { describe, expect, it, vi } from 'vitest';
import { mergeAccountGoal, onGoalChange, setGoal, type GoalState } from './goal';

/** The goal as it is now (setGoal hands it to its update). */
function currentGoal(): GoalState {
  let seen: GoalState | undefined;
  setGoal((g) => (seen = g));
  return seen!;
}

describe('the learning goal with the account', () => {
  it('is not sent while there is nothing to keep, or the Worker has no goal field', () => {
    expect(mergeAccountGoal(null)).toBeUndefined();
    setGoal(() => ({ goals: ['habit'], asked: true }));
    expect(mergeAccountGoal(undefined)).toBeUndefined();
  });

  it("copies this browser's goal to an account without one", () => {
    expect(mergeAccountGoal(null)).toEqual({ goals: ['habit'], asked: true });
  });

  it("replaces this browser's goal with the account's", () => {
    expect(mergeAccountGoal({ goals: ['interview', 'nope'], asked: true, streak: false })).toBeUndefined();
    expect(currentGoal()).toEqual({ goals: ['interview'], asked: true, streak: false });
  });

  it('sends every change while signed in, and none after', () => {
    const send = vi.fn();
    onGoalChange(send);
    setGoal((g) => ({ ...g, goals: ['solve'] }));
    expect(send).toHaveBeenLastCalledWith({ goals: ['solve'], asked: true, streak: false });
    onGoalChange(undefined);
    const calls = send.mock.calls.length;
    setGoal((g) => ({ ...g, goals: [] }));
    expect(send).toHaveBeenCalledTimes(calls);
  });
});
