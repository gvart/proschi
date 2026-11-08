import type { Page } from '@playwright/test';
import { mockSignedIn, SIGNED_IN } from './accounts';
import { codeEditor, editorText, expect, test, toSetupStep } from './fixtures';
import { allowStatus, arrowLine, PartnerMock } from './partner';

/**
 * Design partner in the build with accounts (API mocked, e2e/partner.ts):
 * the panel, a review with clarifying questions, change cards (accept is one
 * undo step, reject, improve, out of date), out of credits, practice
 * coaching versus "Show me the changes", Deep for Max, resume and the phone
 * sheet, the change preview and the edge tab. With PARTNER_SHOTS=<dir>, the shots test saves screenshots there.
 */

const SHOTS = process.env.PARTNER_SHOTS;

async function openEditor(page: Page, plan?: string) {
  await mockSignedIn(page, { ...SIGNED_IN, user: { ...SIGNED_IN.user, ...(plan ? { plan } : {}) } });
  const partner = new PartnerMock();
  await partner.mock(page);
  await page.goto('app/?example=url-shortener');
  await expect(page.locator('.cm-content').first()).toContainText('->');
  return partner;
}

const panel = (page: Page) => page.getByRole('region', { name: 'Design partner' });
const chip = (page: Page, name: string) => panel(page).getByTestId('partner-starters').getByRole('button', { name });
/** Picks a starter chip and sends what it put in the composer. */
async function start(page: Page, name: string) {
  await chip(page, name).click();
  await expect(panel(page).getByRole('textbox', { name: 'Message Design partner' })).toBeFocused();
  await page.keyboard.press('Enter');
}

test('the edge tab and Ctrl+J open the panel; one composer, with starter chips that set what it sends and its estimate', async ({ page }) => {
  await openEditor(page);
  // On the workspace's right edge, not in the toolbar.
  const tab = page.getByTestId('partner-button');
  const box = (await tab.boundingBox())!;
  expect(box.x + box.width).toBeGreaterThan((page.viewportSize()!.width) - 2);
  await tab.click();
  await expect(panel(page)).toBeVisible();
  await expect(tab).toHaveCount(0);
  await expect(panel(page).getByRole('heading', { name: 'Design partner' })).toBeVisible();
  const footnote = panel(page).getByTestId('partner-footnote');
  const composer = panel(page).getByRole('textbox', { name: 'Message Design partner' });
  await expect(footnote).toContainText('A message: about 1–4 credits');
  await expect(panel(page).getByRole('textbox')).toHaveCount(1);
  await chip(page, 'Review my design').click();
  await expect(chip(page, 'Review my design')).toHaveAttribute('aria-pressed', 'true');
  await expect(composer).toHaveValue('Review my design.');
  await expect(footnote).toContainText('A review: about 5–15 credits');
  await chip(page, 'Build a system from a description').click();
  await expect(composer).toHaveValue('');
  await expect(composer).toHaveAttribute('placeholder', /Describe the system/);
  await expect(footnote).toContainText('A build: about 10–40 credits');
  // Build starts taller so its hint reads whole, with no scrollbar, and Mic and Send are the same size, level with each other and the box's bottom.
  expect(await composer.evaluate((t) => t.scrollHeight > t.clientHeight)).toBe(false);
  const [field, mic, send] = await Promise.all([composer.boundingBox(), panel(page).getByTestId('mic-button').boundingBox(), panel(page).getByRole('button', { name: 'Send' }).boundingBox()]);
  expect(field!.height).toBeGreaterThan(80);
  expect(mic!.height).toBe(send!.height);
  expect(mic!.width).toBe(send!.width);
  expect(mic!.y + mic!.height).toBe(send!.y + send!.height);
  expect(mic!.y + mic!.height).toBe(field!.y + field!.height);
  await chip(page, 'Build a system from a description').click();
  await expect(footnote).toContainText('A message: about 1–4 credits');
  // No Deep without Max.
  await expect(panel(page).getByTestId('partner-deep')).toHaveCount(0);
  await panel(page).getByRole('button', { name: 'Close Design partner' }).click();
  await expect(panel(page)).toBeHidden();
  await page.keyboard.press('ControlOrMeta+j');
  await expect(panel(page)).toBeVisible();
});

