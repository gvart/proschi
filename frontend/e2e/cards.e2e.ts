import { expect, test } from './fixtures';

// The review cards' static pages, practice/cards/ (plugins/cardPages.ts).
test.describe('review card pages', () => {
  test('the index lists every topic and links into daily review', async ({ page }) => {
    await page.goto('practice/cards/');
    await expect(page).toHaveTitle('System design review cards: flashcards by topic · Proschi');
    await expect(page.getByRole('heading', { level: 1, name: 'System design review cards' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Caching', exact: true })).toHaveAttribute('href', './caching/');
    await expect(page.getByRole('link', { name: /Start your daily review/ })).toHaveAttribute('href', '../#/review');
  });

  test('a topic page lists its cards and opens one', async ({ page }) => {
    await page.goto('practice/cards/caching/');
    await expect(page).toHaveTitle(/^Caching: \d+ system design flashcards · Proschi$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Caching' })).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://proschi.app/practice/cards/caching/');
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://proschi.app/og/cards/caching.png');
    await expect(page.getByRole('link', { name: /Train caching in daily review/ })).toHaveAttribute('href', '../../#/review/caching');
    await page.locator('.card-list a').first().click();
    await expect(page).toHaveURL(/\/practice\/cards\/caching\/[a-z0-9-]+\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('a card page shows the question, the answer, related problems and the way into review', async ({ page }) => {
    await page.goto('practice/cards/networking/new-connection-latency/');
    await expect(page).toHaveTitle(/^A user is 150 ms .* · Networking · Proschi$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('how long until the response to the first request arrives');
    await expect(page.getByText('About 450 ms')).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'The worked estimate' })).toBeVisible();
    // The card's link to Numbers to know, written from the practice page, still lands.
    await page.getByRole('link', { name: 'Numbers to know' }).click();
    await expect(page).toHaveURL(/\/docs\/numbers\/#latency$/);
    await page.goBack();
    await expect(page.getByRole('link', { name: /Next card/ })).toBeVisible();
    const json = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!);
    expect(json[0]['@type']).toBe('Quiz');
    await page.getByRole('link', { name: /Review this in your daily deck/ }).click();
    await expect(page).toHaveURL(/\/practice\/#\/review\/networking$/);
  });

  test("a problem's page links to its cards, and a card back to its problems", async ({ page }) => {
    await page.goto('practice/url-shortener/');
    const cards = page.locator('section[aria-labelledby="cards-title"]');
    await expect(cards.getByRole('heading', { name: 'Review cards for this problem' })).toBeVisible();
    await cards.locator('li a').first().click();
    await expect(page).toHaveURL(/\/practice\/cards\/[a-z0-9-]+\/[a-z0-9-]+\/$/);
    await expect(page.getByRole('heading', { level: 2, name: 'Use it in a design problem' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'URL Shortener', exact: true })).toBeVisible();
  });
});
