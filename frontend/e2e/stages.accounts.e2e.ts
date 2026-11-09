import type { Locator, Page } from '@playwright/test';
import { mockSignedIn } from './accounts';
import { expect, test } from './fixtures';
import { PartnerMock } from './partner';

/**
 * Design partner on a practice problem's stages (P50), in the build with
 * accounts (API mocked): select any text on a stage and ask about it, from
 * the floating button (touch) or the right-click menu; the quote lands in the
 * composer. With STAGES_SHOTS=<dir>, saves the menu and the button.
 */

const SHOTS = process.env.STAGES_SHOTS;

test.use({ stages: 'fresh' });

const composer = (page: Page) => page.getByRole('region', { name: 'Design partner' }).getByRole('textbox', { name: 'Message Design partner' });

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

async function openClarify(page: Page) {
  await mockSignedIn(page);
  await new PartnerMock().mock(page);
  // The stages are on the roadmap only (P51); a first visit opens on Clarify (P52).
  await page.goto('practice/#/roadmap/url-shortener');
  const brief = page.getByTestId('brief');
  await expect(brief).toBeVisible();
  // A click shows the whole brief at once.
  await brief.click();
  await expect(brief).not.toHaveAttribute('data-typing', 'true');
  return brief;
}

test('select text on a stage, then "Ask Design partner": the quote is in the composer', async ({ page }) => {
  const brief = await openClarify(page);
  await select(brief.locator('.ps-brief-body p').first());
  const ask = page.getByTestId('ask-selection');
  await expect(ask).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/desktop-11-select-button.png` });
  await ask.click();
  await expect(composer(page)).toBeFocused();
  await expect(composer(page)).toHaveValue(/^> Design a service that turns long URLs into short codes[^\n]*\n\n$/);
  await expect(ask).toHaveCount(0);

  // Right-click on a selection: a menu with "Ask Design partner"; the quote goes after what is typed.
  await composer(page).fill('What should I ask first?');
  const item = brief.getByRole('listitem').first();
  await select(item);
  await item.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Selection' });
  await expect(menu.getByRole('menuitem', { name: 'Ask Design partner' })).toBeFocused();
  await expect(menu.getByRole('menuitem', { name: 'Copy' })).toBeVisible();
  if (SHOTS) {
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/desktop-12-select-menu.png` });
  }
  await menu.getByRole('menuitem', { name: 'Ask Design partner' }).click();
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

test('on a phone, Design partner is a bottom sheet on every stage', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openClarify(page);
  await page.getByTestId('stage-bar').getByTestId('partner-button').click();
  const sheet = page.getByRole('dialog', { name: 'Design partner' });
  await expect(sheet).toBeVisible();
  if (SHOTS) {
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/phone-11-partner-sheet.png` });
  }
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});
