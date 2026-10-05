import { expect, test, waitForCanvas } from './fixtures';

/**
 * Lessons: a roadmap step opens on its lesson ("Learn"), "Start the
 * challenge" switches to the problem, and a revisit goes straight to it.
 * The e2e build has no accounts, so the roadmap is open.
 */
test.describe('lessons', () => {
  test('a roadmap step opens on its lesson, then the challenge; revisits open the challenge', async ({ page }) => {
    await page.goto('practice/#/roadmap');
    const step = page.getByRole('listitem', { name: /^Stage 1: / }).getByRole('link', { name: /URL Shortener/ });
    await expect(step).toContainText('Lesson · Challenge');
    await expect(step).toContainText(/\d+ min read/);
    await step.click();
    await expect(page).toHaveURL(/#\/roadmap\/url-shortener$/);

    const lesson = page.getByRole('article', { name: 'Lesson' });
    await expect(lesson).toBeVisible();
    await expect(lesson.getByRole('heading', { level: 2, name: "What you'll learn" })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Lesson' })).toHaveAttribute('aria-selected', 'true');

    // The table of contents scrolls to a section.
    await lesson.getByRole('navigation', { name: 'Lesson contents' }).getByRole('button', { name: /Common mistakes/ }).click();
    await expect(lesson.getByRole('heading', { level: 2, name: 'Common mistakes' })).toBeInViewport();

    await lesson.getByRole('button', { name: 'Start the challenge' }).first().click();
    await expect(lesson).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 2, name: 'Functional requirements' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Problem' })).toHaveAttribute('aria-selected', 'true');
    await waitForCanvas(page);

    // The lesson stays one click away.
    await page.getByRole('tab', { name: 'Lesson' }).click();
    await expect(page.getByRole('article', { name: 'Lesson' })).toBeVisible();

    // Read once: opening the step again goes straight to the problem.
    await page.reload();
    await expect(page.getByRole('heading', { level: 2, name: 'Functional requirements' })).toBeVisible();
    await expect(page.getByRole('article', { name: 'Lesson' })).toHaveCount(0);
  });

  test('from the list a problem opens on its statement, with the lesson a tab away', async ({ page }) => {
    await page.goto('practice/#/url-shortener');
    await expect(page.getByRole('heading', { level: 2, name: 'Functional requirements' })).toBeVisible();
    await page.getByRole('tab', { name: 'Lesson' }).click();
    await expect(page.getByRole('article', { name: 'Lesson' }).getByRole('heading', { level: 2, name: 'Concepts' })).toBeVisible();
    // A ```proschi block in the lesson is highlighted.
    await expect(page.locator('pre[data-lang="proschi"] .font-bold').first()).toBeAttached();
  });

  test('the guide is open to everyone and linked from the roadmap', async ({ page }) => {
    await page.goto('practice/#/roadmap');
    await page.getByRole('link', { name: /How to approach a system design interview/ }).click();
    await expect(page).toHaveURL(/#\/roadmap\/approach$/);
    await expect(page).toHaveTitle('How to approach a system design interview · Proschi practice');
    await expect(page.getByRole('heading', { level: 1, name: 'How to approach a system design interview' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'The four steps' })).toBeVisible();
    await page.getByRole('link', { name: 'Go to the roadmap' }).click();
    await expect(page).toHaveURL(/#\/roadmap$/);
  });

  test('the static problem page has the lesson as an article with anchors', async ({ page }) => {
    await page.goto('practice/url-shortener/');
    const article = page.locator('article.problem-page__lesson');
    await expect(article.getByRole('heading', { level: 2, name: /Learn it: URL Shortener/ })).toBeVisible();
    await expect(article.locator('h2#what-youll-learn')).toContainText("What you'll learn");
    await expect(article.locator('a.doc-anchor[href="#concepts"]')).toBeAttached();
    await expect(article.locator('.table-wrap table').first()).toBeVisible();
    await page.getByRole('link', { name: 'Read the lesson first' }).click();
    await expect(page).toHaveURL(/#lesson$/);

    await page.goto('practice/approach/');
    await expect(page.getByRole('heading', { level: 1, name: 'How to approach a system design interview' })).toBeVisible();
    await expect(page.locator('h2#the-four-steps')).toBeVisible();
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('the lesson and its tables never widen the page', async ({ page }, testInfo) => {
      const noPageScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

      await page.goto('practice/#/url-shortener/lesson');
      const lesson = page.getByRole('article', { name: 'Lesson' });
      await expect(lesson).toBeVisible();
      // Every tab fits, the last one included.
      await expect(page.getByRole('tab', { name: 'Tests' })).toBeInViewport({ ratio: 0.99 });
      const table = lesson.getByRole('region', { name: 'Table' }).first();
      await table.scrollIntoViewIfNeeded();
      const box = await table.boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
      expect(await noPageScroll()).toBe(true);
      await testInfo.attach('lesson-390', { body: await page.screenshot(), contentType: 'image/png' });

      await lesson.getByRole('button', { name: 'Start the challenge' }).first().click();
      await expect(page).toHaveURL(/#\/url-shortener$/);
      await expect(page.getByRole('heading', { level: 2, name: 'Functional requirements' })).toBeVisible();

      for (const path of ['practice/url-shortener/', 'practice/approach/', 'practice/#/roadmap/approach']) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        expect(await noPageScroll(), path).toBe(true);
      }
    });
  });
});
