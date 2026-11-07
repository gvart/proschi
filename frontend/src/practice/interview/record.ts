import type { InterviewDone } from '../../learn/mastery';
import { api } from '../../services/api';
import type { InterviewSummary } from '../modes/session';
import { loadHistory } from '../modes/store';

/**
 * Finished mock interviews as progress (docs/design/paid-plans.md P48). One
 * on your own is kept in this browser's history (modes/store.ts); signed in,
 * it also goes to the account (POST /api/me/interviews/solo, which keeps
 * each session once), so the server's badges, level and skill map count it
 * as they count the AI interviews.
 */

/** On your own, on time: within the minutes chosen, with every check passing. */
export const soloOnTime = (s: Pick<InterviewSummary, 'overtime' | 'tests'>): boolean => !s.overtime && s.tests?.solved === true;

/** This browser's interviews on your own, as the badges count them (localAchievements.ts). */
export function soloInterviewsDone(history: readonly InterviewSummary[] = loadHistory()): InterviewDone[] {
  return history.map((s) => ({ problem: s.problem, mode: 'solo', passed: false, onTime: soloOnTime(s) }));
}

/** Sends interviews on your own to the account; a failure is dropped: the next sign-in sends them again. */
export async function sendSoloInterviews(history: readonly InterviewSummary[]): Promise<void> {
  if (history.length === 0) return;
  const sessions = history.slice(-50).map((s) => ({ problem: s.problem, startedAt: s.startedAt, durationMin: s.durationMin, onTime: soloOnTime(s) }));
  try {
    await api('/api/me/interviews/solo', { method: 'POST', body: { sessions } });
  } catch {
    // Kept in this browser.
  }
}
