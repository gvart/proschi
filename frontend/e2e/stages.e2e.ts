import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test, waitForCanvas } from './fixtures';

/**
 * A practice problem worked through in stages (docs/design/paid-plans.md
 * P50), on the roadmap only (P51): the lesson, then Clarify, Estimate, Design and Wrap-up, each asking
 * for your own answer before it shows the facts or the worked answer. Going
 * back keeps the notes, and a reload lands where you were. With
 * STAGES_SHOTS=<dir>, the walk-through saves a screenshot of every stage.
 */

const SHOTS = process.env.STAGES_SHOTS;
const SOLUTION = readFileSync(new URL('../src/practice/problems/url-shortener/solution.proschi', import.meta.url), 'utf8');

test.use({ lessons: 'fresh', stages: 'fresh' });

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};
const rail = (page: Page) => page.getByRole('navigation', { name: 'Stages' });
const next = (page: Page) => page.getByTestId('stage-next');

for (const [device, viewport] of [
  ['desktop', { width: 1440, height: 900 }],
  ['phone', { width: 390, height: 844 }],
] as const) {
  test.describe(device, () => {
    test.use({ viewport, ...(device === 'phone' ? { hasTouch: true, isMobile: true } : {}) });

    test('the lesson, then Clarify, Estimate, Design and Wrap-up, to a solve', async ({ page }) => {
      // The design is the reference solution already, so the walk-through can end solved.
      await page.addInitScript((source) => {
        if (!localStorage.getItem('proschi.practice')) localStorage.setItem('proschi.practice', JSON.stringify({ 'url-shortener': { status: 'attempted', source } }));
      }, SOLUTION);
      await page.goto('practice/#/roadmap/url-shortener');

      // A first visit opens on Clarify, even with the lesson unread (P52), with the stages on top.
      await expect(page.getByTestId('stage-clarify')).toBeVisible();
      await expect(page.getByRole('article', { name: 'Lesson' })).toHaveCount(0);
      await expect(rail(page).getByRole('button')).toHaveText(['1Lesson', '2Clarify', '3Estimate', '4Design', '5Wrap-up']);
      await expect(rail(page).getByRole('button', { name: 'Estimate' })).toBeDisabled();
      // The lesson is one click away in the rail, and leads back to Clarify.
      await rail(page).getByRole('button', { name: 'Lesson' }).click();
      await expect(page.getByRole('article', { name: 'Lesson' })).toBeVisible();
      await expect(page.locator('.cm-content')).toHaveCount(0);
      await expect(next(page)).toHaveText('Next: Clarify');
      await shot(page, `${device}-1-lesson`);
      await next(page).click();

      // Clarify: the brief without its scale, your questions first, then the interviewer's answers.
      await expect(page.getByTestId('brief')).toBeVisible();
      await expect(page.getByTestId('brief')).not.toContainText('10k');
      const compare = page.getByRole('button', { name: 'Compare with the interviewer’s answers' });
      await expect(compare).toBeDisabled();
      await expect(page.getByTestId('clarify-answers')).toHaveCount(0);
      await shot(page, `${device}-2-clarify`);
      await page.getByLabel('Your clarifying questions and assumptions').fill('How many redirects a second at peak?\nHow fast must a redirect be?');
      await compare.click();
      const answers = page.getByTestId('clarify-answers');
      await expect(answers).toContainText('10k redirects a second');
      await answers.getByRole('checkbox', { name: /How many redirects/ }).check();
      await expect(answers).toContainText('You covered 1 of 6');
      await answers.scrollIntoViewIfNeeded();
      await shot(page, `${device}-3-clarify-compared`);
      await next(page).click();

      // Estimate: the facts beside the worksheet; the worked answer only after Check.
      await expect(page.getByTestId('requirements')).toBeVisible();
      const rows = page.getByTestId('worksheet-row');
      await expect(rows).toHaveCount(3);
      await expect(page.getByTestId('worksheet-result')).toHaveCount(0);
      await shot(page, `${device}-4-estimate`);
      await rows.nth(0).getByRole('textbox', { name: 'Your estimate' }).fill('100 * 86400 * 365');
      await rows.nth(0).getByRole('button', { name: 'Check' }).click();
      await expect(rows.nth(0).getByTestId('worksheet-result')).toContainText('In range');
      await expect(page.getByTestId('worksheet-score')).toContainText('1 of 3 in range');
      await shot(page, `${device}-5-estimate-checked`);
      await next(page).click();

      // Design: the whiteboard, with the guide (on phones a tab of its own).
      await waitForCanvas(page);
      await expect(page.locator('.cm-content')).toHaveCount(0);
      await shot(page, `${device}-6-design`);
      if (device === 'phone') {
        await page.getByRole('tab', { name: 'Guide' }).click();
        await shot(page, `${device}-6b-design-guide`);
      }
      await page.getByTestId('design-guide').getByRole('button', { name: 'Run tests' }).click();
      await expect(page.getByTestId('design-tests-line')).toContainText(/All \d+ tests pass/);
      if (device === 'phone') await page.getByRole('tab', { name: 'Whiteboard' }).click();
      await expect(page.getByTestId('checks')).toContainText(/All \d+ checks pass/);
      await shot(page, `${device}-7-design-checks`);

      // The full editor is one click away, and back.
      if (device === 'phone') await page.getByRole('tab', { name: 'Guide' }).click();
      await page.getByRole('button', { name: 'Open the full editor' }).click();
      await expect(page.locator('[data-view="editor"]')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Run tests' })).toBeVisible();
      await shot(page, `${device}-8-full-editor`);
      await page.getByRole('button', { name: /Whiteboard/ }).first().click();
      await expect(page.getByTestId('design-guide')).toBeAttached();
      await next(page).click();

      // Wrap-up: solved, a recall prompt, and where to go next.
      await expect(page.getByTestId('wrapup-status')).toContainText('Solved');
      await page.getByLabel(/what breaks first at 10×/).fill('The single database, under the redirects.');
      await expect(page.getByTestId('wrapup-next')).toContainText('Next on the roadmap');
      await expect(page.getByRole('link', { name: /Practice this as a mock interview/ })).toHaveAttribute('href', '#/interview?problem=url-shortener');
      await shot(page, `${device}-9-wrapup`);
      await page.getByTestId('stage-wrapup').evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await shot(page, `${device}-10-wrapup-end`);
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('proschi.practice')!)['url-shortener'].status)).toBe('solved');
    });
  });
}

