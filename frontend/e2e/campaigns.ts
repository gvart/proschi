import type { Page } from '@playwright/test';

/**
 * The admin's campaign routes (backend/src/campaigns.ts) mocked with state,
 * on top of mockAdmin (e2e/admin.ts), for campaigns.accounts.e2e.ts: one
 * finished campaign, drafts created and changed, the live count, the
 * preview (`previewHtml`, a stand-in unless a screenshot passes the real
 * one), tests, and a send that moves from sending to done after a few reads.
 */

const now = Math.floor(Date.now() / 1000);
const DAY = 86_400;

const stats = (over: Record<string, number> = {}) => ({
  recipients: 0,
  pending: 0,
  granted: 0,
  sent: 0,
  failed: 0,
  skippedOptout: 0,
  skippedUnconfirmed: 0,
  shown: 0,
  dismissed: 0,
  clicked: 0,
  unsubscribes: 0,
  ...over,
});

export const DONE_CAMPAIGN = {
  id: 'camp-done',
  status: 'done',
  audience: { type: 'active', days: 30 },
  credits: 0,
  email: true,
  inapp: false,
  subject: 'Scale or Fail is out',
  body: 'Hi {{name}}, the arcade is open.',
  link: null,
  reason: 'Arcade launch',
  createdAt: now - 20 * DAY,
  updatedAt: now - 20 * DAY,
  startedAt: now - 20 * DAY,
  finishedAt: now - 20 * DAY,
  stats: stats({ recipients: 12, sent: 10, skippedOptout: 1, skippedUnconfirmed: 1, unsubscribes: 1 }),
};

export const COUNT = { accounts: 30, emails: 27, optedOut: 2, unconfirmed: 1 };

const STUB_HTML = '<!doctype html><html><body style="font-family:sans-serif;background:#fff8e7"><h1 id="subject"></h1><div id="body"></div></body></html>';

export async function mockCampaigns(page: Page, { previewHtml, sendingReads = 2 }: { previewHtml?: (draft: Record<string, unknown>) => string; sendingReads?: number } = {}) {
  const campaigns: Record<string, unknown>[] = [DONE_CAMPAIGN];
  const calls: { method: string; path: string; body: Record<string, unknown> | null }[] = [];
  let reads = 0;
  const viewOf = (id: string, draft: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    id,
    status: 'draft',
    audience: draft.audience,
    credits: draft.credits,
    email: draft.email,
    inapp: draft.inapp,
    subject: draft.subject,
    body: draft.body,
    link: draft.linkUrl ? { url: draft.linkUrl, label: draft.linkLabel } : null,
    reason: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    stats: stats(),
    ...extra,
  });
  await page.route(
    (url) => url.pathname.startsWith('/api/admin/campaigns'),
    (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const method = request.method();
      const body = method === 'GET' ? null : (request.postDataJSON() as Record<string, unknown> | null);
      calls.push({ method, path, body });
      if (path === '/api/admin/campaigns' && method === 'GET') {
        return route.fulfill({ json: { campaigns: [...campaigns].reverse(), dailyCap: 500, sentToday: 0, testAddress: 'v***@example.com', emailConfigured: true } });
      }
      if (path === '/api/admin/campaigns' && method === 'POST') {
        const c = viewOf(`camp-${campaigns.length}`, body!);
        campaigns.push(c);
        return route.fulfill({ status: 201, json: c });
      }
      if (path === '/api/admin/campaigns/audience') return route.fulfill({ json: COUNT });
      if (path === '/api/admin/campaigns/preview') return route.fulfill({ json: { subject: body?.subject, text: '', html: previewHtml ? previewHtml(body!) : STUB_HTML.replace('<h1 id="subject"></h1>', `<h1 id="subject">${String(body?.subject ?? '')}</h1>`) } });
      if (path === '/api/admin/campaigns/test') return route.fulfill({ json: { sent: true, to: 'v***@example.com' } });
      const match = /^\/api\/admin\/campaigns\/([^/]+)(?:\/(send|cancel|resume))?$/.exec(path);
      const index = match ? campaigns.findIndex((c) => c.id === match[1]) : -1;
      if (index < 0) return route.fulfill({ status: 404, json: { error: 'No such campaign' } });
      const c = campaigns[index];
      if (match![2] === 'send') {
        campaigns[index] = { ...c, status: 'sending', reason: body?.reason, startedAt: now, stats: stats({ recipients: 30, pending: 30 }) };
        reads = 0;
        return route.fulfill({ json: campaigns[index] });
      }
      if (match![2] === 'cancel') {
        campaigns[index] = { ...c, status: 'cancelled' };
        return route.fulfill({ json: campaigns[index] });
      }
      if (method === 'PUT') {
        campaigns[index] = viewOf(c.id as string, body!);
        return route.fulfill({ json: campaigns[index] });
      }
      // GET: a campaign sending moves on with each read, then is done.
      if (c.status === 'sending') {
        reads++;
        const done = reads > sendingReads;
        campaigns[index] = {
          ...c,
          status: done ? 'done' : 'sending',
          finishedAt: done ? now : null,
          stats: done ? stats({ recipients: 30, granted: 30, sent: 27, skippedOptout: 2, skippedUnconfirmed: 1 }) : stats({ recipients: 30, pending: 18, granted: 12, sent: 11, skippedUnconfirmed: 1 }),
        };
      }
      return route.fulfill({ json: campaigns[index] });
    },
  );
  return calls;
}
