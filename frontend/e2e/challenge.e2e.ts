import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * The daily challenge in a build without accounts: scored and kept in this
 * browser. Which cards a day brings changes with the card pool, so nothing
 * here names a card: each card on screen is looked up by its id in the
 * published practice/cards.json and answered right (or wrong) from it.
 */

const DAY = '2026-10-06';

interface BundleCard {
  id: string;
  type: 'choice' | 'estimate' | 'cloze' | 'flip';
  options?: { text: string; correct: boolean }[];
  answer?: number;
  blanks?: string[][];
}

async function loadCards(request: APIRequestContext): Promise<Map<string, BundleCard>> {
  const bundle = (await (await request.get('practice/cards.json')).json()) as { cards: BundleCard[] };
  return new Map(bundle.cards.map((c) => [c.id, c]));
}

const challengeCard = (page: Page, n: number) => page.getByRole('article', { name: `Challenge card ${n} of 5` });

/** Answers the card on screen right or wrong, then moves on. */
async function answer(c: Locator, cards: Map<string, BundleCard>, right: boolean): Promise<void> {
  const id = await c.getAttribute('data-card-id');
  const card = cards.get(id ?? '');
  expect(card, `card ${id} is in cards.json`).toBeDefined();
  if (card!.type === 'choice') {
    const index = card!.options!.findIndex((o) => o.correct === right);
    await c.locator(`button[data-option="${index}"]`).click();
  } else if (card!.type === 'estimate') {
    await c.getByLabel('Your estimate').fill(String(right ? card!.answer : card!.answer! * 1000));
    await c.getByRole('button', { name: 'Check' }).click();
  } else if (card!.type === 'cloze') {
    if (right) {
      for (const [i, accepted] of card!.blanks!.entries()) await c.getByLabel(`Gap ${i + 1}`).fill(accepted[0]);
      await c.getByRole('button', { name: 'Check' }).click();
    } else await c.getByRole('button', { name: 'Show answer' }).click();
  } else throw new Error(`A ${card!.type} card in the challenge`);
  await expect(c.getByRole('region', { name: right ? 'Correct' : /Not quite/ })).toBeVisible();
  await c.getByRole('button', { name: 'Next' }).click();
}

/** Plays the whole challenge; `pattern[i]` says whether card i + 1 is answered right. */
async function play(page: Page, cards: Map<string, BundleCard>, pattern: boolean[]): Promise<void> {
  await page.getByRole('button', { name: 'Start the challenge' }).click();
  for (const [i, right] of pattern.entries()) {
    const c = challengeCard(page, i + 1);
    await expect(c).toBeVisible();
    await answer(c, cards, right);
  }
}

async function expectNoHorizontalScroll(page: Page, where: string): Promise<void> {
  const { scrollWidth, width } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, width: document.documentElement.clientWidth }));
  expect(scrollWidth, `${where}: the page is wider than the phone`).toBeLessThanOrEqual(width);
}

