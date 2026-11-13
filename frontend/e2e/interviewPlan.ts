import type { Page } from '@playwright/test';

/** The interview-date plan's API (backend/src/interviewPlan.ts), mocked: the account's plan, and every PUT the page sends. */
export async function mockPlanApi(page: Page, plan: Record<string, unknown> | null = null): Promise<{ puts: Record<string, unknown>[] }> {
  const puts: Record<string, unknown>[] = [];
  // A solve kept in this browser goes to the account on sign-in.
  await page.route('**/api/me/import', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/me/interview-plan', (route) => {
    const method = route.request().method();
    if (method === 'PUT') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      puts.push(body);
      return route.fulfill({ json: { plan: { date: body.date, minutes: body.minutes, start: body.start } } });
    }
    if (method === 'DELETE') return route.fulfill({ status: 204 });
    return route.fulfill({ json: { plan } });
  });
  return { puts };
}

/** `n` days from today (UTC, the tests' time zone), YYYY-MM-DD. */
export const dayFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
