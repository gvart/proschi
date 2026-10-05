import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * Daily review in a build without accounts: every card, scheduled, with the
 * reviews kept in the browser. The first session's new cards come from the
 * sample deck, one per topic in tags.json's order, easiest first
 * (src/learn/review.ts), so the cards and their order are known however many
 * other cards are added.
 */

const today = (page: Page) => page.getByRole('region', { name: 'Today' });
const card = (page: Page, n: number, of = 10) => page.getByRole('article', { name: `Card ${n} of ${of}` });
/** A count on the review home, e.g. "Reviewed today". */
const count = (page: Page, label: string) => today(page).locator('dt', { hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd[1]');

async function expectType(c: Locator, type: string, text: RegExp | string): Promise<void> {
  await expect(c).toHaveAttribute('data-card-type', type);
  await expect(c).toContainText(text);
}

test.describe('daily review', () => {
  test('a session with every card type, kept in the browser', async ({ page }) => {
    // Practice links to interview prep, whose tabs lead to daily review.
    await page.goto('practice/');
    await page.getByRole('main').getByRole('link', { name: /Interview prep/ }).click();
    await page.getByRole('navigation', { name: 'Interview prep' }).getByRole('link', { name: 'Daily review' }).click();
    await expect(page).toHaveURL(/#\/review$/);
    await expect(page).toHaveTitle('Daily review · Proschi practice');
    await expect(page.getByRole('heading', { level: 1, name: 'Daily review' })).toBeVisible();
    // Accounts are off in this build: no sign-in invitation, every card.
    await expect(page.getByRole('region', { name: 'Sign in to save your reviews' })).toHaveCount(0);
    await expect(count(page, 'Due')).toHaveText('0');
    await expect(count(page, 'New')).toHaveText('10');
    await expect(page.getByRole('link', { name: /^Estimation/ })).toBeVisible();

    await today(page).getByRole('button', { name: 'Start review · 10 cards' }).click();
    await expect(page.getByRole('progressbar', { name: 'Session progress' })).toHaveAttribute('aria-valuenow', '0');

    // 1. Estimate: a number that does not parse is refused, "2.3k" is within tolerance.
    let c = card(page, 1);
    await expectType(c, 'estimate', 'daily active users');
    await c.getByLabel('Your estimate').fill('lots');
    await c.getByRole('button', { name: 'Check' }).click();
    await expect(c.getByRole('alert')).toContainText('Enter a number');
    await c.getByLabel('Your estimate').fill('2.3k');
    await c.getByRole('button', { name: 'Check' }).click();
    await expect(c.getByRole('region', { name: 'Correct' })).toContainText('Close enough: the answer is 2,300 requests/s.');
    await expect(c).toContainText('Solution');
    await c.getByRole('button', { name: 'Too easy' }).click();

    // 2. Choice, answered right; Enter goes on.
    c = card(page, 2);
    await expectType(c, 'choice', 'Which load balancer');
    await c.getByRole('button', { name: /layer 7 \(HTTP\)/ }).click();
    await expect(c.getByRole('region', { name: 'Correct' })).toBeVisible();
    await page.keyboard.press('Enter');

    // 3. Choice, answered wrong: the right option is marked, with the why.
    c = card(page, 3);
    await expectType(c, 'choice', 'not idempotent');
    await c.getByRole('button', { name: 'GET', exact: true }).click();
    await expect(c.getByRole('region', { name: 'Not quite' })).toContainText('idempotency');
    await expect(c.getByRole('button', { name: 'POST (the right answer)' })).toBeDisabled();
    await expect(c.getByRole('button', { name: 'Too easy' })).toHaveCount(0);
    await c.getByRole('button', { name: 'Next' }).click();

    // 4. Flip, with the keyboard: space shows the answer, 3 rates it good.
    c = card(page, 4);
    await expectType(c, 'flip', 'cache-aside');
    await page.keyboard.press(' ');
    await expect(c.getByRole('region', { name: 'Answer' })).toBeVisible();
    await expect(c.getByRole('button', { name: 'Good, next in 3d' })).toBeVisible();
    await page.keyboard.press('3');

    // 5. Flip, forgotten.
    c = card(page, 5);
    await expectType(c, 'flip', /index/i);
    await c.getByRole('button', { name: 'Show answer' }).click();
    await c.getByRole('button', { name: /^Again/ }).click();

    // 6. Cloze, given up: the answers are filled in and it counts as forgotten.
    c = card(page, 6);
    await expectType(c, 'cloze', 'Gap 1');
    await c.getByRole('button', { name: 'Show answer' }).click();
    await expect(c.getByRole('region', { name: 'Not quite' })).toContainText('The answers are filled in above');
    await c.getByRole('button', { name: 'Next' }).click();

    // 7–9: flip, flip, choice.
    for (const [n, type] of [
      [7, 'flip'],
      [8, 'flip'],
    ] as const) {
      c = card(page, n);
      await expect(c).toHaveAttribute('data-card-type', type);
      await c.getByRole('button', { name: 'Show answer' }).click();
      await c.getByRole('button', { name: /^Hard/ }).click();
    }
    c = card(page, 9);
    await expect(c).toHaveAttribute('data-card-type', 'choice');
    await page.keyboard.press('1');
    await expect(c.getByRole('region', { name: /^(Correct|Not quite)$/ })).toBeVisible();
    await c.getByRole('button', { name: 'Next' }).click();

    // 10. Cloze, typed: case, punctuation and other accepted answers count.
    c = card(page, 10);
    await expectType(c, 'cloze', 'one-minute buckets');
    await c.getByLabel('Gap 1').fill('Tumbling');
    await c.getByLabel('Gap 2').fill('sliding window.');
    await c.getByRole('button', { name: 'Check' }).click();
    await expect(c.getByRole('region', { name: 'Correct' })).toBeVisible();
    await c.getByRole('button', { name: 'Next' }).click();

    const summary = page.getByRole('region', { name: 'Session summary' });
    await expect(summary).toContainText(/You reviewed 10 cards: \d+ remembered, \d+ to see again soon\./);
    await summary.getByRole('button', { name: 'Back to review' }).click();

    // The day's ten new cards are done; nothing is due before tomorrow.
    await expect(count(page, 'Reviewed today')).toHaveText('10');
    await expect(count(page, 'New')).toHaveText('0');
    await expect(today(page)).toContainText('All caught up: the next card is due tomorrow.');

    // Kept in this browser.
    await page.reload();
    await expect(count(page, 'Reviewed today')).toHaveText('10');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('proschi.cards') ?? '[]') as { cardId: string; rating: number }[]);
    expect(stored).toHaveLength(10);
    expect(stored[0]).toMatchObject({ cardId: 'qps-from-daily-users', rating: 4 });

    // Training one topic goes past the daily allowance of new cards.
    await page.getByRole('link', { name: /^Estimation/ }).click();
    await expect(page).toHaveURL(/#\/review\/estimation$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Review: Estimation' })).toBeVisible();
    // Its cards not reviewed yet (one was, in the session above), including those of other folders tagged with it.
    const fresh = Number(await count(page, 'New').innerText());
    expect(fresh).toBeGreaterThanOrEqual(2);
    await today(page).getByRole('button', { name: `Start review · ${fresh} cards` }).click();
    await expect(card(page, 1, fresh)).toBeVisible();
    await page.getByRole('button', { name: 'End session' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Review: Estimation' })).toBeVisible();
    await page.getByRole('link', { name: 'All topics' }).click();
    await expect(page).toHaveURL(/#\/review$/);
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 664 } });

    /** Whether the card's heading is focused (or holds the focus) and wholly visible below the sticky header. */
    const headingInView = (c: Locator) =>
      c.getByRole('heading', { level: 2 }).evaluate((h) => {
        const header = document.querySelector('.ps-header')!.getBoundingClientRect();
        const r = h.getBoundingClientRect();
        return { focused: h.contains(document.activeElement), top: r.top >= header.bottom - 1, bottom: r.bottom <= window.innerHeight };
      });

    test('the next card takes focus and shows its top below the header', async ({ page }) => {
      await page.goto('practice/#/review');
      await today(page).getByRole('button', { name: 'Start review · 10 cards' }).click();

      // The first card answered at the bottom of the page...
      let c = card(page, 1);
      await c.getByLabel('Your estimate').fill('2.3k');
      await c.getByRole('button', { name: 'Check' }).click();
      await c.getByRole('button', { name: 'Too easy' }).click();
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

      // ...the next one is focused at its heading, with its topic, type and question in view.
      c = card(page, 2);
      await expect(c.getByRole('heading', { level: 2 })).toBeFocused();
      await expect(c.getByRole('heading', { level: 2 })).toContainText('Pick one');
      await expect.poll(() => headingInView(c)).toEqual({ focused: true, top: true, bottom: true });
      await expect(c.getByText('Which load balancer')).toBeInViewport();

      // Without motion, the same, at once.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await c.getByRole('button', { name: /layer 7 \(HTTP\)/ }).click();
      await c.getByRole('button', { name: 'Next' }).click();
      c = card(page, 3);
      await expect.poll(() => headingInView(c)).toEqual({ focused: true, top: true, bottom: true });
    });

    test('showing an answer keeps the question in view', async ({ page }) => {
      await page.goto('practice/#/review');
      await today(page).getByRole('button', { name: 'Start review · 10 cards' }).click();
      for (const n of [1, 2, 3]) {
        const c = card(page, n);
        await expect(c).toBeVisible();
        if (n === 1) {
          await c.getByLabel('Your estimate').fill('2.3k');
          await c.getByRole('button', { name: 'Check' }).click();
        } else {
          await c.getByRole('listitem').first().getByRole('button').click();
        }
        await c.getByRole('button', { name: 'Next' }).click();
      }
      const c = card(page, 4);
      await expect(c).toHaveAttribute('data-card-type', 'flip');
      await c.getByRole('button', { name: 'Show answer' }).click();
      const answer = c.getByRole('region', { name: 'Answer' });
      await expect(answer).toBeFocused();
      await expect(answer).toBeInViewport();
      await expect(c.getByText(/cache-aside/).first()).toBeInViewport();
    });
  });

  test('an unknown topic says so', async ({ page }) => {
    await page.goto('practice/#/review/no-such-topic');
    await expect(page.getByText('No topic called “no-such-topic”. Pick one below.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Daily review' })).toBeVisible();
  });

  test('the cards are published for apps', async ({ request }) => {
    const response = await request.get('practice/cards.json');
    expect(response.ok()).toBe(true);
    const bundle = await response.json();
    expect(bundle).toMatchObject({ format: 1, hash: expect.stringMatching(/^[0-9a-f]{16}$/) });
    expect(bundle.cards.length).toBeGreaterThanOrEqual(32);
    expect(bundle.topics.length).toBeGreaterThanOrEqual(15);
  });
});