test('a review answers in Markdown with its cost, and a clarifying question takes a tap', async ({ page }) => {
  const partner = await openEditor(page);
  await page.getByTestId('partner-button').click();
  await start(page, 'Review my design');
  await expect(panel(page).getByRole('heading', { name: 'What to look at' })).toBeVisible();
  expect(partner.created).toEqual([{ context: { kind: 'editor' } }]);
  expect(partner.bodies[0]).toMatchObject({ intent: 'review', message: 'Review my design.' });
  expect(partner.bodies[0].source).toContain('->');
  await expect(panel(page).getByTestId('partner-charge')).toHaveText('3.4 credits');
  await expect(panel(page).getByTestId('partner-balance')).toHaveText('812 credits left');

  await panel(page).getByRole('group', { name: 'How many redirects a second at peak?' }).getByRole('button', { name: 'About 10k' }).click();
  await expect.poll(() => partner.bodies.length).toBe(2);
  expect(partner.bodies[1]).toMatchObject({ intent: 'chat', message: 'About 10k' });
  // Answered: the options of the older turn no longer take taps.
  await expect(panel(page).getByRole('button', { name: 'About 1k' })).toBeDisabled();
});

test('accepting a change edits the code as one undo step; Undo and Ctrl+Z take it back', async ({ page }) => {
  const partner = await openEditor(page);
  const before = await editorText(page);
  await page.getByTestId('partner-button').click();
  await panel(page).getByRole('textbox', { name: 'Message Design partner' }).fill('Take the reads off the database');
  await page.keyboard.press('Enter');
  const card = panel(page).getByTestId('change-card');
  await expect(card).toHaveAttribute('data-status', 'ready');
  await expect(card.getByTestId('change-summary')).toHaveText('adds cache · api: 2 replicas → 4');
  await expect(card.getByTestId('change-metrics')).toContainText('4/7');
  await expect(card.locator('[data-trend="better"]')).toHaveCount(3);
  await expect(card.locator('[data-trend="worse"]')).toHaveCount(1);
  // The new design is drawn, its new node and connection outlined; Before shows the design now.
  const preview = card.getByTestId('change-preview');
  await expect(preview.locator('.react-flow__node.ps-diff-add')).toHaveCount(1);
  await expect(preview.locator('.react-flow__node.ps-diff-add')).toContainText('hot_cache');
  await expect(preview.locator('.react-flow__edge.ps-diff-add')).toHaveCount(1);
  await preview.getByRole('button', { name: 'Before' }).click();
  await expect(preview).toHaveAttribute('data-view', 'before');
  await expect(preview.locator('.react-flow__node', { hasText: 'hot_cache' })).toHaveCount(0);
  // Enlarged over the page, with Back to mine.
  await preview.getByRole('button', { name: 'Enlarge the preview' }).click();
  const large = page.getByRole('dialog', { name: 'Preview of the suggestion' });
  await expect(large).toBeVisible();
  await large.getByRole('button', { name: 'Back to mine' }).click();
  await expect(large).toHaveCount(0);
  // The code is folded under the picture.
  await expect(card.getByTestId('change-diff')).toHaveCount(0);
  await card.getByRole('button', { name: /Code/ }).click();
  await expect(card.getByTestId('change-diff').locator('[data-kind="add"]').first()).toContainText('# cached');

  await card.getByRole('button', { name: 'Accept' }).click();
  await expect(card).toHaveAttribute('data-status', 'applied');
  await expect.poll(() => editorText(page)).toContain('# cached: redis');
  await expect.poll(() => partner.decisions).toEqual([{ changeId: 'c1', decision: 'accepted' }]);
  await card.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => editorText(page)).toBe(before);
  await expect(card).toHaveAttribute('data-status', 'ready');

  // Accept again, then the editor's own undo reverts the whole change in one step.
  await card.getByRole('button', { name: 'Accept' }).click();
  await expect.poll(() => editorText(page)).toContain('# cached: redis');
  await codeEditor(page).click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => editorText(page)).toBe(before);
});

