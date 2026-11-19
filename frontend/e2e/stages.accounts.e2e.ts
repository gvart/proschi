import type { Locator, Page } from '@playwright/test';
import { mockSignedIn } from './accounts';
import { expect, STAGES_KEY, test } from './fixtures';
import { PartnerMock } from './partner';

/**
 * Design partner on a roadmap problem (P50), in the build with accounts (API
 * mocked): not offered on the interview prep stages, only in the full
 * editor, where any selected text can be asked about, from the floating
 * button (touch) or the right-click menu; the quote lands in the composer.
 * With STAGES_SHOTS=<dir>, saves the menu and the button.
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

/** Opens url-shortener on the roadmap with these stage notes saved (P51, P52). */
async function open(page: Page, notes: object) {
  await mockSignedIn(page);
  await new PartnerMock().mock(page);
  await page.addInitScript(
    ([key, value]) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, value);
    },
    [`${STAGES_KEY}url-shortener`, JSON.stringify(notes)] as const,
  );
  await page.goto('practice/#/roadmap/url-shortener');
}

const openClarify = (page: Page) => open(page, { stage: 'clarify', reached: 'clarify' });
const openEditor = (page: Page) => open(page, { stage: 'design', reached: 'design', editor: true });

test('the stages offer no Design partner', async ({ page }) => {
  await openClarify(page);
  const brief = page.getByTestId('brief');
  await expect(brief).toBeVisible();
  await brief.click();
  await expect(brief).not.toHaveAttribute('data-typing', 'true');
  await expect(page.getByTestId('partner-button')).toHaveCount(0);
  await select(brief.locator('.ps-brief-body p').first());
  await brief.dispatchEvent('mouseup');
  await expect(page.getByTestId('ask-selection')).toHaveCount(0);
});

test('in the full editor, select text, then "Ask Design partner": the quote is in the composer', async ({ page }) => {
  await openEditor(page);
  const statement = page.locator('[data-tour="statement"]');
  await expect(statement).toBeVisible();
  await expect(page.getByTestId('partner-button')).toBeVisible();
  const para = statement.locator('p').first();
  const text = (await para.innerText()).trim();
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await select(para);
  await para.dispatchEvent('mouseup');
  const ask = page.getByTestId('ask-selection');
  await expect(ask).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/desktop-11-select-button.png` });
  await ask.click();
  await expect(composer(page)).toBeFocused();
  expect(await composer(page).inputValue()).toMatch(new RegExp(`^> ${escape(text.slice(0, 20))}`));
  await expect(ask).toHaveCount(0);

  // Right-click on a selection: a menu with "Ask Design partner"; the quote goes after what is typed.
  await composer(page).fill('What should I ask first?');
  await select(para);
  await para.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Selection' });
  await expect(menu.getByRole('menuitem', { name: 'Ask Design partner' })).toBeFocused();
  await expect(menu.getByRole('menuitem', { name: 'Copy' })).toBeVisible();
  if (SHOTS) {
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/desktop-12-select-menu.png` });
  }
  await menu.getByRole('menuitem', { name: 'Ask Design partner' }).click();
  await expect(menu).toHaveCount(0);
  await expect(composer(page)).toHaveValue(/^What should I ask first\?\n\n> /);
});

test('on a phone, Design partner is a bottom sheet in the full editor only', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openClarify(page);
  await expect(page.getByTestId('brief')).toBeVisible();
  await expect(page.getByTestId('partner-button')).toHaveCount(0);

  // Into the full editor (as "Full editor" on the Design stage would).
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ stage: 'design', reached: 'design', editor: true })), `${STAGES_KEY}url-shortener`);
  await page.reload();
  await page.getByTestId('partner-button').click();
  const sheet = page.getByRole('dialog', { name: 'Design partner' });
  await expect(sheet).toBeVisible();
  if (SHOTS) {
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/phone-11-partner-sheet.png` });
  }
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});
