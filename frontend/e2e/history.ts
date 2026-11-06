import type { Page } from '@playwright/test';
import { SIGNED_IN } from './accounts';
import { FAIL_VERDICT, PASS_VERDICT } from './aiInterview';

/** Mocks of interview history and the AI roadmap's picks (backend/src/interviews.ts, backend/src/roadmap.ts), for history.accounts.e2e.ts. */

const DAY = 86_400_000;
export const PRO = { ...SIGNED_IN, user: { ...SIGNED_IN.user, plan: 'pro' } };
export const FREE = { ...SIGNED_IN, user: { ...SIGNED_IN.user, plan: 'free' } };

const PROBLEMS = ['url-shortener', 'pastebin', 'rate-limiter', 'shopping-cart', 'news-feed', 'chat'];
/** Six sessions, newest first, the scores rising over time. */
export const SESSIONS = PROBLEMS.map((problem, i) => {
  const age = i * 5;
  const lift = Math.max(0, 3 - Math.floor(i / 2));
  return {
    id: `iv-${i + 1}`,
    problem,
    minutes: 45,
    startedAt: Date.UTC(2026, 10, 5) - age * DAY,
    endedAt: Date.UTC(2026, 10, 5) - age * DAY + 45 * 60_000,
    passed: i < 2,
    scores: { requirements: Math.min(5, 2 + lift), estimation: 1 + lift, design: Math.min(5, 2 + lift), tradeoffs: 2 + Math.min(1, lift), communication: Math.min(5, 3 + lift) },
  };
});

export const PICKS = [
  { kind: 'problem', id: 'pastebin', reason: 'Your storage estimate skipped retention; Pastebin makes you size five years of pastes.' },
  { kind: 'cards', id: 'estimation', reason: 'Estimation is your lowest score, at 3 of 5.' },
  { kind: 'problem', id: 'rate-limiter', reason: 'You named no failure mode for the cache; this one is all about what happens under load.' },
];

const next = { createdAt: Date.UTC(2026, 10, 5), source: 'interview', sourceId: 'iv-1', picks: PICKS };

/**
 * The history, the picks and one session's verdict. Register after
 * mockSignedIn: the later route wins. `picking`: the picks are still being
 * made (the newest answer names `iv-1` as pending, and each session ended
 * just now); asked for by interview, they arrive on the `arriveOn`-th ask
 * (never when absent).
 */
export async function mockHistory(page: Page, history: { full: boolean; total: number; sessions: typeof SESSIONS }, picking?: { arriveOn?: number }): Promise<string[]> {
  const asked: string[] = [];
  let asks = 0;
  await page.route(
    (url) => /^\/api\/(interviews|roadmap)(\/|$)/.test(url.pathname),
    (route) => {
      const url = new URL(route.request().url());
      asked.push(url.pathname + url.search);
      if (url.pathname === '/api/interviews/history') return route.fulfill({ json: history });
      if (url.pathname === '/api/roadmap/next') {
        if (!picking) return route.fulfill({ json: { next } });
        if (!url.searchParams.has('interview')) return route.fulfill({ json: { next: null, pending: 'iv-1' } });
        asks += 1;
        return route.fulfill({ json: { next: picking.arriveOn !== undefined && asks >= picking.arriveOn ? next : null } });
      }
      if (url.pathname === '/api/interviews') return route.fulfill({ json: { interviews: [], credits: { total: 1, monthly: 0, trial: 1, pack: 0, period: '2026-11' } } });
      const id = url.pathname.split('/')[3];
      const s = SESSIONS.find((x) => x.id === id);
      if (!s) return route.fulfill({ status: 404, json: { error: 'Not found' } });
      const ended = picking ? { endedAt: Date.now() } : {};
      return route.fulfill({ json: { interview: { ...s, ...ended, status: 'finished', verdict: s.passed ? PASS_VERDICT : FAIL_VERDICT, messages: [] } } });
    },
  );
  return asked;
}
