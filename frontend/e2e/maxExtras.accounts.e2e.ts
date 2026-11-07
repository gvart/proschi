import type { Page } from '@playwright/test';
import { mockSignedIn } from './accounts';
import { mockInterviews } from './aiInterview';
import { expect, test } from './fixtures';

/**
 * Max's extras on the mock interview (docs/design/paid-plans.md P31; build
 * with accounts, API mocked): the Deep verdict toggle on the start screen,
 * the "Deep verdict" mark on the verdict, and its printable report. Pro sees
 * neither, only a quiet hint on the start screen.
 */

async function toStart(page: Page) {
  await page.goto('practice/#/url-shortener');
  await page.getByRole('button', { name: 'Interview mode' }).click();
  const start = page.getByRole('region', { name: 'Interview mode' });
  await start.getByRole('radio', { name: /Mock interview/ }).click();
  return start;
}

test('Max: a Deep verdict costs more, says so on the verdict, and the report prints without the app around it', async ({ page, errors }) => {
  await mockSignedIn(page);
  const mock = await mockInterviews(page, { plan: 'max', credits: 2200, replies: [{ text: 'Seven of ten tests pass. Why this cache?' }] });
  const start = await toStart(page);
  const deep = start.getByRole('checkbox', { name: /Deep verdict/ });
  await expect(deep).not.toBeChecked();
  await expect(start.getByTestId('ai-credits')).toContainText('about 45–60 credits for 45 min');
  await deep.check();
  // Only the verdict runs Deep: the estimate adds its extra (15–55 credits, ×2).
  await expect(start.getByTestId('ai-credits')).toContainText('about 60–115 credits for 45 min');
  await start.getByRole('button', { name: 'Start a mock interview' }).click();
  await page.getByRole('button', { name: 'I agree, start the interview' }).click();
  expect(mock.starts).toEqual([{ replace: false, deep: true }]);

  const chat = page.getByRole('region', { name: 'Mock interview', exact: true });
  await chat.getByRole('textbox', { name: 'Your answer' }).fill('Here is my design.');
  await chat.getByRole('button', { name: 'Send my design' }).click();
  await expect(chat.getByText(/Why this cache\?/)).toBeVisible();
  page.once('dialog', (d) => void d.accept());
  await chat.getByRole('button', { name: 'Finish and get the verdict' }).click();

  const verdict = page.getByRole('region', { name: 'Interview verdict' });
  await expect(verdict.getByTestId('verdict-deep')).toHaveText('Deep verdict');
  await verdict.getByRole('button', { name: 'Print report' }).click();

  const report = page.getByRole('dialog', { name: 'Interview report' });
  await expect(report.getByRole('heading', { level: 1 })).toHaveText('URL Shortener');
  await expect(report.getByTestId('report-result')).toHaveText('Pass');
  await expect(report.getByTestId('report-deep')).toHaveText('Deep verdict');
  await expect(report.getByText(/storage estimate skipped the 5-year retention/).first()).toBeVisible();
  await expect(report.getByText('Tests: 2 of 3 passed')).toBeVisible();
  await expect(report.getByTestId('report-tests').getByRole('listitem')).toHaveCount(3);
  await expect(report.getByTestId('report-diagram').locator('.react-flow__node').first()).toBeVisible();

  // In print, only the sheet: no toolbar, no app behind it, light colours.
  await page.emulateMedia({ media: 'print' });
  await expect(report.getByRole('button', { name: /Print or save as PDF/ })).toBeHidden();
  await expect(page.locator('#root')).toBeHidden();
  await expect(report.getByTestId('report-result')).toBeVisible();
  await page.emulateMedia({ media: 'screen' });

  await page.evaluate(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => void ((window as unknown as { printed: number }).printed += 1);
  });
  await report.getByRole('button', { name: /Print or save as PDF/ }).click();
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
  await page.keyboard.press('Escape');
  await expect(report).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Pro: no Deep toggle (a quiet hint instead) and no report', async ({ page }) => {
  await mockSignedIn(page);
  const mock = await mockInterviews(page, { plan: 'pro', credits: 800, replies: [] });
  const start = await toStart(page);
  await expect(start.getByRole('checkbox', { name: /Deep verdict/ })).toHaveCount(0);
  await expect(start.getByTestId('interview-deep-hint')).toContainText('Deep verdicts come with Max');
  await expect(start.getByTestId('interview-deep-hint').getByRole('link', { name: 'See Max' })).toHaveAttribute('href', '../pricing/');
  await start.getByRole('button', { name: 'Start a mock interview' }).click();
  await page.getByRole('button', { name: 'I agree, start the interview' }).click();
  expect(mock.starts).toEqual([{ replace: false, deep: false }]);
  const chat = page.getByRole('region', { name: 'Mock interview', exact: true });
  page.once('dialog', (d) => void d.accept());
  await chat.getByRole('button', { name: 'Finish and get the verdict' }).click();
  const verdict = page.getByRole('region', { name: 'Interview verdict' });
  await expect(verdict.getByTestId('verdict-result')).toHaveText('Pass');
  await expect(verdict.getByTestId('verdict-deep')).toHaveCount(0);
  await expect(verdict.getByRole('button', { name: 'Print report' })).toHaveCount(0);
});
