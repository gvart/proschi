import { expect, test, waitForCanvas } from './fixtures';

/**
 * Lessons: on the roadmap a problem opens on the stage the learner was on
 * (here, by the stages fixture, Design in the full editor), never on its
 * lesson first (P52); the lesson is the first stage in the rail, a page of
 * its own whose Next leads back to that stage. From the Problems list the
 * problem is the plain workspace and the lesson a drawer (P51).
 * The e2e build has no accounts, so the roadmap is open.
 */
test.describe('lessons', () => {
  test('a roadmap step opens on its stage, with the lesson one click away in the rail', async ({ page }) => {
    await page.goto('practice/#/roadmap');
    const step = page.getByRole('listitem', { name: /^Stage 1: / }).getByRole('link', { name: /Hello, Proschi/ });
    await expect(step).toContainText('Lesson · Challenge');
    await expect(step).toContainText(/\d+ min read/);
    await step.click();
    await expect(page).toHaveURL(/#\/roadmap\/hello-proschi$/);

    // Not the lesson first, even unread: the stage, here Design in the full editor.
    const lesson = page.getByRole('article', { name: 'Lesson' });
    await expect(page.getByRole('heading', { level: 2, name: 'Functional requirements' })).toBeVisible();
    await expect(lesson).toHaveCount(0);
    await waitForCanvas(page);
    // The tests stay folded to their bar until the first run.
    await expect(page.getByRole('button', { name: 'Run tests' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show the test results' })).toHaveAttribute('aria-expanded', 'false');

    // The lesson is the first stage in the rail: a page of its own, nothing of the workspace.
    await page.getByRole('navigation', { name: 'Stages' }).getByRole('button', { name: 'Lesson' }).click();
    await expect(lesson).toBeVisible();
    await expect(lesson.getByRole('heading', { level: 2, name: "What you'll learn" })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run tests' })).toHaveCount(0);
    await expect(page.locator('.cm-content')).toHaveCount(0);
    await expect(lesson.getByRole('button', { name: 'Continue: Design' })).toHaveCount(1);

    // The table of contents scrolls to a section.
    await lesson.getByRole('navigation', { name: 'Lesson contents' }).getByRole('button', { name: /Common mistakes/ }).click();
    await expect(lesson.getByRole('heading', { level: 2, name: 'Common mistakes' })).toBeInViewport();

    await page.getByTestId('stage-next').click();
    await expect(lesson).toBeHidden();
    await expect(page.getByRole('heading', { level: 2, name: 'Functional requirements' })).toBeVisible();

    // Opening the step again goes straight back to the stage.
    await page.reload();
    await expect(page.getByRole('heading', { level: 2, name: 'Functional requirements' })).toBeVisible();
    await expect(page.getByRole('article', { name: 'Lesson' })).toBeHidden();
  });

  test('from the roadmap a problem opens on its stage, with the lesson in the rail', async ({ page }) => {
    await page.goto('practice/#/roadmap/url-shortener');
    await expect(page.getByRole('heading', { level: 2, name: 'Functional requirements' })).toBeVisible();
    await page.getByRole('navigation', { name: 'Stages' }).getByRole('button', { name: 'Lesson' }).click();
    await expect(page.getByRole('article', { name: 'Lesson' }).getByRole('heading', { level: 2, name: 'Concepts' })).toBeVisible();
    // A ```proschi block in the lesson is highlighted.
    await expect(page.locator('pre[data-lang="proschi"] .font-bold').first()).toBeAttached();
    await page.getByTestId('stage-next').click();
    await expect(page.getByRole('article', { name: 'Lesson' })).toBeHidden();
  });

  test.describe('a lesson not read yet', () => {
    test.use({ lessons: 'fresh' });

    test('never comes first: not from the list, not from the roadmap', async ({ page }) => {
      await page.goto('practice/');
      await page.getByRole('main').getByRole('list').first().getByRole('link', { name: /URL shortener/i }).click();
      await expect(page).toHaveURL(/#\/url-shortener$/);
      await expect(page.getByRole('button', { name: 'Run tests' })).toBeVisible();
      await expect(page.getByRole('article', { name: 'Lesson' })).toHaveCount(0);
      // From the list it is a drawer beside the workspace.
      await page.getByRole('button', { name: 'Lesson' }).first().click();
      await expect(page.getByRole('dialog', { name: 'Lesson' }).getByRole('heading', { level: 2, name: 'Concepts' })).toBeVisible();

      await page.goto('practice/#/roadmap/url-shortener');
      await expect(page.getByRole('heading', { level: 2, name: 'Functional requirements' })).toBeVisible();
      await expect(page.getByRole('article', { name: 'Lesson' })).toHaveCount(0);
    });
  });

  test('what was revealed in the lesson survives leaving it and coming back', async ({ page }) => {
    await page.goto('practice/#/roadmap/url-shortener');
    const open = page.getByRole('navigation', { name: 'Stages' }).getByRole('button', { name: 'Lesson' });
    await open.click();
    const drawer = page.getByRole('article', { name: 'Lesson' });
    const dive = drawer.locator('details[data-block="deepdive"]').first();
    await dive.locator('summary').click();
    const quiz = drawer.getByRole('region', { name: 'Quick check' }).first();
    await quiz.getByLabel('Your estimate in database reads/s').fill('5k');
    await quiz.getByRole('button', { name: 'Check' }).first().click();
    await expect(quiz.getByRole('status').first()).toContainText(/(Correct|Close enough): the answer/);

    await page.getByTestId('stage-next').click();
    await expect(drawer).toBeHidden();
    await open.click();
    await expect(dive).toHaveAttribute('open');
    await expect(quiz.getByRole('status').first()).toContainText(/(Correct|Close enough): the answer/);
  });

  test('lesson blocks: the summary, key numbers, a deep dive that opens and a quick check graded in place', async ({ page }) => {
    await page.goto('practice/#/url-shortener/lesson');
    const lesson = page.getByRole('article', { name: 'Lesson' });
    await expect(lesson.getByRole('complementary', { name: 'In 30 seconds' })).toBeVisible();
    await expect(lesson.locator('[data-block="numbers"] dd').first()).toHaveText('100 : 1');

    const dive = lesson.locator('details[data-block="deepdive"]').first();
    await expect(dive).not.toHaveAttribute('open');
    await dive.locator('summary').click();
    await expect(dive).toHaveAttribute('open');

    const quiz = lesson.getByRole('region', { name: 'Quick check' }).first();
    await quiz.getByLabel('Your estimate in database reads/s').fill('5k');
    await quiz.getByRole('button', { name: 'Check' }).first().click();
    await expect(quiz.getByRole('status').first()).toContainText(/(Correct|Close enough): the answer/);
  });

  test('a lesson read shows on the roadmap', async ({ page }) => {
    await page.goto('practice/#/roadmap');
    const stage = page.getByRole('listitem', { name: /^Stage 1: / });
    await expect(stage).toContainText(/0 \/ \d+ lessons read/);
    await stage.getByRole('link', { name: /Hello, Proschi/ }).click();
    await page.getByRole('navigation', { name: 'Stages' }).getByRole('button', { name: 'Lesson' }).click();
    await page.getByRole('article', { name: 'Lesson' }).getByRole('button', { name: 'Continue: Design' }).click();
    await page.goto('practice/#/roadmap');
    await expect(stage).toContainText(/1 \/ \d+ lessons read/);
    await expect(stage.getByRole('link', { name: /Hello, Proschi/ })).toContainText('Read');
    await expect(page.getByRole('region', { name: 'Your progress' })).toContainText(/1 of \d+ lessons read/);
  });

    test('the guide is open to everyone and linked from the roadmap', async ({ page }) => {
    await page.goto('practice/#/roadmap');
    await page.getByRole('link', { name: /How to approach a system design interview/ }).first().click();
    await expect(page).toHaveURL(/#\/roadmap\/approach$/);
    await expect(page).toHaveTitle('How to approach a system design interview · Proschi practice');
    await expect(page.getByRole('heading', { level: 1, name: 'How to approach a system design interview' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'The four steps' })).toBeVisible();
    await page.getByRole('link', { name: 'Start: Hello, Proschi' }).click();
    await expect(page).toHaveURL(/#\/roadmap\/hello-proschi$/);
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

      await page.goto('practice/#/roadmap/url-shortener/lesson');
      const lesson = page.getByRole('article', { name: 'Lesson' });
      await expect(lesson).toBeVisible();
      // The lesson stage is the lesson alone: no tabs yet.
      await expect(page.getByRole('tablist', { name: 'View', exact: true })).toHaveCount(0);
      const table = lesson.getByRole('region', { name: 'Table' }).first();
      await table.scrollIntoViewIfNeeded();
      const box = await table.boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
      expect(await noPageScroll()).toBe(true);
      await testInfo.attach('lesson-390', { body: await page.screenshot(), contentType: 'image/png' });

      await lesson.getByRole('button', { name: 'Continue: Design' }).click();
      await expect(page).toHaveURL(/#\/roadmap\/url-shortener$/);
      await expect(page.getByRole('tab', { name: 'Problem' })).toBeVisible();
      // Every tab fits, the last one included, and the stages' rail with the lesson above them.
      await expect(page.getByRole('tab', { name: 'Tests' })).toBeInViewport({ ratio: 0.99 });
      await expect(page.getByRole('navigation', { name: 'Stages' }).getByRole('button', { name: 'Lesson' })).toBeInViewport({ ratio: 0.99 });
      expect(await noPageScroll()).toBe(true);

      for (const path of ['practice/url-shortener/', 'practice/approach/', 'practice/#/roadmap/approach']) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        expect(await noPageScroll(), path).toBe(true);
      }
    });
  });
});