test.describe('daily challenge', () => {
  test.beforeEach(async ({ page }) => {
    // A fixed day, so the share text is known; the clock still runs, so answers are timed.
    await page.clock.install({ time: new Date(`${DAY}T08:00:00Z`) });
  });

  test('play, score, share; only the first attempt counts and every answer is a review', async ({ page, context, request }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const cards = await loadCards(request);
    await page.goto('practice/');
    await page.getByRole('main').getByRole('link', { name: 'Play today’s challenge' }).click();
    await expect(page).toHaveURL(/#\/challenge$/);
    await expect(page).toHaveTitle('Daily challenge · Proschi practice');
    await expect(page.getByRole('heading', { level: 1, name: 'Daily challenge' })).toBeVisible();
    const intro = page.getByRole('region', { name: 'Today’s challenge' });
    await expect(intro).toContainText(/A new challenge starts at 00:00 UTC, in 1[56] h \d+ min\./);
    await expect(intro).toContainText('At most 600 points');
    // No accounts in this build: no leaderboard, no sign-in invitation.
    await expect(page.getByRole('heading', { name: 'Today’s leaderboard' })).toHaveCount(0);

    // Four right, the third wrong, all quickly: 4 × (100 + 20).
    await play(page, cards, [true, true, false, true, true]);
    const result = page.getByRole('region', { name: 'Your result' });
    await expect(result.getByRole('heading', { name: 'Challenge done' })).toBeFocused();
    await expect(result).toContainText('480 / 600');
    await expect(result).toContainText('4 of 5 right: 400 points, and 80 for speed.');
    await expect(result).toContainText('Scored in this browser.');
    await expect(result.getByLabel('Challenge streak')).toHaveText('1-day challenge streak');
    const text = `Proschi daily challenge ${DAY}: 480/600 ✅✅❌✅✅ proschi.app/practice/#/challenge`;
    await expect(page.locator('#challenge-share-text')).toHaveText(text);
    await result.getByRole('button', { name: 'Copy result' }).click();
    await expect(result.getByRole('status')).toHaveText('Copied to the clipboard.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);

    // The answers, with the right one and why.
    const answers = page.getByRole('region', { name: 'The answers' });
    // The cards' own Markdown may hold lists: only the answers' list items.
    const items = answers.locator('ol').first().locator(':scope > li');
    await expect(items).toHaveCount(5);
    await expect(items.nth(2)).toContainText('Wrong:');
    await expect(items.nth(2)).toContainText('Right answer');
    await expect(items.nth(0)).toContainText('Right:');
    await expect(items.nth(0)).toContainText('(100 + 20 speed)');

    // Kept: a reload shows the result, not a second go.
    await page.reload();
    await expect(page.getByRole('region', { name: 'Your result' })).toContainText('480 / 600');
    await expect(page.getByRole('button', { name: 'Start the challenge' })).toHaveCount(0);

    // Every answer counted as a review today.
    await page.getByRole('main').getByRole('link', { name: 'Daily review' }).click();
    await expect(page).toHaveURL(/#\/review$/);
    const reviewed = page.getByRole('region', { name: 'Today' }).locator('dt', { hasText: /^Reviewed today$/ }).locator('xpath=following-sibling::dd[1]');
    await expect(reviewed).toHaveText('5');
    await page.getByRole('main').getByRole('link', { name: 'Daily challenge' }).click();
    await expect(page).toHaveURL(/#\/challenge$/);
  });

  test('a reload carries on at the next card, keeping the answers given', async ({ page, request }) => {
    const cards = await loadCards(request);
    await page.goto('practice/#/challenge');
    await page.getByRole('button', { name: 'Start the challenge' }).click();
    const first = await challengeCard(page, 1).getAttribute('data-card-id');
    await answer(challengeCard(page, 1), cards, true);
    await answer(challengeCard(page, 2), cards, false);
    const third = await challengeCard(page, 3).getAttribute('data-card-id');

    await page.reload();
    // Straight back into the challenge, at card 3: the cards answered are not shown again.
    await expect(challengeCard(page, 3)).toBeVisible();
    await expect(challengeCard(page, 3)).toHaveAttribute('data-card-id', third!);
    await expect(page.getByRole('progressbar', { name: 'Challenge progress' })).toHaveAttribute('aria-valuenow', '2');
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('proschi.challenge.progress') ?? '{}'));
    expect(kept.local).toMatchObject({ day: DAY, reviewed: 2 });
    expect(kept.local.answers).toHaveLength(2);
    expect(kept.local.answers[0].cardId).toBe(first);

    for (let n = 3; n <= 5; n++) await answer(challengeCard(page, n), cards, true);
    const result = page.getByRole('region', { name: 'Your result' });
    // The two answers from before the reload count: card 2 was wrong.
    await expect(page.locator('#challenge-share-text')).toHaveText(`Proschi daily challenge ${DAY}: 480/600 ✅❌✅✅✅ proschi.app/practice/#/challenge`);
    await expect(result).toContainText('4 of 5 right');
    expect(await page.evaluate(() => localStorage.getItem('proschi.challenge.progress'))).toBe('{}');
    // Five reviews, none twice.
    const reviews = await page.evaluate(() => JSON.parse(localStorage.getItem('proschi.cards') ?? '[]') as unknown[]);
    expect(reviews).toHaveLength(5);
  });

  test('an answer shown just before a reload is kept, and the card is not shown again', async ({ page, request }) => {
    const cards = await loadCards(request);
    await page.goto('practice/#/challenge');
    await page.getByRole('button', { name: 'Start the challenge' }).click();
    const c = challengeCard(page, 1);
    const id = await c.getAttribute('data-card-id');
    const card = cards.get(id!)!;
    // Answer, see the feedback, but reload instead of moving on.
    if (card.type === 'choice') await c.locator(`button[data-option="${card.options!.findIndex((o) => o.correct)}"]`).click();
    else if (card.type === 'estimate') {
      await c.getByLabel('Your estimate').fill(String(card.answer));
      await c.getByRole('button', { name: 'Check' }).click();
    } else {
      for (const [i, accepted] of card.blanks!.entries()) await c.getByLabel(`Gap ${i + 1}`).fill(accepted[0]);
      await c.getByRole('button', { name: 'Check' }).click();
    }
    await expect(c.getByRole('region', { name: 'Correct' })).toBeVisible();
    await page.reload();
    await expect(challengeCard(page, 2)).toBeVisible();
    const reviews = await page.evaluate(() => JSON.parse(localStorage.getItem('proschi.cards') ?? '[]') as { cardId: string }[]);
    expect(reviews.map((r) => r.cardId)).toEqual([id]);
  });

  test('a perfect score celebrates, unless motion is reduced', async ({ page, request }) => {
    const cards = await loadCards(request);
    await page.goto('practice/#/challenge');
    await play(page, cards, [true, true, true, true, true]);
    const result = page.getByRole('region', { name: 'Your result' });
    await expect(result.getByRole('heading', { name: 'Perfect score!' })).toBeVisible();
    await expect(result).toContainText('600 / 600');
    await expect(page.locator('.ps-celebrate')).toHaveCount(1);
    await expect(page.locator('#challenge-share-text')).toHaveText(`Proschi daily challenge ${DAY}: 600/600 ✅✅✅✅✅ proschi.app/practice/#/challenge`);
  });

  test('no confetti under reduced motion', async ({ page, request }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const cards = await loadCards(request);
    await page.goto('practice/#/challenge');
    await play(page, cards, [true, true, true, true, true]);
    await expect(page.getByRole('heading', { name: 'Perfect score!' })).toBeVisible();
    await expect(page.locator('.ps-celebrate')).toHaveCount(0);
  });

  test('fits a phone without scrolling sideways', async ({ page, request }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    const cards = await loadCards(request);
    await page.goto('practice/');
    await expectNoHorizontalScroll(page, 'the practice list');
    await page.goto('practice/#/challenge');
    await expect(page.getByRole('button', { name: 'Start the challenge' })).toBeVisible();
    await expectNoHorizontalScroll(page, 'the intro');
    await page.getByRole('button', { name: 'Start the challenge' }).click();
    for (let n = 1; n <= 5; n++) {
      const c = challengeCard(page, n);
      await expect(c).toBeVisible();
      // As in daily review: the card's heading takes focus and its top shows below the sticky header.
      const heading = c.getByRole('heading', { level: 2 });
      await expect(heading).toBeFocused();
      await expect
        .poll(() =>
          heading.evaluate((h) => {
            const header = document.querySelector('.ps-header')?.getBoundingClientRect().bottom ?? 0;
            const r = h.getBoundingClientRect();
            return r.top >= header - 1 && r.bottom <= window.innerHeight;
          }),
        )
        .toBe(true);
      await expectNoHorizontalScroll(page, `card ${n}`);
      await answer(c, cards, n % 2 === 1);
    }
    await expect(page.getByRole('region', { name: 'Your result' })).toBeVisible();
    for (const details of await page.locator('details').all()) await details.locator('summary').click();
    await expectNoHorizontalScroll(page, 'the result');
  });
});
