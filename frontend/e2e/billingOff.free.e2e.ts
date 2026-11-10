import type { Page } from '@playwright/test';
import { mockSignedIn, SIGNED_IN } from './accounts';
import { expect, STAGES_KEY, test, toSetupStep } from './fixtures';
import { FREE, MAX, mockSolo } from './history';

/**
 * The build with accounts but no paid plans (`npm run build:accounts-free`,
 * no VITE_BILLING): signed in, and the mocked server even says every feature
 * is on, yet nothing that spends credits may show or be asked for. With
 * BILLING_SHOTS=<dir>, saves screenshots there.
 */

const SHOTS = process.env.BILLING_SHOTS;
const METERED = /^\/api\/(partner|credits|voice|roadmap\/next|interviews\/(?!history))/;

/** Signs in and records every metered API call (a call is a failure: nothing may ask for one). */
async function open(page: Page, me = SIGNED_IN) {
  await mockSignedIn(page, me);
  const metered: string[] = [];
  page.on('request', (r) => {
    const { pathname } = new URL(r.url());
    if (METERED.test(pathname)) metered.push(pathname);
  });
  return metered;
}

const noPartner = async (page: Page) => {
  await expect(page.getByTestId('partner-button')).toHaveCount(0);
  await page.keyboard.press('Control+j');
  await expect(page.getByRole('region', { name: 'Design partner' })).toHaveCount(0);
};

test('the editor has no Design partner tab or Ctrl+J', async ({ page }) => {
  const metered = await open(page);
  await page.goto('app/?example=url-shortener');
  await expect(page.locator('.cm-content').first()).toContainText('->');
  await noPartner(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/editor.png` });
  expect(metered).toEqual([]);
});

test('a roadmap problem opened on Design has no Design partner', async ({ page }) => {
  const metered = await open(page);
  await page.goto('practice/#/roadmap/url-shortener');
  await expect(page.locator('.cm-content').first()).toBeVisible();
  await noPartner(page);
  await expect(page.getByTestId('ask-selection')).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/problem-design.png` });
  expect(metered).toEqual([]);
});

test.describe('on Clarify', () => {
  test.use({ stages: 'fresh' });

  test('selecting text offers no "Ask Design partner"', async ({ page }) => {
    const metered = await open(page);
    // Started (notes saved), so it opens on Clarify, not the lesson (P52).
    await page.addInitScript((key) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ stage: 'clarify', reached: 'clarify' }));
    }, `${STAGES_KEY}url-shortener`);
    await page.goto('practice/#/roadmap/url-shortener');
    const brief = page.getByTestId('brief');
    await expect(brief).toBeVisible();
    await brief.click();
    await noPartner(page);
    await expect(page.getByTestId('stage-bar')).toBeVisible();
    await brief.locator('.ps-brief-body p').first().evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await brief.getByRole('listitem').first().click({ button: 'right' });
    await expect(page.getByTestId('ask-selection')).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Ask Design partner' })).toHaveCount(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/problem-clarify.png` });
    expect(metered).toEqual([]);
  });
});

test('the mock interview set-up is the solo one: no interviewer, credits or voice', async ({ page }) => {
  const metered = await open(page);
  await page.goto('practice/#/interview?problem=url-shortener&with=mock');
  const setup = page.getByTestId('interview-setup');
  await expect(setup).toBeVisible();
  await expect(setup).toHaveAttribute('data-step', 'problem');
  await expect(page.getByText('Who interviews you?')).toHaveCount(0);
  await toSetupStep(page, 'length');
  await toSetupStep(page);
  await expect(page.getByRole('button', { name: 'Start the mock interview' })).toHaveCount(0);
  await expect(page.getByText(/credits/i)).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/interview-setup.png` });
  expect(metered).toEqual([]);
});

test('a mock interview left open in the browser is not resumed: the room address goes to the set-up', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('proschi.aiInterview.url-shortener', JSON.stringify('stale-id')));
  const metered = await open(page);
  await page.goto('practice/#/interview/url-shortener');
  await expect(page.getByTestId('interview-setup')).toBeVisible();
  expect(metered).toEqual([]);
});

test('the roadmap and the progress page have no AI picks, report or credits', async ({ page }) => {
  const metered = await open(page);
  await page.goto('practice/#/roadmap');
  await expect(page.getByRole('heading', { name: 'Interview prep roadmap' })).toBeVisible();
  // The free, rule-based next steps stay; the AI picks and the way to them don't.
  await expect(page.getByTestId('next-steps')).toBeVisible();
  await expect(page.getByTestId('roadmap-picks')).toHaveCount(0);
  await expect(page.getByTestId('next-for-you-upgrade')).toHaveCount(0);
  await expect(page.getByTestId('account-credits')).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/roadmap.png` });
  await page.goto('practice/#/progress');
  await expect(page.getByText('Your next steps')).toHaveCount(0);
  await expect(page.getByTestId('verdict-report')).toHaveCount(0);
  expect(metered).toEqual([]);
});

test.describe('interviews on your own, which cost nothing to run', () => {
  test('an account on Max set by hand keeps the trend per skill and the report', async ({ page }) => {
    const metered = await open(page, MAX);
    await mockSolo(page);
    await page.goto('practice/#/progress');
    const solo = page.getByRole('region', { name: 'Interviews on your own' });
    await expect(solo.getByTestId('solo-trends').getByRole('figure')).toHaveCount(4);
    await expect(solo.getByTestId('solo-report')).toHaveCount(3);
    await expect(solo.getByTestId('solo-upgrade')).toHaveCount(0);
    if (SHOTS) await solo.screenshot({ path: `${SHOTS}/solo-max.png` });
    expect(metered).toEqual([]);
  });

  test('a free account sees this browser’s sessions, with no trend, report or way to Pro', async ({ page }) => {
    const metered = await open(page, FREE);
    const asked = await mockSolo(page);
    await page.goto('practice/#/progress');
    const solo = page.getByRole('region', { name: 'Interviews on your own' });
    await expect(solo.getByTestId('solo-list').getByRole('listitem')).toHaveCount(2);
    await expect(solo.getByTestId('solo-trends')).toHaveCount(0);
    await expect(solo.getByTestId('solo-report')).toHaveCount(0);
    await expect(solo.getByTestId('solo-upgrade')).toHaveCount(0);
    await expect(page.getByText('Upgrade to Pro')).toHaveCount(0);
    expect(asked).not.toContain('GET');
    if (SHOTS) await solo.screenshot({ path: `${SHOTS}/solo-free.png` });
    expect(metered).toEqual([]);
  });
});