test('reject, improve this (the old card folds away), and a card whose edits no longer apply', async ({ page }) => {
  const partner = await openEditor(page);
  await page.getByTestId('partner-button').click();
  const box = panel(page).getByRole('textbox', { name: 'Message Design partner' });
  await box.fill('Make it faster');
  await page.keyboard.press('Enter');
  const first = panel(page).getByTestId('change-card').first();
  await first.getByRole('button', { name: 'Reject' }).click();
  await expect(first).toHaveAttribute('data-status', 'rejected');
  await expect.poll(() => partner.decisions).toEqual([{ changeId: 'c1', decision: 'rejected' }]);

  await box.fill('Another one');
  await page.keyboard.press('Enter');
  const second = panel(page).getByTestId('change-card').nth(1);
  await second.getByRole('button', { name: 'Improve this' }).click();
  await second.getByRole('textbox', { name: 'How should this change be better?' }).fill('Keep it under $400 a month');
  await second.getByRole('button', { name: 'Send' }).click();
  await expect.poll(() => partner.bodies.length).toBe(3);
  expect(partner.bodies[2]).toMatchObject({ intent: 'improve', message: 'Keep it under $400 a month', changeId: 'c2' });
  await expect(second).toHaveAttribute('data-status', 'improved');
  await expect(second).toContainText('Improved below');
  await expect(second.getByRole('button', { name: 'Accept' })).toHaveCount(0);
  await expect(second.getByRole('button', { name: 'Reject' })).toHaveCount(0);
  await expect(panel(page).getByTestId('change-card')).toHaveCount(3);

  // The line every edit finds is gone: the newest card is out of date.
  const latest = panel(page).getByTestId('change-card').last();
  await expect(latest).toHaveAttribute('data-status', 'ready');
  const line = arrowLine(await editorText(page));
  await codeEditor(page).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText((await editorText(page)).split(line).join(line.replace('->', '-->')));
  await expect(latest).toHaveAttribute('data-status', 'stale');
  await expect(latest).toContainText('Out of date');
  await expect(latest.getByRole('button', { name: 'Accept' })).toHaveCount(0);
});

test('building from a description shows how far along it is, then the design as a change', async ({ page }) => {
  const partner = await openEditor(page);
  let release!: () => void;
  const answered = new Promise<void>((r) => (release = r));
  partner.queue.push(async (body, p) => {
    await answered;
    return p.answer(body);
  });
  await page.getByTestId('partner-button').click();
  await chip(page, 'Build a system from a description').click();
  await panel(page).getByRole('textbox', { name: 'Message Design partner' }).fill('A URL shortener with 10k redirects a second');
  await page.keyboard.press('Enter');
  const thinking = panel(page).getByTestId('partner-thinking');
  await expect(thinking).toContainText('Reading your description…');
  await expect(thinking).toContainText(/[1-9] s/);
  // The panel stays usable meanwhile: a draft can be typed, it just waits to be sent.
  const box = panel(page).getByRole('textbox', { name: 'Message Design partner' });
  await box.fill('Next question');
  await expect(panel(page).getByRole('button', { name: 'Send' })).toBeDisabled();
  release();
  await expect(panel(page).getByTestId('change-card')).toBeVisible();
  await expect(thinking).toHaveCount(0);
  expect(partner.bodies[0]).toMatchObject({ intent: 'build', message: 'A URL shortener with 10k redirects a second' });
  // Sent: the composer is back to plain messages.
  await expect(chip(page, 'Build a system from a description')).toHaveAttribute('aria-pressed', 'false');
  await expect(box).toHaveValue('Next question');
});

