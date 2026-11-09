import { mockSignedIn, SIGNED_IN } from './accounts';
import { expect, test } from './fixtures';
import { dayFromNow, mockPlanApi } from './interviewPlan';

/**
 * The interview-date plan in the build with accounts but no paid plans: it
 * costs nothing to run, so it follows the server like interview_report
 * (P53, P54): an account on Max set by hand keeps it; any other sees neither
 * the plan nor a way to Max.
 */

test('an account on Max set by hand keeps the plan', async ({ page }) => {
  await mockSignedIn(page, { ...SIGNED_IN, user: { ...SIGNED_IN.user, plan: 'max' } });
  await mockPlanApi(page, { date: dayFromNow(12), minutes: 45, start: dayFromNow(0) });
  await page.goto('practice/#/roadmap');
  await expect(page.getByRole('region', { name: 'Interview plan' }).getByTestId('plan-days-left')).toHaveText('12');
});

test('a free account sees no plan and no way to Max', async ({ page }) => {
  await mockSignedIn(page, { ...SIGNED_IN, user: { ...SIGNED_IN.user, plan: 'free' } });
  await page.goto('practice/#/roadmap');
  await expect(page.getByRole('heading', { name: 'Interview prep roadmap' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Your progress' })).toBeVisible();
  await expect(page.getByTestId('interview-plan')).toHaveCount(0);
  await expect(page.getByTestId('interview-plan-teaser')).toHaveCount(0);
});
