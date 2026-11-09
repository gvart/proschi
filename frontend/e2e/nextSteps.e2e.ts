import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * The free, rule-based "Your next steps" (learn/nextSteps.ts) in the build
 * without accounts: from this browser's progress and the mistake its last
 * failed run matched, on the practice home and the roadmap.
 */

async function withProgress(page: Page) {
  await page.addInitScript((now) => {
    localStorage.setItem('proschi.practice', JSON.stringify({ pastebin: { status: 'attempted', source: 'x' }, 'url-shortener': { status: 'solved' } }));
    localStorage.setItem('proschi.practice.mistakes', JSON.stringify([{ problem: 'pastebin', title: 'Pastes kept only in the cache', at: now }]));
  }, Math.floor(Date.now() / 1000));
}

test.describe('Your next steps', () => {
  test('the home lists a retry for the last mistake, today’s challenge and a problem for a weak skill, each linked', async ({ page }) => {
    await withProgress(page);
    await page.goto('practice/');
    const card = page.getByRole('region', { name: 'Your next steps' });
    const steps = card.getByRole('link');
    await expect(steps).toHaveCount(3);
    await expect(steps.nth(0)).toContainText('Retry Pastebin');
    await expect(steps.nth(0)).toContainText('You missed: Pastes kept only in the cache.');
    await expect(steps.nth(0)).toHaveAttribute('href', '#/pastebin');
    await expect(steps.nth(1)).toContainText('Do today’s daily challenge');
    await expect(steps.nth(1)).toHaveAttribute('href', '#/challenge');
    await expect(steps.nth(2)).toContainText(/^.*Try .+Practises .+, your weakest skill \(\d+% mastered\)\./);
    // A solved problem is never suggested.
    await expect(card).not.toContainText('URL Shortener');

    await steps.nth(1).click();
    await expect(page).toHaveURL(/#\/challenge$/);
  });

  test('the roadmap shows them without the AI picks', async ({ page }) => {
    await withProgress(page);
    await page.goto('practice/#/roadmap');
    const card = page.getByRole('region', { name: 'Your next steps' });
    await expect(card.getByText('From your skill map, the cards due and your recent mistakes.')).toBeVisible();
    await expect(card.getByTestId('next-steps').getByRole('link').first()).toContainText('Retry Pastebin');
    await expect(card.getByTestId('roadmap-picks')).toHaveCount(0);
  });

  test('nothing on the home before anything was started', async ({ page }) => {
    await page.goto('practice/');
    await expect(page.getByRole('link', { name: /URL Shortener/ }).first()).toBeVisible();
    await expect(page.getByTestId('home-next-steps')).toHaveCount(0);
  });
});
