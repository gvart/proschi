// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { interviewReducer, startSession, type InterviewSummary } from './session';
import { appendHistory, discardSession, loadHistory, loadSession, saveSession } from './store';
import { loadDesign, saveDesign } from '../interview/prefs';
import { loadBriefRead, loadWorksheet, saveBriefRead, saveWorksheet } from '../interview/stages';

const ROWS = [{ id: 'q0', label: 'Writes?', expression: '100 * 2', unit: '/s' }];

describe('starting an interview on your own over', () => {
  beforeEach(() => localStorage.clear());

  it('throws away the session in progress, its design, worksheet and brief, and keeps the history', () => {
    const session = interviewReducer(startSession('url-shortener', 45, 1000), { type: 'ask', index: 0 });
    const key = `url-shortener.${session.startedAt}`;
    saveSession(session, 'url-shortener');
    saveDesign('url-shortener', 'app: Service');
    saveWorksheet(key, ROWS);
    saveBriefRead(key);
    const earlier = { problem: 'url-shortener', startedAt: 1 } as InterviewSummary;
    appendHistory(earlier);
    // Another problem's interview is not touched.
    saveSession(startSession('chat', 30, 2000), 'chat');

    discardSession('url-shortener');

    expect(loadSession('url-shortener')).toBeUndefined();
    expect(loadDesign('url-shortener')).toBeUndefined();
    expect(loadWorksheet(key)).toBeUndefined();
    expect(loadBriefRead(key)).toBe(false);
    expect(loadHistory()).toEqual([earlier]);
    expect(loadSession('chat')).toBeDefined();
  });

  it('leaves a finished interview alone', () => {
    const finished = interviewReducer(startSession('url-shortener', 45, 1000), { type: 'finish', now: 5000 });
    saveSession(finished, 'url-shortener');
    saveDesign('url-shortener', 'app: Service');
    discardSession('url-shortener');
    expect(loadSession('url-shortener')).toEqual(finished);
    expect(loadDesign('url-shortener')).toBe('app: Service');
  });
});
