import { mockSignedIn, SIGNED_IN } from './accounts';
import { answerDialog, expect, STAGES_KEY, test } from './fixtures';

/**
 * Reset on a practice problem, in the build with accounts (API mocked): on
 * any stage it starts the problem over (the design back to the starter, the
 * stage notes gone, also the design the account keeps), and the problem
 * stays solved, after a reload too.
 */

test.use({ stages: 'fresh' });

const PROGRESS_KEY = 'proschi.practice';
const MINE = 'app: Service\n';

test('Reset on Clarify clears the notes and the design, and the problem stays solved', async ({ page }) => {
  // The account keeps the solved design until the reset asks it to forget it.
  const server: Record<string, unknown> = { status: 'solved', runs: 3, runsToSolve: 3, source: MINE };
  await mockSignedIn(page, { ...SIGNED_IN, progress: { 'url-shortener': server } });
  const cleared: string[] = [];
  await page.route('**/api/problems/*/source', (route) => {
    cleared.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    delete server.source;
    return route.fulfill({ status: 204 });
  });
  await page.addInitScript(
    ([stagesKey, progressKey, mine]) => {
      if (localStorage.getItem(stagesKey)) return;
      localStorage.setItem(stagesKey, JSON.stringify({ stage: 'clarify', reached: 'wrapup', briefRead: true, questions: 'Who shortens links?', reflection: 'The cache.' }));
      localStorage.setItem(progressKey, JSON.stringify({ 'url-shortener': { status: 'solved', source: mine } }));
    },
    [`${STAGES_KEY}url-shortener`, PROGRESS_KEY, MINE],
  );
  await page.goto('practice/#/roadmap/url-shortener');
  const notes = page.getByLabel('Your clarifying questions and assumptions');
  await expect(notes).toHaveValue('Who shortens links?');
  const header = page.locator('.ps-header');
  await expect(header.getByLabel('Solved')).toBeVisible();

  await header.getByRole('button', { name: 'Reset' }).click();
  const dialog = page.locator('.ps-dialog');
  await expect(dialog).toContainText('your design, your stage notes and the last test run');
  await expect(dialog).toContainText('The problem stays solved and your XP stays.');
  await answerDialog(page, 'Start over');

  await expect(notes).toHaveValue('');
  await expect(header.getByLabel('Solved')).toBeVisible();
  // Only Clarify is open again: the later stages wait for your own thinking.
  await expect(page.getByRole('navigation', { name: 'Steps' }).getByRole('button', { name: 'Wrap-up' })).toBeDisabled();
  await expect.poll(() => cleared).toEqual(['DELETE /api/problems/url-shortener/source']);
  const stored = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}'), PROGRESS_KEY);
  await expect.poll(stored).toEqual({ 'url-shortener': { status: 'solved' } });

  // A reload (the account's progress joins the browser's again) does not bring the design back.
  await page.reload();
  await expect(notes).toHaveValue('');
  await expect(header.getByLabel('Solved')).toBeVisible();
  await expect.poll(stored).toEqual({ 'url-shortener': { status: 'solved' } });
});
