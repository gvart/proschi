import { mockSignedIn } from './accounts';
import { expect, test } from './fixtures';
import { FREE, mockHistory, PRO, SESSIONS } from './history';

/**
 * Interview history on the progress page and the AI roadmap's "Next for you"
 * picks (build with accounts and paid plans, API mocked): Pro sees every
 * verdict, the trend per skill and the picks, each linked; the free plan sees
 * its latest verdict and the way to Pro.
 */

test.describe('Interview history', () => {
  test('Pro: every verdict, the trend per skill, and each verdict with its picks linked', async ({ page }) => {
    await mockSignedIn(page, PRO);
    const asked = await mockHistory(page, { full: true, total: SESSIONS.length, sessions: SESSIONS });
    await page.goto('practice/#/progress');

    const history = page.getByRole('region', { name: 'Interview history' });
    await expect(history.getByTestId('skill-trends').getByRole('figure')).toHaveCount(5);
    // The latest score of each skill, and the direction since the first session.
    await expect(history.getByTestId('trend-estimation')).toHaveText('4/5');
    await expect(history.getByTestId('trend-requirements')).toHaveText('5/5');
    await expect(history.getByText('Up from 2')).toBeVisible();
    // A table carries the numbers for screen readers, oldest first.
    await expect(history.getByRole('table', { name: /Scores per skill/ }).getByRole('row')).toHaveCount(SESSIONS.length + 1);

    const rows = history.getByTestId('history-list').getByRole('link');
    await expect(rows).toHaveCount(SESSIONS.length);
    await expect(rows.first()).toContainText('URL Shortener');
    await expect(rows.first()).toContainText('Nov 5, 2026');
    await expect(rows.first()).toContainText('Pass');
    await expect(rows.nth(2)).toContainText('Not yet');
    await expect(history.getByTestId('history-upgrade')).toHaveCount(0);

    await rows.nth(1).click();
    await expect(page).toHaveURL(/#\/progress\/interview\/iv-2$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Pastebin' })).toBeVisible();
    const verdict = page.getByRole('region', { name: 'Interview verdict' });
    await expect(verdict.getByTestId('verdict-result')).toHaveText('Pass');
    const picks = verdict.getByTestId('verdict-picks').getByRole('link');
    await expect(picks).toHaveCount(3);
    await expect(picks.nth(0)).toHaveAttribute('href', '#/roadmap/pastebin');
    await expect(picks.nth(1)).toHaveAttribute('href', '#/review/estimation');
    await expect(picks.nth(1)).toContainText('Estimation is your lowest score');
    expect(asked).toContain('/api/roadmap/next?interview=iv-2');
    await expect(verdict.getByRole('button', { name: 'Leave interview mode' })).toHaveCount(0);

    await page.getByRole('link', { name: 'Your progress' }).click();
    await expect(history.getByTestId('history-list')).toBeVisible();
  });

  test('free: the latest verdict only, and the way to Pro', async ({ page }) => {
    await mockSignedIn(page, FREE);
    await mockHistory(page, { full: false, total: SESSIONS.length, sessions: SESSIONS.slice(0, 1) });
    await page.goto('practice/#/progress');

    const history = page.getByRole('region', { name: 'Interview history' });
    await expect(history.getByText('Your latest interview')).toBeVisible();
    await expect(history.getByTestId('history-list').getByRole('link')).toHaveCount(1);
    await expect(history.getByTestId('skill-trends')).toHaveCount(0);
    const upgrade = history.getByTestId('history-upgrade');
    await expect(upgrade).toContainText('5 earlier interviews are kept.');
    await expect(upgrade.getByRole('link', { name: 'Upgrade to Pro' })).toHaveAttribute('href', '../pricing/');
  });
});

test.describe('Next for you', () => {
  test('Pro: the 3 picks on the roadmap, each with its reason and link', async ({ page }) => {
    await mockSignedIn(page, PRO);
    await mockHistory(page, { full: true, total: 0, sessions: [] });
    await page.goto('practice/#/roadmap');

    const card = page.getByRole('region', { name: 'Next for you' });
    await expect(card.getByText('Picked after your last AI interview')).toBeVisible();
    const picks = card.getByRole('link');
    await expect(picks).toHaveCount(3);
    await expect(picks.nth(0)).toContainText('Pastebin');
    await expect(picks.nth(0)).toContainText('size five years of pastes');
    await expect(picks.nth(1)).toContainText('Estimation');
    await expect(picks.nth(2)).toHaveAttribute('href', '#/roadmap/rate-limiter');
    await picks.nth(1).click();
    await expect(page).toHaveURL(/#\/review\/estimation$/);
  });

  test('free: the way to Pro instead of picks, without asking for them', async ({ page }) => {
    await mockSignedIn(page, FREE);
    const asked = await mockHistory(page, { full: false, total: 0, sessions: [] });
    await page.goto('practice/#/roadmap');
    const card = page.getByRole('region', { name: 'Next for you' });
    await expect(card.getByTestId('next-for-you-upgrade')).toHaveAttribute('href', '../pricing/');
    await expect(card.getByTestId('roadmap-picks')).toHaveCount(0);
    expect(asked.filter((p) => p.startsWith('/api/roadmap'))).toEqual([]);
  });
});
