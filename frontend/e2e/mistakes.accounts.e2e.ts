import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { mockSignedIn } from './accounts';
import { expect, ONBOARDING_KEY, test, waitForCanvas } from './fixtures';

/**
 * Known mistakes follow the account (GET and POST /api/me/mistakes, API
 * mocked with one store for both browsers): a mistake a failed run matched
 * in one browser shows as "Retry …" in "Your next steps" in another browser
 * signed in to the same account.
 */

type Kept = { problem: string; id: string; title: string; at: number };

/** The account's mistakes, as the Worker keeps them: one per problem and mistake, the newest wins. */
async function mockMistakes(page: Page, store: Kept[]): Promise<void> {
  await page.route('**/api/me/mistakes', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { mistakes: [...store].sort((a, b) => b.at - a.at) } });
    const { mistakes } = route.request().postDataJSON() as { mistakes: Kept[] };
    for (const m of mistakes) {
      const i = store.findIndex((k) => k.problem === m.problem && k.id === m.id);
      if (i < 0) store.push(m);
      else if (m.at > store[i].at) store[i] = m;
    }
    return route.fulfill({ json: { stored: mistakes.length } });
  });
}

test('a mistake made in one browser shows the retry step in another', async ({ page, browser }) => {
  const store: Kept[] = [];

  // Browser one: the known wrong design, as if the learner had written it, fails its run.
  const source = await readFile(new URL('../src/practice/problems/url-shortener/wrong/miss-never-fills-cache.proschi', import.meta.url), 'utf8');
  await page.addInitScript((src) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('proschi.practice', JSON.stringify({ 'url-shortener': { status: 'attempted', source: src } }));
  }, source);
  await mockSignedIn(page);
  await mockMistakes(page, store);
  // This browser's design goes to the account on sign-in, and the run is counted.
  await page.route('**/api/me/import', (route) => route.fulfill({ json: { imported: 1 } }));
  await page.route('**/api/problems/url-shortener/runs', (route) => route.fulfill({ json: { progress: { status: 'attempted', runs: 1 } } }));
  await page.goto('practice/#/url-shortener');
  await waitForCanvas(page);
  await page.getByRole('button', { name: 'Run tests' }).click();
  await expect(page.getByRole('region', { name: 'Common mistake' }).getByRole('heading')).toHaveText('Common mistake: Cache misses that never fill the cache');
  await expect.poll(() => store.map((m) => `${m.problem}/${m.id}`)).toEqual(['url-shortener/miss-never-fills-cache']);

  // Browser two: nothing in its storage, signed in to the same account.
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  await other.addInitScript((key) => localStorage.setItem(key, JSON.stringify({ editor: true, practice: true })), ONBOARDING_KEY);
  const second = await other.newPage();
  const errors: string[] = [];
  second.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await mockSignedIn(second);
  await mockMistakes(second, store);
  await second.goto('practice/#/roadmap');
  const steps = second.getByRole('region', { name: 'Your next steps' }).getByTestId('next-steps');
  await expect(steps.getByRole('link').first()).toContainText('Retry URL Shortener');
  await expect(steps).toContainText('You missed: Cache misses that never fill the cache.');
  // Kept in that browser too, for when it is offline.
  expect(await second.evaluate(() => JSON.parse(localStorage.getItem('proschi.practice.mistakes') ?? '[]'))).toEqual([
    expect.objectContaining({ problem: 'url-shortener', id: 'miss-never-fills-cache' }),
  ]);
  expect(errors).toEqual([]);
  await other.close();
});
