import { mockSignedIn, SIGNED_IN } from './accounts';
import { expect, test } from './fixtures';
import { dayFromNow, mockPlanApi } from './interviewPlan';

/**
 * The interview-date plan on the roadmap (interview_plan, Max; P54), in the
 * build with accounts and paid plans (API mocked): Max picks a date and gets
 * the days left, a strip of every day and today's list, kept on the account;
 * today's items tick off from what was done. Pro sees a short teaser with
 * the way to Max. With PLAN_SHOTS=<dir>, saves screenshots there.
 */

const SHOTS = process.env.PLAN_SHOTS;
const MAX = { ...SIGNED_IN, user: { ...SIGNED_IN.user, plan: 'max' } };
const PRO = { ...SIGNED_IN, user: { ...SIGNED_IN.user, plan: 'pro' } };

test('Max: picks a date and gets a plan for every day, kept on the account', async ({ page }) => {
  await mockSignedIn(page, MAX);
  const api = await mockPlanApi(page);
  await page.goto('practice/#/roadmap');
  const plan = page.getByRole('region', { name: 'Interview plan' });
  await expect(plan.getByText('When is your interview?')).toBeVisible();
  await plan.getByLabel('Interview date').fill(dayFromNow(10));
  await plan.getByLabel('Minutes a day').selectOption('60');
  await plan.getByRole('button', { name: 'Make my plan' }).click();

  await expect(plan.getByTestId('plan-days-left')).toHaveText('10');
  const strip = plan.getByTestId('plan-strip').getByRole('button');
  await expect(strip).toHaveCount(11);
  await expect(strip.first()).toHaveAttribute('data-phase', 'learn');
  await expect(strip.last()).toHaveAttribute('data-phase', 'interview');
  const today = plan.getByTestId('plan-day');
  await expect(today.getByRole('heading')).toContainText('Today');
  await expect(today.getByTestId('plan-items').getByRole('listitem').first()).toBeVisible();

  // The date and minutes, then today's list for the reminder, go to the account.
  await expect.poll(() => api.puts.length).toBeGreaterThanOrEqual(2);
  expect(api.puts[0]).toEqual({ date: dayFromNow(10), minutes: 60, start: dayFromNow(0) });
  expect(api.puts.at(-1)).toMatchObject({ date: dayFromNow(10), today: { day: dayFromNow(0) } });

  if (SHOTS) await plan.screenshot({ path: `${SHOTS}/max-desktop.png` });
  // A mock-interview day shows its list.
  await plan.getByTestId('plan-strip').locator('[data-phase="mock"]').first().click();
  await expect(today.getByRole('heading')).not.toContainText('Today');
  await expect(today.getByTestId('plan-items')).toContainText('Mock interview:');
  if (SHOTS) await plan.screenshot({ path: `${SHOTS}/max-desktop-mock-day.png` });
});

test('Max: the account’s plan wins over this browser’s', async ({ page }) => {
  await mockSignedIn(page, MAX);
  await mockPlanApi(page, { date: dayFromNow(6), minutes: 45, start: dayFromNow(-2) });
  await page.addInitScript((today) => {
    localStorage.setItem(
      'proschi.practice.plan',
      JSON.stringify({
        settings: { date: '2099-01-01', minutes: 30, start: today },
        last: {
          day: today,
          items: [
            { kind: 'problem', key: 'problem:pastebin', problem: 'pastebin', title: 'Try Pastebin', reason: 'Practises storage.', minutes: 15 },
            { kind: 'problem', key: 'problem:chat', problem: 'chat', title: 'Try Chat', reason: 'Practises fan-out.', minutes: 25 },
          ],
        },
      }),
    );
  }, dayFromNow(0));
  await page.goto('practice/#/roadmap');
  const plan = page.getByRole('region', { name: 'Interview plan' });
  // The account's plan replaced this browser's (and with it today's list).
  await expect(plan.getByTestId('plan-days-left')).toHaveText('6');
  await expect(plan).toContainText('45 min a day');
});

test('Max on a phone: the plan fits, the strip scrolls on its own', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockSignedIn(page, MAX);
  await mockPlanApi(page, { date: dayFromNow(21), minutes: 45, start: dayFromNow(0) });
  await page.goto('practice/#/roadmap');
  const plan = page.getByRole('region', { name: 'Interview plan' });
  await expect(plan.getByTestId('plan-days-left')).toHaveText('21');
  await expect(plan.getByTestId('plan-items').getByRole('listitem').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (SHOTS) {
    await plan.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/max-phone.png`, fullPage: false });
  }
});

test('a ticked item: a problem solved today is done', async ({ page }) => {
  await mockSignedIn(page, MAX);
  await mockPlanApi(page, { date: dayFromNow(9), minutes: 45, start: dayFromNow(0) });
  await page.addInitScript((today) => {
    localStorage.setItem('proschi.practice', JSON.stringify({ pastebin: { status: 'solved', source: 'x' } }));
    localStorage.setItem(
      'proschi.practice.plan',
      JSON.stringify({
        settings: { date: new Date(Date.now() + 9 * 86_400_000).toISOString().slice(0, 10), minutes: 45, start: today },
        last: {
          day: today,
          items: [
            { kind: 'problem', key: 'problem:pastebin', problem: 'pastebin', title: 'Try Pastebin', reason: 'Practises storage.', minutes: 15 },
            { kind: 'problem', key: 'problem:chat', problem: 'chat', title: 'Try Chat', reason: 'Practises fan-out.', minutes: 25 },
          ],
        },
      }),
    );
  }, dayFromNow(0));
  await page.goto('practice/#/roadmap');
  const items = page.getByRole('region', { name: 'Interview plan' }).getByTestId('plan-items').getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toHaveAttribute('data-done', 'true');
  await expect(items.nth(1)).not.toHaveAttribute('data-done', 'true');
  await expect(page.getByTestId('plan-day').getByRole('heading')).toContainText('1 of 2 done');
});

test('Pro: a short teaser with the way to Max, and nothing asked of the plan API', async ({ page }) => {
  await mockSignedIn(page, PRO);
  const asked: string[] = [];
  page.on('request', (r) => r.url().includes('/api/me/interview-plan') && asked.push(r.url()));
  await page.goto('practice/#/roadmap');
  const teaser = page.getByTestId('interview-plan-teaser');
  await expect(teaser).toContainText('Interview plan · Max');
  await expect(teaser.getByRole('link', { name: 'Get Max' })).toHaveAttribute('href', /pricing/);
  await expect(page.getByTestId('interview-plan')).toHaveCount(0);
  if (SHOTS) await teaser.screenshot({ path: `${SHOTS}/pro-teaser.png` });
  expect(asked).toEqual([]);
});
