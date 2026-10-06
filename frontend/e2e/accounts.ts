import type { Page } from '@playwright/test';

/** GET /api/me's answer (Me in src/services/api.ts, which this tsconfig cannot compile). */
interface Me {
  user: { id: string; displayName: string; publicProfile: boolean; dailyGoal?: number; providers?: string[] };
  progress: Record<string, unknown>;
}

/**
 * A signed-in session for the build with accounts (`npm run build:accounts`,
 * the `accounts` project in playwright.config.ts): page.route answers the
 * API the practice page reads on load, so no Worker is needed. Requests it
 * does not know get a 404, which fails the test as a console error.
 */
export const SIGNED_IN: Me = {
  user: { id: 'u-e2e', displayName: 'gvart', publicProfile: true, dailyGoal: 10, providers: ['github'] },
  progress: {},
};

/** GET /api/game/me for a player with no progress yet. */
export const GAME_ME = {
  meta: { v: 1, blueprints: 0, unlocked: [], perks: {}, equipped: [], scenarios: {}, seen: [], runs: 0 },
  best: {},
  daily: { day: new Date().toISOString().slice(0, 10), scenario: 'shortly' },
};

export async function mockSignedIn(page: Page, me: Me = SIGNED_IN): Promise<void> {
  const answers: [RegExp, unknown][] = [
    [/^\/api\/me$/, me],
    [/^\/auth\/providers$/, { providers: ['github', 'google'] }],
    [/^\/api\/me\/email$/, { email: null }],
    [/^\/api\/me\/activity$/, { day: '', goal: { reviews: me.user.dailyGoal ?? 10, solves: 1 }, days: [] }],
    [/^\/api\/me\/achievements$/, { achievements: [], skills: { readiness: 0, topics: [], weakest: [] }, stats: { reviews: 0, mastered: 0, longestStreak: 0, estimateStreak: 0, solved: 0 } }],
    [/^\/api\/cards\/state$/, { states: {}, today: { reviews: 0, new: 0 } }],
    [/^\/api\/stats$/, { problems: {}, solvers: 0 }],
    [/^\/api\/stats\/[^/]+$/, { attempted: 0, solved: 0, medianRunsToSolve: null, costUsd: null, p99Ms: null, you: null }],
    [/^\/api\/leaderboard$/, { problems: 0, entries: [] }],
    [/^\/api\/problems\/[^/]+\/leaderboard$/, { problem: '', metric: 'cost', players: 0, entries: [], you: null }],
    [/^\/api\/game\/me$/, GAME_ME],
    // Today's challenge, not played yet (the practice hub's Today panel reads it; challenge.accounts.e2e.ts mocks a real one).
    [/^\/api\/challenge\/today$/, { day: new Date().toISOString().slice(0, 10), cardIds: [], endsAt: 0, maxScore: 600, attempt: null }],
    [/^\/api\/game\/leaderboard$/, { board: 'daily', title: 'Daily run', players: 0, entries: [] }],
    // Cloud sync of the editor's diagrams: an empty account (editor.accounts.e2e.ts mocks a real one).
    [/^\/api\/me\/documents$/, { documents: [], cursor: 0, limit: 5, used: 0 }],
  ];
  await page.route(
    (url) => /^\/(api|auth)\//.test(url.pathname),
    (route) => {
      const { pathname } = new URL(route.request().url());
      if (route.request().method() === 'PUT' && pathname.startsWith('/api/me/documents/')) {
        // Every save is taken, as a first version.
        const body = route.request().postDataJSON() as { name: string; source: string; imports: Record<string, string> | null; baseVersion: number };
        const id = decodeURIComponent(pathname.split('/')[4]);
        return route.fulfill({ json: { document: { id, name: body.name, source: body.source, imports: body.imports, version: body.baseVersion + 1, updatedAt: Date.now(), deletedAt: null } } });
      }
      const answer = route.request().method() === 'GET' ? answers.find(([path]) => path.test(pathname)) : undefined;
      return answer ? route.fulfill({ json: answer[1] }) : route.fulfill({ status: 404, json: { error: `not mocked: ${pathname}` } });
    },
  );
}
