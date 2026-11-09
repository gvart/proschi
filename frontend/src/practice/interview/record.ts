import { soloCounts, type InterviewDone, type SoloEffort } from '../../learn/mastery';
import { readSoloResults, type SoloResults } from '../../learn/soloInterview';
import { api } from '../../services/api';
import type { InterviewSummary } from '../modes/session';
import { loadHistory } from '../modes/store';

/**
 * Finished mock interviews as progress (docs/design/paid-plans.md P48). One
 * on your own is kept in this browser's history (modes/store.ts); signed in,
 * it also goes to the account (POST /api/me/interviews/solo, which keeps
 * each session once, as it was done, and decides itself whether it counts),
 * so the server's badges, level and skill map count it as they count the AI
 * interviews. Only one with enough effort counts (soloCounts in
 * src/learn/mastery.ts).
 */

/** On your own, on time: within the minutes chosen, with every check passing. */
export const soloOnTime = (s: Pick<InterviewSummary, 'overtime' | 'tests'>): boolean => !s.overtime && s.tests?.solved === true;

/** What a summary did, for soloCounts: the time, whether Design was reached, and whether anything was drawn. */
export const soloEffort = (s: Pick<InterviewSummary, 'totalMs' | 'phases' | 'drew'>): SoloEffort => ({
  totalMs: s.totalMs,
  reachedDesign: s.phases.design > 0 || s.phases.wrapup > 0,
  drew: s.drew === true,
});

/** What a summary did beyond the effort, as the account keeps it (P53): the trend per skill and the report read it. */
export const soloResults = (s: Pick<InterviewSummary, 'phases' | 'questions' | 'estimates' | 'tests' | 'checklist'>): SoloResults => ({
  phases: { clarify: Math.round(s.phases.clarify), estimate: Math.round(s.phases.estimate), design: Math.round(s.phases.design), wrapup: Math.round(s.phases.wrapup) },
  questions: { ...s.questions },
  estimates: { answered: s.estimates.answered, correct: s.estimates.correct, total: s.estimates.total },
  ...(s.tests ? { tests: { passed: s.tests.passed, total: s.tests.total } } : {}),
  checklist: { ...s.checklist },
});

/** A summary's results as the server takes them, or undefined for an old or damaged one (it is sent without them, and still counts). */
export function checkedSoloResults(s: InterviewSummary): SoloResults | undefined {
  try {
    return readSoloResults(soloResults(s));
  } catch {
    return undefined;
  }
}

/** Whether an interview on your own counts towards progress. */
export const soloSummaryCounts = (s: Pick<InterviewSummary, 'totalMs' | 'phases' | 'drew'>): boolean => soloCounts(soloEffort(s));

/** A design changed from the starter: anything but whitespace and `#` comments differs. */
export function drewOn(source: string | undefined, starter: string): boolean {
  const strip = (t: string) => t.replace(/^\s*#.*$/gm, '').replace(/\s+/g, '');
  return source !== undefined && strip(source) !== strip(starter);
}

/** This browser's interviews on your own that count, as the badges count them (localAchievements.ts). */
export function soloInterviewsDone(history: readonly InterviewSummary[] = loadHistory()): InterviewDone[] {
  return history.filter(soloSummaryCounts).map((s) => ({ problem: s.problem, mode: 'solo', passed: false, onTime: soloOnTime(s) }));
}

/** Sends interviews on your own to the account, as they were done; a failure is dropped: the next sign-in sends them again. */
export async function sendSoloInterviews(history: readonly InterviewSummary[]): Promise<void> {
  if (history.length === 0) return;
  const sessions = history.slice(-50).map((s) => {
    const results = checkedSoloResults(s);
    return { problem: s.problem, startedAt: s.startedAt, durationMin: s.durationMin, ...soloEffort(s), solved: s.tests?.solved === true, ...(results ? { results } : {}) };
  });
  try {
    await api('/api/me/interviews/solo', { method: 'POST', body: { sessions } });
  } catch {
    // Kept in this browser.
  }
}