test('out of credits: the message stays and the panel links to top-ups and plans', async ({ page, errors }) => {
  const partner = await openEditor(page);
  partner.queue.push(() => ({ status: 402, json: { error: 'no_credits', needed: 6, balance: 2.5 } }));
  await page.getByTestId('partner-button').click();
  const box = panel(page).getByRole('textbox', { name: 'Message Design partner' });
  await box.fill('What about sharding?');
  await page.keyboard.press('Enter');
  const cta = panel(page).getByTestId('partner-no-credits');
  await expect(cta).toContainText('This needs about 6; you have 2.5.');
  await expect(cta.getByRole('link', { name: 'Top up or upgrade' })).toHaveAttribute('href', /pricing\/$/);
  await expect(box).toHaveValue('What about sharding?');
  await expect(panel(page).getByRole('list', { name: 'Conversation' })).toHaveCount(0);
  allowStatus(errors, 402);
});

test('a reload resumes the conversation of the document', async ({ page }) => {
  const partner = await openEditor(page);
  await page.getByTestId('partner-button').click();
  await start(page, 'Review my design');
  await expect(panel(page).getByRole('heading', { name: 'What holds up' })).toBeVisible();
  await page.reload();
  await page.getByTestId('partner-button').click();
  await expect(panel(page).getByRole('heading', { name: 'What holds up' })).toBeVisible();
  await expect(panel(page).getByText('Review my design.')).toBeVisible();
  expect(partner.created).toHaveLength(1);
});

test('Max gets Deep, with its higher estimate, and it starts the conversation deep', async ({ page }) => {
  const partner = await openEditor(page, 'max');
  await page.getByTestId('partner-button').click();
  const deep = panel(page).getByTestId('partner-deep');
  await expect(deep).toContainText('×2');
  await deep.click();
  await expect(deep).toHaveAttribute('aria-pressed', 'true');
  await chip(page, 'Review my design').click();
  await expect(panel(page).getByTestId('partner-footnote')).toContainText('A review: about 10–30 credits');
  await page.keyboard.press('Enter');
  await expect.poll(() => partner.created).toEqual([{ context: { kind: 'editor' }, deep: true }]);
});

test.describe('practice', () => {
  async function openProblem(page: Page) {
    await mockSignedIn(page);
    const partner = new PartnerMock();
    await partner.mock(page);
    await page.goto('practice/#/url-shortener');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('URL Shortener');
    return partner;
  }

  test('coaches first; "Show me the changes" asks once, then marks the problem assisted', async ({ page }) => {
    const partner = await openProblem(page);
    await page.getByTestId('partner-button').click();
    await expect(panel(page).getByText('Coach', { exact: true })).toBeVisible();
    // Out of the page header: the tab sits on the workspace's right edge.
    await expect(page.getByRole('banner').getByTestId('partner-button')).toHaveCount(0);
    await expect(chip(page, 'Give me a hint')).toBeVisible();
    await expect(chip(page, 'Build a system from a description')).toHaveCount(0);
    await start(page, 'Review my design');
    await expect(panel(page).getByRole('heading', { name: 'What to look at' })).toBeVisible();
    expect(partner.created[0]).toEqual({ context: { kind: 'practice', problemId: 'url-shortener' } });
    await expect(panel(page).getByTestId('change-card')).toHaveCount(0);
    await expect(page.getByTestId('assisted-tag')).toHaveCount(0);

    await panel(page).getByTestId('partner-solve').click();
    await expect(panel(page).getByText(/marked assisted/)).toBeVisible();
    await panel(page).getByRole('button', { name: 'Show the changes' }).click();
    await expect(panel(page).getByTestId('change-card')).toBeVisible();
    expect(partner.bodies[1]).toMatchObject({ intent: 'solve' });
    await expect(page.getByRole('heading', { level: 1 }).getByTestId('assisted-tag')).toHaveText('assisted');
    // Kept in this browser's progress, shown in the list.
    await page.goto('practice/#/');
    await expect(page.getByRole('link', { name: /URL Shortener/ }).getByTestId('assisted-tag')).toBeVisible();
  });

  test('is not in the interview room, so the interview stays your own work', async ({ page }) => {
    await openProblem(page);
    await expect(page.getByTestId('partner-button')).toBeVisible();
    await page.getByRole('navigation', { name: 'Stages' }).getByRole('button', { name: 'Wrap-up' }).click();
    await page.getByRole('link', { name: /Practice this as a mock interview/ }).click();
    await page.getByRole('radio', { name: /On my own/ }).click();
    await toSetupStep(page);
    await page.getByRole('button', { name: 'Start the interview' }).click();
    await expect(page.getByTestId('interview-room')).toBeVisible();
    await expect(page.getByTestId('partner-button')).toHaveCount(0);
  });
});

