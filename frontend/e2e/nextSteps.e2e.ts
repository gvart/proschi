import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * The free, rule-based "Your next steps" (learn/nextSteps.ts) in the build
 * without accounts: from this browser's progress and the mistake its last
 * failed run matched, on the roadmap only (the home is just the problems).
 */

async function withProgress(page: Page) {
  await page.addInitScript((now) => {
    localStorage.setItem('proschi.practice', JSON.stringify({ pastebin: { status: 'attempted', source: 'x' }, 'url-shortener': { status: 'solved' } }));
    localStorage.setItem('proschi.practice.mistakes', JSON.stringify([{ problem: 'pastebin', title: 'Pastes kept only in the cache', at: now }]));
  }, Math.floor(Date.now() / 1000));
}

test.describe('Your next steps', () => {
  test('the roadmap lists a retry for the last mistake, today’s challenge and a problem for a weak skill, each linked', async ({ page }) => {
    await withProgress(page);
    await page.goto('practice/#/roadmap');
    const card = page.getByRole('region', { name: 'Your next steps' });
    await expect(card.getByText('From your skill map, the cards due and your recent mistakes.')).toBeVisible();
    await expect(card.getByTestId('roadmap-picks')).toHaveCount(0);
    const steps = card.getByTestId('next-steps').getByRole('link');
    await expect(steps.nth(0)).toContainText('Retry Pastebin');
    await expect(steps.nth(0)).toContainText('You missed: Pastes kept only in the cache.');
    // A problem's step opens the interview set-up with it chosen, not the problem.
    await expect(steps.nth(0)).toHaveAttribute('href', '#/interview?problem=pastebin');
    await expect(steps.nth(1)).toContainText('Do today’s daily challenge');
    await expect(steps.nth(1)).toHaveAttribute('href', '#/challenge');
    await expect(steps.nth(2)).toContainText(/^.*Try .+Practises .+, your weakest skill \(\d+% mastered\)\./);
    await expect(steps.nth(2)).toHaveAttribute('href', /^#\/interview\?problem=[a-z0-9-]+$/);
    // A solved problem is never suggested.
    await expect(card).not.toContainText('URL Shortener');

    await steps.nth(0).click();
    await expect(page).toHaveURL(/#\/interview\?problem=pastebin$/);
    // The set-up's first screen (the problem, without an interviewer in this build), with Pastebin chosen.
    await expect(page.getByTestId('interview-setup')).toHaveAttribute('data-step', 'problem');
    await expect(page.getByRole('radio', { name: 'Choose a problem' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('chosen-problem')).toContainText('Pastebin');
  });

  test('never on the home, with or without progress', async ({ page }) => {
    await page.goto('practice/');
    await expect(page.getByRole('link', { name: /URL Shortener/ }).first()).toBeVisible();
    await expect(page.getByText('Your next steps')).toHaveCount(0);

    await withProgress(page);
    await page.addInitScript(() => localStorage.setItem('proschi.practice.goal', JSON.stringify({ goals: ['habit', 'interview'], asked: true })));
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Also today' })).toBeVisible();
    await expect(page.getByText('Your next steps')).toHaveCount(0);
    await expect(page.getByTestId('next-steps')).toHaveCount(0);
  });
});