test('going back keeps the notes, and a reload lands where you were', async ({ page }) => {
  await page.goto('practice/#/roadmap/url-shortener');
  // A first visit: straight to Clarify.
  await expect(page.getByTestId('stage-clarify')).toBeVisible();
  const notes = page.getByLabel('Your clarifying questions and assumptions');
  await notes.fill('Is there a budget?');
  await page.getByRole('button', { name: 'Compare with the interviewer’s answers' }).click();
  await next(page).click();
  const row = page.getByTestId('worksheet-row').first();
  await row.getByRole('textbox', { name: 'Your estimate' }).fill('3B');
  await row.getByRole('button', { name: 'Check' }).click();
  await expect(row.getByTestId('worksheet-result')).toBeVisible();

  // Back to Clarify from the rail: the notes are there, still editable, and the answers stay shown.
  await rail(page).getByRole('button', { name: 'Clarify' }).click();
  await expect(notes).toHaveValue('Is there a budget?');
  await expect(page.getByTestId('clarify-answers')).toBeVisible();
  await notes.fill('Is there a budget?\nHow fast must a redirect be?');
  // Estimate is still open in the rail, its check kept.
  await rail(page).getByRole('button', { name: 'Estimate' }).click();
  await expect(page.getByTestId('worksheet-row').first().getByTestId('worksheet-result')).toContainText('In range');
  await expect(rail(page).getByRole('button', { name: 'Design' })).toBeDisabled();

  await page.reload();
  await expect(page.getByTestId('stage-estimate')).toBeVisible();
  await rail(page).getByRole('button', { name: 'Clarify' }).click();
  await expect(notes).toHaveValue('Is there a budget?\nHow fast must a redirect be?');
  // The lesson stays a click away in the rail, and leads back to the stage you were on.
  await rail(page).getByRole('button', { name: 'Lesson' }).click();
  await expect(page.getByRole('article', { name: 'Lesson' })).toBeVisible();
  await expect(next(page)).toHaveText('Continue: Clarify');
});

test('a problem opened from Problems is the plain workspace: no stage bar, no lesson gate', async ({ page }) => {
  await page.goto('practice/#/url-shortener');
  await expect(page.locator('[data-view="editor"]')).toBeVisible();
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run tests' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Stages' })).toHaveCount(0);
  await expect(page.getByTestId('stage-next')).toHaveCount(0);
  await expect(page.getByRole('article', { name: 'Lesson' })).toHaveCount(0);
  // The modes and the lesson are where they were before the stages.
  await expect(page.getByRole('link', { name: 'Interview mode' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lesson' }).first()).toBeVisible();
});