test('on a phone the panel is a full-height sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openEditor(page);
  // In the tab bar, not floating over the panes.
  const bar = (await page.locator('[data-tour="panes"]').boundingBox())!;
  const tab = (await page.getByTestId('partner-button').boundingBox())!;
  expect(tab.y).toBeGreaterThanOrEqual(bar.y);
  expect(tab.y + tab.height).toBeLessThanOrEqual(bar.y + bar.height + 1);
  await page.getByTestId('partner-button').click();
  const sheet = page.getByRole('dialog', { name: 'Design partner' });
  await expect(sheet).toBeVisible();
  const box = (await sheet.boundingBox())!;
  expect(box.height).toBeGreaterThan(800);
  expect(box.width).toBe(390);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

test('shots', async ({ page }) => {
  test.skip(!SHOTS, 'PARTNER_SHOTS=<dir> saves screenshots');
  test.setTimeout(240_000);
  const take = async (name: string) => {
    // Let the sheet's slide, the smooth scroll and the preview's layout settle.
    await page.waitForTimeout(700);
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.mouse.move(0, 0);
      await page.screenshot({ path: `${SHOTS}/${name}-${scheme}.png` });
    }
    await page.emulateMedia({ colorScheme: 'light' });
  };
  for (const [width, height] of [
    [1440, 900],
    [1280, 800],
    [390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    const partner = await openEditor(page, 'max');
    await page.evaluate(() => localStorage.removeItem('proschi.partner'));
    await take(`${width}-editor-entry`);
    await page.getByTestId('partner-button').click();
    await chip(page, 'Build a system from a description').click();
    await take(`${width}-composer-chips`);
    await panel(page).getByRole('textbox', { name: 'Message Design partner' }).fill('Take the reads off the database');
    await page.keyboard.press('Enter');
    const card = panel(page).getByTestId('change-card').last();
    await expect(card.getByTestId('change-preview').locator('.react-flow__node.ps-diff-add')).toHaveCount(1);
    await card.getByTestId('change-preview').scrollIntoViewIfNeeded();
    await take(`${width}-card-after`);
    await card.getByRole('button', { name: 'Before' }).click();
    await take(`${width}-card-before`);
    await card.getByRole('button', { name: 'Improve this' }).click();
    await card.getByRole('textbox', { name: 'How should this change be better?' }).fill('Keep it under $400 a month');
    await card.getByRole('button', { name: 'Send' }).click();
    await expect(panel(page).getByTestId('change-card').first()).toHaveAttribute('data-status', 'improved');
    await panel(page).getByTestId('change-card').first().scrollIntoViewIfNeeded();
    await take(`${width}-card-improved`);
    if (width === 1440) {
      await panel(page).getByTestId('change-card').last().getByRole('button', { name: 'Enlarge the preview' }).click();
      await take(`${width}-preview-large`);
      await page.keyboard.press('Escape');
    }
    expect(partner.bodies.length).toBe(2);
    await page.goto('practice/#/url-shortener');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('URL Shortener');
    await take(`${width}-practice-entry`);
    await page.getByTestId('partner-button').click();
    await take(`${width}-practice-chips`);
  }
});
