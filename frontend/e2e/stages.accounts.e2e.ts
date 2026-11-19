import type { Locator, Page } from '@playwright/test';
import { mockSignedIn } from './accounts';
import { expect, STAGES_KEY, test } from './fixtures';
import { PartnerMock } from './partner';

/**
 * The Interview coach on a roadmap problem's interview prep stages (P50,
 * P59), in the build with accounts (API mocked): select any text on a stage
 * and ask about it, from the floating button (touch) or the right-click menu;
 * the quote lands in the composer. A tip says so until it is used or
 * dismissed, and each turn carries the stage and the notes. With
 * STAGES_SHOTS=<dir>, saves the menu, the button, the tip and the coach.
 */

const SHOTS = process.env.STAGES_SHOTS;

test.use({ stages: 'fresh' });

const coach = (page: Page) => page.getByRole('region', { name: 'Interview coach' });
const composer = (page: Page) => coach(page).getByRole('textbox', { name: 'Message Interview coach' });

/** Selects the whole text of `el`, as a drag would. */
async function select(el: Locator) {
  await el.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });
}

async function openClarify(page: Page, partner = new PartnerMock()) {
  await mockSignedIn(page);
  await partner.mock(page);
  // The stages are on the roadmap only (P51); started (notes saved), so it opens on Clarify (P52).
  await page.addInitScript((key) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ stage: 'clarify', reached: 'clarify' }));
  }, `${STAGES_KEY}url-shortener`);
  await page.goto('practice/#/roadmap/url-shortener');
  const brief = page.getByTestId('brief');
  await expect(brief).toBeVisible();
  // A click shows the whole brief at once.
  await brief.click();
  await expect(brief).not.toHaveAttribute('data-typing', 'true');
  return brief;
}

test('select text on a stage, then "Ask Interview coach": the quote is in the composer', async ({ page }) => {
  const brief = await openClarify(page);
  await select(brief.locator('.ps-brief-body p').first());
  const ask = page.getByTestId('ask-selection');
  await expect(ask).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/desktop-11-select-button.png` });
  await ask.click();
  await expect(composer(page)).toBeFocused();
  await expect(composer(page)).toHaveValue(/^> Design a service that turns long URLs into short codes[^\n]*\n\n$/);
  await expect(ask).toHaveCount(0);

  // Right-click on a selection: a menu with "Ask Interview coach"; the quote goes after what is typed.
  await composer(page).fill('What should I ask first?');
  const item = brief.getByRole('listitem').first();
  await select(item);
  await item.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Selection' });
  await expect(menu.getByRole('menuitem', { name: 'Ask Interview coach' })).toBeFocused();
  await expect(menu.getByRole('menuitem', { name: 'Copy' })).toBeVisible();
  if (SHOTS) {
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/desktop-12-select-menu.png` });
  }
  await menu.getByRole('menuitem', { name: 'Ask Interview coach' }).click();
  await expect(menu).toHaveCount(0);
  await expect(composer(page)).toHaveValue(/^What should I ask first\?\n\n> Shorten: a visitor posts a long URL/);
});

test('your own notes can be asked about too', async ({ page }) => {
  await openClarify(page);
  const notes = page.getByLabel('Your clarifying questions and assumptions');
  await notes.fill('Assume 1M new links a day.');
  await notes.evaluate((t: HTMLTextAreaElement) => t.setSelectionRange(0, t.value.length));
  await notes.dispatchEvent('mouseup');
  await page.getByTestId('ask-selection').click();
  await expect(composer(page)).toHaveValue('> Assume 1M new links a day.\n\n');
});

test('on a phone, the Interview coach is a bottom sheet on every stage', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openClarify(page);
  await expect(page.getByTestId('ask-tip')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/phone-10-ask-tip.png` });
  await page.getByTestId('stage-bar').getByRole('button', { name: 'Interview coach', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Interview coach' });
  await expect(sheet).toBeVisible();
  if (SHOTS) {
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/phone-11-partner-sheet.png` });
  }
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

test('a tip says selecting text asks the coach, until it is dismissed or used', async ({ page }) => {
  const brief = await openClarify(page);
  const tip = page.getByTestId('ask-tip');
  await expect(tip).toContainText('select any text on this stage to ask the Interview coach about it');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/desktop-10-ask-tip.png` });
  await tip.getByRole('button', { name: 'Dismiss tip' }).click();
  await expect(tip).toHaveCount(0);
  await page.reload();
  await expect(brief).toBeVisible();
  await expect(page.getByTestId('ask-tip')).toHaveCount(0);

  // Asking about a selection once hides it for good too.
  await page.evaluate(() => localStorage.removeItem('proschi.prep.askTip'));
  await page.reload();
  await expect(tip).toBeVisible();
  await brief.click();
  await select(brief.locator('.ps-brief-body p').first());
  await page.getByTestId('ask-selection').click();
  await expect(tip).toHaveCount(0);
  await page.reload();
  await expect(brief).toBeVisible();
  await expect(page.getByTestId('ask-tip')).toHaveCount(0);
});

test('it is the Interview coach on every stage: its own chat, examples for the stage, and each turn carries the stage and the notes', async ({ page }) => {
  const partner = new PartnerMock();
  await openClarify(page, partner);
  await page.getByLabel('Your clarifying questions and assumptions').fill('How many new links a day?');
  await page.getByRole('button', { name: 'Interview coach', exact: true }).click();
  await expect(coach(page).getByRole('heading', { name: 'Interview coach' })).toBeVisible();
  const empty = coach(page).getByTestId('coach-empty');
  await expect(empty).toContainText('helps you decide what to clarify');
  await expect(empty).toContainText('Ask Interview coach');
  // Before Design there is no design to review or solve.
  await expect(coach(page).getByRole('button', { name: 'Review my design' })).toHaveCount(0);
  await expect(coach(page).getByTestId('partner-solve')).toHaveCount(0);
  if (SHOTS) {
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/desktop-13-coach.png` });
  }
  await empty.getByRole('button', { name: 'Which questions should I ask first, and why?' }).click();
  await expect(composer(page)).toHaveValue('Which questions should I ask first, and why?');
  await composer(page).press('Enter');
  await expect(coach(page).getByTestId('partner-turn')).toHaveCount(1);
  // No change cards from the coach outside "Show me the changes".
  await expect(coach(page).getByTestId('change-card')).toHaveCount(0);
  expect(partner.created).toEqual([{ context: { kind: 'prep', problemId: 'url-shortener' } }]);
  expect(partner.bodies[0]).toMatchObject({ intent: 'chat', message: 'Which questions should I ask first, and why?', prep: { stage: 'clarify', questions: 'How many new links a day?' } });
  await expect(page.getByText('Design partner')).toHaveCount(0);

  // The next stage: the same chat, the turn says where the candidate is now.
  await page.getByTestId('stage-next').click();
  await composer(page).fill('Is my method right?');
  await composer(page).press('Enter');
  await expect(coach(page).getByTestId('partner-turn')).toHaveCount(2);
  expect(partner.created).toHaveLength(1);
  expect(partner.bodies[1].prep).toMatchObject({ stage: 'estimate', questions: 'How many new links a day?' });
});
