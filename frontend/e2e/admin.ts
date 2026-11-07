import type { Page } from '@playwright/test';

/**
 * The admin API (backend/src/admin.ts) mocked with seeded data, for
 * admin.accounts.e2e.ts: a handful of accounts, one comped, subscribers, pack
 * orders and a refund, 30 days of AI interviews and reviews, the overview's
 * trends for any range, Polar's webhook deliveries, short and live share
 * links, app events, the audit log and passkeys. Times are Unix seconds, as
 * the admin API answers them.
 */

export const USER = '22222222-2222-4222-8222-222222222222';
export const PRO_USER = '33333333-3333-4333-8333-333333333333';

const DAY = 86_400;
const now = Math.floor(Date.now() / 1000);
const today = new Date().toISOString().slice(0, 10);
export const days = Array.from({ length: 30 }, (_, i) => new Date(Date.now() - (29 - i) * 86_400_000).toISOString().slice(0, 10));

/** A smooth, repeatable wave: the seeded numbers per day. */
const wave = (i: number, base: number, amp: number, phase = 0) => Math.max(0, Math.round(base + amp * Math.sin(i / 3 + phase) + (i % 5) - 2));

export const OVERVIEW = {
  users: { total: 1284, blocked: 3, public: 212, emailReminders: 341, new: { day: 14, week: 88, month: 352 }, active: { day: 96, week: 298, month: 611 } },
  signups: days.map((day) => ({ day, count: day === today ? 1 : 0 })),
  content: { shares: 917, documents: 2_406, attempts: 5_830, solves: 3_112, cardReviews: 48_221, challenges: 7_904, gameRuns: 2_689 },
  usage: { events: ['editor_open', 'practice_open'], days: days.map((day) => ({ day, counts: day === today ? { editor_open: 41 } : {} })) },
  events: [
    { kind: 'server_error', level: 'error', n: 2 },
    { kind: 'rate_limited', level: 'warn', n: 5 },
  ],
  aiSpend: days.map((day, i) => ({ day, costUsd: wave(i, 9, 4) * 0.37 })),
};

/**
 * The overview's trends (GET /api/admin/trends?days=): `days` and as many
 * before them, a growing product with weekly rhythm: sign-ups, weekly
 * actives, AI interviews and spend, Pro subscribers, pack orders, and a
 * webhook failure now and then.
 */
export function trends(days: number) {
  const span = 2 * days;
  const day = (i: number) => new Date(Date.now() - (span - 1 - i) * 86_400_000).toISOString().slice(0, 10);
  const points = Array.from({ length: span }, (_, i) => {
    // 0 at 180 days ago, 1 today: everything grows with it.
    const g = (180 - span + i) / 180;
    const weekend = new Date(Date.now() - (span - 1 - i) * 86_400_000).getUTCDay() % 6 === 0;
    const started = Math.max(0, Math.round((4 + 6 * g) * (weekend ? 0.6 : 1) + 2 * Math.sin(i / 2.3)));
    return {
      day: day(i),
      signups: Math.max(0, Math.round((6 + 10 * g) * (weekend ? 0.55 : 1) + 3 * Math.sin(i / 1.7))),
      active: Math.round(140 + 160 * g + 12 * Math.sin(i / 3.5)),
      interviewsStarted: started,
      interviewsFinished: Math.max(0, started - (i % 5 === 0 ? 1 : 0)),
      aiCostUsd: Math.round(started * (0.38 + 0.08 * Math.sin(i)) * 100) / 100,
      topupOrders: (i * 7) % 11 < 3 ? 1 + (i % 2) : 0,
      webhookFailures: i % 23 === 4 ? 2 : i % 17 === 9 ? 1 : 0,
      proSubscribers: Math.round(18 + 34 * g + (i % 9 === 0 ? -1 : 0)),
    };
  });
  return {
    days,
    from: day(0),
    to: day(span - 1),
    points,
    usage: { events: ['editor_open', 'practice_open'], days: points.map((p, i) => ({ day: p.day, counts: { editor_open: 30 + p.signups * 4 + (i % 7), practice_open: 12 + p.signups } })) },
  };
}

export const USERS = {
  total: 2,
  offset: 0,
  pageSize: 50,
  users: [
    { id: USER, displayName: 'spammer9000', publicProfile: false, createdAt: 1_800_000_000, lastSeenDay: today, blockedAt: null, blockedReason: null, providers: ['google'], solved: 0, hasEmail: false },
    { id: PRO_USER, displayName: 'Ada Lovelace', publicProfile: true, createdAt: 1_790_000_000, lastSeenDay: today, blockedAt: null, blockedReason: null, providers: ['github'], solved: 12, hasEmail: true },
  ],
};

const LEDGER = [
  { id: 9, kind: 'admin_grant', bucket: 'topup', period: null, credits: 25, item: 'admin', refId: 'admin:7c1e2a40-0b8f-4c3e-9a51-1d2e3f4a5b6c', createdAt: now - 2 * DAY },
  { id: 8, kind: 'settle', bucket: 'topup', period: null, credits: -12.348, item: 'mock_interview', refId: '5b0a…-hold:topup', createdAt: now - 3 * DAY },
  { id: 7, kind: 'settle', bucket: 'monthly', period: today.slice(0, 7), credits: -37.652, item: 'mock_interview', refId: '5b0a…-hold:monthly', createdAt: now - 3 * DAY },
  { id: 6, kind: 'settle', bucket: 'monthly', period: today.slice(0, 7), credits: -41.2, item: 'verdict', refId: 'a91f…-hold:monthly', createdAt: now - 4 * DAY },
  { id: 5, kind: 'monthly_grant', bucket: 'monthly', period: today.slice(0, 7), credits: 800, item: 'pro', refId: 'monthly:…', createdAt: now - 6 * DAY },
  { id: 4, kind: 'topup', bucket: 'topup', period: null, credits: 1000, item: 'credits_1000', refId: 'ord_01JAZ4X9Q2', createdAt: now - 9 * DAY },
  { id: 3, kind: 'signup_grant', bucket: 'signup', period: null, credits: 100, item: 'signup', refId: 'signup:…', createdAt: now - 20 * DAY },
];

export function userDetail(id: string, state: { blocked?: boolean; compUntil?: number | null } = {}) {
  const pro = id === PRO_USER;
  const compUntil = state.compUntil ?? null;
  return {
    user: {
      id,
      displayName: pro ? 'Ada Lovelace' : 'spammer9000',
      publicProfile: pro,
      dailyGoal: 10,
      createdAt: 1_800_000_000,
      lastSeenDay: today,
      blockedAt: state.blocked ? 1_800_000_100 : null,
      blockedReason: state.blocked ? 'spam' : null,
      plan: pro ? 'pro' : 'free',
      compUntil,
      effectivePlan: pro || (compUntil && compUntil > now) ? 'pro' : 'free',
    },
    billing: pro
      ? { polarCustomerId: 'cus_01JAZ2K7M3', polarSubscriptionId: 'sub_01JAZ2K9P0', status: 'active', product: 'pro_monthly', currentPeriodEnd: now + 18 * DAY, cancelAtPeriodEnd: false, pastDue: false, updatedAt: now - 12 * DAY }
      : null,
    credits: pro
      ? { balance: 1733.8, monthly: { allowance: 800, left: 721.148, resetsAt: now + 20 * DAY }, signup: 0, topup: 1012.652 }
      : { balance: 100, monthly: null, signup: 100, topup: 0 },
    polarDashboard: { server: 'sandbox', customers: 'https://sandbox.polar.sh/to/dashboard/customers', orders: 'https://sandbox.polar.sh/to/dashboard/sales' },
    identities: [{ provider: pro ? 'github' : 'google', subject: pro ? 'gh-1815' : 'g-77' }],
    sessions: state.blocked ? [] : [{ kind: 'web', count: 1, lastCreatedAt: 1_800_000_000 }],
    progress: [],
    cards: { reviews: 0, cards: 0, lastReviewAt: null },
    achievements: 0,
    lessonsRead: 0,
    challenges: { submitted: 0, best: null, lastDay: null },
    game: { runs: 0, submitted: 0, best: null, lastStartedAt: null },
    shares: pro ? [] : [{ id: 'AbCdEf1234', title: 'Buy cheap stuff', createdAt: 1_800_000_000, hasImage: false }],
    documents: { count: pro ? 4 : 0, bytes: pro ? 18_400 : 0, lastUpdatedAt: null },
    email: null,
    audit: state.blocked ? [{ id: 1, at: 1_800_000_100, action: 'user.block', detail: { reason: 'spam' } }] : [],
  };
}

export const ledger = (id: string) => ({ total: id === PRO_USER ? LEDGER.length : 0, offset: 0, pageSize: 50, entries: id === PRO_USER ? LEDGER : [] });

const owner = (id: string, displayName: string) => ({ id, displayName });

export const BILLING = {
  counts: { pro: 4, max: 1, monthly: 2, yearly: 1, maxMonthly: 1, maxYearly: 0, pastDue: 1, canceling: 1, comped: 1, topupOrdersThisMonth: 3, topupOrders: 7, refundedThisMonth: 1, refunded: 2 },
  total: 5,
  offset: 0,
  pageSize: 50,
  pro: [
    { id: PRO_USER, displayName: 'Ada Lovelace', plan: 'pro', source: 'subscription', compUntil: null, polarCustomerId: 'cus_01JAZ2K7M3', status: 'active', product: 'pro_monthly', currentPeriodEnd: now + 18 * DAY, cancelAtPeriodEnd: false },
    { id: '44444444-4444-4444-8444-444444444444', displayName: 'Grace Hopper', plan: 'pro', source: 'subscription', compUntil: null, polarCustomerId: 'cus_01JB0Q4T1R', status: 'past_due', product: 'pro_yearly', currentPeriodEnd: now + 2 * DAY, cancelAtPeriodEnd: false },
    { id: '55555555-5555-4555-8555-555555555555', displayName: 'Katherine Johnson', plan: 'pro', source: 'subscription', compUntil: null, polarCustomerId: 'cus_01JB1C8W5D', status: 'active', product: 'pro_monthly', currentPeriodEnd: now + 9 * DAY, cancelAtPeriodEnd: true },
    { id: '77777777-7777-4777-8777-777777777777', displayName: 'Margaret Hamilton', plan: 'max', source: 'subscription', compUntil: null, polarCustomerId: 'cus_01JB2M3X6E', status: 'active', product: 'max_monthly', currentPeriodEnd: now + 24 * DAY, cancelAtPeriodEnd: false },
    { id: '66666666-6666-4666-8666-666666666666', displayName: 'Linus Speaker', plan: 'pro', source: 'comp', compUntil: now + 45 * DAY, polarCustomerId: null, status: null, product: null, currentPeriodEnd: null, cancelAtPeriodEnd: false },
  ],
  orders: [
    { orderId: 'ord_01JC7N2V8F', credits: 1000, createdAt: now - 1 * DAY, refunded: false, user: owner(PRO_USER, 'Ada Lovelace') },
    { orderId: 'ord_01JC5H6Y3A', credits: 1000, createdAt: now - 3 * DAY, refunded: true, user: owner('44444444-4444-4444-8444-444444444444', 'Grace Hopper') },
    { orderId: 'ord_01JBZ0T4K9', credits: 1000, createdAt: now - 6 * DAY, refunded: false, user: owner('55555555-5555-4555-8555-555555555555', 'Katherine Johnson') },
  ],
  adjustments: [
    { kind: 'admin_grant', refId: 'admin:7c1e2a40', delta: 25, createdAt: now - 2 * DAY, user: owner(PRO_USER, 'Ada Lovelace') },
    { kind: 'topup_revoke', refId: 'ord_01JC5H6Y3A', delta: -1000, createdAt: now - 2 * DAY - 3600, user: owner('44444444-4444-4444-8444-444444444444', 'Grace Hopper') },
  ],
  refundedOrders: [{ orderId: 'ord_01JC5H6Y3A', refundedAt: now - 2 * DAY - 3600, user: owner('44444444-4444-4444-8444-444444444444', 'Grace Hopper') }],
  polarDashboard: { server: 'sandbox', customers: 'https://sandbox.polar.sh/to/dashboard/customers', orders: 'https://sandbox.polar.sh/to/dashboard/sales' },
  billing: true,
};

const aiDays = days.map((day, i) => {
  const started = wave(i, 6, 3);
  const failed = i % 6 === 2 ? 1 : 0;
  const finished = Math.max(0, started - failed - (i % 4 === 0 ? 1 : 0));
  const tokens = started * 210_000 + (i % 3) * 40_000;
  const costUsd = (tokens / 1_000_000) * 1.9;
  const chargedCostUsd = costUsd * 0.97;
  const credits = Math.round(chargedCostUsd * 2 * 0.95 * 100 * 1000) / 1000;
  return { day, started, finished, failed, reviews: wave(i, 11, 5, 1), tokens, costUsd, credits, chargedEur: credits / 100, chargedCostUsd };
});

export const AI = {
  days: aiDays,
  totals: {
    sessions: aiDays.reduce((s, d) => s + d.started, 0),
    finished: aiDays.reduce((s, d) => s + d.finished, 0),
    tokens: aiDays.reduce((s, d) => s + d.tokens, 0),
    costUsd: aiDays.reduce((s, d) => s + d.costUsd, 0),
    avgCostPerFinished: 0.42,
    capped: 4,
    cappedShare: 4 / aiDays.reduce((s, d) => s + d.started, 0),
    reviews: aiDays.reduce((s, d) => s + d.reviews, 0),
    credits: aiDays.reduce((s, d) => s + d.credits, 0),
    chargedEur: aiDays.reduce((s, d) => s + d.chargedEur, 0),
    chargedCostUsd: aiDays.reduce((s, d) => s + d.chargedCostUsd, 0),
  },
  tokenCap: 600_000,
  cappedAt: 540_000,
  topUsers: [
    { id: PRO_USER, displayName: 'Ada Lovelace', sessions: 14, tokens: 3_900_000, costUsd: 7.41 },
    { id: '44444444-4444-4444-8444-444444444444', displayName: 'Grace Hopper', sessions: 9, tokens: 2_350_000, costUsd: 4.47 },
    { id: '55555555-5555-4555-8555-555555555555', displayName: 'Katherine Johnson', sessions: 6, tokens: 1_480_000, costUsd: 2.81 },
  ],
};

export const WEBHOOKS = {
  deliveries: [
    { id: 12, at: now - 600, webhookId: 'msg_2pQ9vL1kX7', type: 'order.paid', outcome: 'applied', user: owner(PRO_USER, 'Ada Lovelace') },
    { id: 11, at: now - 3_600, webhookId: 'msg_2pQ8tR4mZ2', type: 'subscription.updated', outcome: 'stale', user: owner('44444444-4444-4444-8444-444444444444', 'Grace Hopper') },
    { id: 10, at: now - 7_200, webhookId: null, type: null, outcome: 'bad_signature', user: null },
    { id: 9, at: now - 2 * DAY, webhookId: 'msg_2pP1aB6cD3', type: 'order.refunded', outcome: 'applied', user: owner('44444444-4444-4444-8444-444444444444', 'Grace Hopper') },
    { id: 8, at: now - 2 * DAY - 30, webhookId: 'msg_2pP1aB6cD3', type: 'order.refunded', outcome: 'duplicate', user: owner('44444444-4444-4444-8444-444444444444', 'Grace Hopper') },
    { id: 7, at: now - 3 * DAY, webhookId: 'msg_2pN7eF2gH8', type: 'checkout.updated', outcome: 'ignored', user: null },
    { id: 6, at: now - 12 * DAY, webhookId: 'msg_2pK3iJ9kL4', type: 'subscription.active', outcome: 'applied', user: owner(PRO_USER, 'Ada Lovelace') },
  ],
  counts: [
    { outcome: 'applied', n: 2 },
    { outcome: 'bad_signature', n: 1 },
    { outcome: 'duplicate', n: 1 },
    { outcome: 'ignored', n: 1 },
    { outcome: 'stale', n: 1 },
  ],
  next: null,
};

export const LIVE_SHARES = {
  total: 1,
  offset: 0,
  pageSize: 50,
  links: [
    {
      token: 'AbCdEfGhIjKlMnOpQrStUv',
      url: 'https://proschi.app/share/AbCdEfGhIjKlMnOpQrStUv',
      document: { id: 'doc1', name: 'checkout.proschi' },
      createdAt: now - 5 * DAY,
      revokedAt: null,
      owner: { id: PRO_USER, displayName: 'Ada Lovelace', blocked: false },
    },
  ],
};

export const HEALTH = {
  checkedAt: now,
  worker: { environment: 'production', simVersion: 1, versionId: '96faa81e-c531-46fa-913f-71b1cfdc7e37', deployedAt: new Date((now - 3 * 3600) * 1000).toISOString() },
  database: { ok: true, latencyMs: 2, sizeBytes: 2_400_000, migration: '0023_admin_paid.sql', tables: { users: 3, billing: 3, billing_webhooks: 7, credits: 21, ai_interviews: 140 } },
  cron: {
    jobs: ['reminders', 'sessions', 'billing_webhooks'],
    runs: [
      { job: 'billing_webhooks', level: 'info', at: now - 5 * 3600, detail: { deleted: 0, ms: 3 } },
      { job: 'reminders', level: 'info', at: now - 1800, detail: { sent: 2, ms: 40 } },
      { job: 'sessions', level: 'info', at: now - 5 * 3600, detail: { deleted: 4, admin: 0, ms: 5 } },
    ],
  },
  errors: {},
  lastError: null,
  email: { total: 1, confirmed: 1, paused: 0, bound: true, sentLast7Days: 3 },
  config: {
    sessionSecret: true,
    providers: ['github', 'google'],
    appRedirects: true,
    metricsToken: true,
    setupToken: false,
    anthropicKey: true,
    aiGateway: false,
    polar: { accessToken: true, webhookSecret: true, productProMonthly: true, productProYearly: true, productMaxMonthly: true, productMaxYearly: true, productCredits1000: false },
    polarServer: 'sandbox',
    billing: false,
  },
};

const SHARES = {
  total: 4,
  offset: 0,
  pageSize: 50,
  shares: [
    { id: 'Xk29dLq0aZ', url: 'https://proschi.app/s/Xk29dLq0aZ', title: 'URL shortener, 99.9% under 120 ms', createdAt: now - 3_600, hasImage: true, bytes: 2_310, owner: { id: PRO_USER, displayName: 'Ada Lovelace', blocked: false } },
    { id: 'Mn7Pq2Rs4T', url: 'https://proschi.app/s/Mn7Pq2Rs4T', title: 'Chat fan-out with a queue', createdAt: now - DAY, hasImage: true, bytes: 3_904, owner: { id: '44444444-4444-4444-8444-444444444444', displayName: 'Grace Hopper', blocked: false } },
    { id: 'AbCdEf1234', url: 'https://proschi.app/s/AbCdEf1234', title: 'Buy cheap stuff', createdAt: now - 3 * DAY, hasImage: false, bytes: 410, owner: { id: USER, displayName: 'spammer9000', blocked: true } },
    { id: 'Qw8Er6Ty4U', url: 'https://proschi.app/s/Qw8Er6Ty4U', title: 'Rate limiter at the edge', createdAt: now - 9 * DAY, hasImage: true, bytes: 1_877, owner: { id: '55555555-5555-4555-8555-555555555555', displayName: 'Katherine Johnson', blocked: false } },
  ],
};

export const EVENTS = {
  events: [
    { id: 40, at: now - 900, level: 'error', kind: 'server_error', message: 'D1_ERROR: database is locked', detail: { route: 'POST /api/problems/:id/runs', status: 500, stack: 'Error: D1_ERROR: database is locked\n    at progress.ts:291' } },
    { id: 39, at: now - 2_400, level: 'warn', kind: 'rate_limited', message: 'Too many runs; wait a minute', detail: { route: 'POST /api/problems/:id/runs' } },
    { id: 38, at: now - 3_600, level: 'info', kind: 'cron', message: 'reminders', detail: { sent: 14, ms: 212 } },
    { id: 37, at: now - 5_400, level: 'error', kind: 'server_error', message: 'Anthropic API answered 529 (overloaded)', detail: { route: 'POST /api/interviews/:id/turns', status: 502 } },
    { id: 36, at: now - 8_000, level: 'warn', kind: 'sign_in_failed', message: 'OAuth state did not match', detail: { provider: 'google' } },
    { id: 35, at: now - 4 * 3_600, level: 'info', kind: 'cron', message: 'billing_webhooks', detail: { deleted: 3, ms: 4 } },
  ],
  kinds: [
    { kind: 'cron', n: 212 },
    { kind: 'rate_limited', n: 31 },
    { kind: 'server_error', n: 6 },
    { kind: 'sign_in_failed', n: 4 },
  ],
  next: null,
};

export const AUDIT = {
  entries: [
    { id: 18, at: now - 1_800, action: 'user.credits.grant', target: PRO_USER, detail: { credits: 2, reason: 'Support ticket 1234' }, passkey: 'Laptop' },
    { id: 17, at: now - 2 * DAY, action: 'user.comp', target: '66666666-6666-4666-8666-666666666666', detail: { until: now + 45 * DAY, reason: 'Conference speaker' }, passkey: 'Laptop' },
    { id: 16, at: now - 3 * DAY, action: 'user.block', target: USER, detail: { reason: 'spam' }, passkey: 'YubiKey' },
    { id: 15, at: now - 3 * DAY - 60, action: 'share.delete', target: 'AbCdEf1234', detail: { owner: USER }, passkey: 'YubiKey' },
    { id: 14, at: now - 6 * DAY, action: 'document_share.revoke', target: 'AbCdEfGhIjKlMnOpQrStUv', detail: { owner: PRO_USER }, passkey: 'Laptop' },
    { id: 13, at: now - 20 * DAY, action: 'admin.passkey.add', target: null, detail: { name: 'YubiKey' }, passkey: 'Laptop' },
  ],
  next: null,
};

export const PASSKEYS = {
  passkeys: [
    { id: 'pk1', name: 'Laptop', transports: ['internal'], createdAt: now - 60 * DAY, lastUsedAt: now - 1_800, current: true },
    { id: 'pk2', name: 'YubiKey', transports: ['usb', 'nfc'], createdAt: now - 20 * DAY, lastUsedAt: now - 3 * DAY, current: false },
  ],
  sessions: 2,
};

/** The Inbox (GET /api/admin/feedback): a bug with a screenshot and a diagram, unread; a proposal in progress; a question done. */
export const FEEDBACK_BUG = '44444444-4444-4444-8444-444444444444';
const sender = { id: USER, displayName: 'Ada Lovelace', blocked: false };
export const FEEDBACK = {
  total: 2,
  offset: 0,
  pageSize: 50,
  counts: { unread: 1, open: 2, new: 1, inProgress: 1, done: 1 },
  messages: [
    {
      id: FEEDBACK_BUG,
      kind: 'bug',
      subject: 'Playback stops at the cache',
      excerpt: 'When I play the checkout use case, the dots stop at the Redis node and never come back.',
      status: 'new',
      createdAt: now - 1_200,
      read: false,
      hasDiagram: true,
      screenshots: 1,
      sender,
    },
    {
      id: '55555555-5555-4555-8555-555555555555',
      kind: 'proposal',
      subject: null,
      excerpt: 'It would help to export the diagram as SVG for slides.',
      status: 'in_progress',
      createdAt: now - 2 * DAY,
      read: true,
      hasDiagram: false,
      screenshots: 0,
      sender: { id: PRO_USER, displayName: 'Grace Hopper', blocked: false },
    },
  ],
};

export const FEEDBACK_DETAIL = {
  id: FEEDBACK_BUG,
  kind: 'bug',
  subject: 'Playback stops at the cache',
  message: 'When I play the checkout use case, the dots stop at the Redis node and never come back.\n\nSteps: open the editor, press Play.\n<script>alert(1)</script>',
  context: {
    path: '/app/',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    viewport: '1440×900',
    plan: 'pro',
    version: { id: 'b1c2d3e4', tag: 'v0.42.0', timestamp: '2026-11-06T10:00:00Z' },
  },
  diagram: 'service api "API"\ndatabase db "Postgres"\napi -> db',
  status: 'new',
  note: null,
  createdAt: now - 1_200,
  updatedAt: now - 1_200,
  sender: { ...sender, email: 'ada@example.com' },
  screenshots: [{ key: 'AAAAAAAAAAAAAAAAAAAAAA', type: 'image/png', bytes: 182_000 }],
};

/** A 1×1 PNG, for the screenshots. */
export const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** Mocks /api/admin/*; returns every change the page sent, with its body. */
export async function mockAdmin(page: Page, status: { passkeys: boolean; setupAvailable: boolean; signedIn: boolean }) {
  const state: { blocked: boolean; compUntil: number | null } = { blocked: false, compUntil: null };
  const posts: { method: string; path: string; body: unknown }[] = [];
  await page.route(
    (url) => url.pathname.startsWith('/api/admin/'),
    (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() !== 'GET') {
        const body = request.postDataJSON() as Record<string, unknown> | null;
        posts.push({ method: request.method(), path, body });
        if (path.endsWith('/block')) state.blocked = true;
        if (path.endsWith('/comp')) state.compUntil = body?.until as number;
        if (path.endsWith('/comp/end')) state.compUntil = null;
        if (path.endsWith('/credits')) return route.fulfill({ json: { delta: body?.kind === 'revoke' ? -Number(body.credits) : Number(body?.credits), credits: {} } });
        if (request.method() === 'PATCH' && path.startsWith('/api/admin/feedback/')) return route.fulfill({ json: { status: body?.status, note: body?.note ?? null } });
        return route.fulfill({ status: 204 });
      }
      if (path === '/api/admin/status') return route.fulfill({ json: status });
      if (path === '/api/admin/overview') return route.fulfill({ json: OVERVIEW });
      if (path === '/api/admin/trends') return route.fulfill({ json: trends(Number(new URL(request.url()).searchParams.get('days'))) });
      if (path === '/api/admin/health') return route.fulfill({ json: HEALTH });
      if (path === '/api/admin/users') return route.fulfill({ json: USERS });
      if (path === '/api/admin/billing') return route.fulfill({ json: BILLING });
      if (path === '/api/admin/ai') return route.fulfill({ json: AI });
      if (path === '/api/admin/webhooks') return route.fulfill({ json: WEBHOOKS });
      if (path === '/api/admin/shares') return route.fulfill({ json: SHARES });
      if (path === '/api/admin/document-shares') return route.fulfill({ json: LIVE_SHARES });
      if (path === '/api/admin/events') return route.fulfill({ json: EVENTS });
      if (path === '/api/admin/audit') return route.fulfill({ json: AUDIT });
      if (path === '/api/admin/passkeys') return route.fulfill({ json: PASSKEYS });
      if (path === '/api/admin/signups') return route.fulfill({ json: { refusedToday: 2, byReason: [{ reason: 'seen_before', n: 1 }, { reason: 'disposable', n: 1 }] } });
      if (/^\/api\/admin\/users\/[^/]+\/sign-in$/.test(path)) {
        return route.fulfill({ json: { methods: ['email'], confirmed: true, confirmedAt: now - DAY, signupCredits: { outcome: 'refused', reason: 'seen_before', decidedAt: now - DAY } } });
      }
      if (path === '/api/admin/feedback') return route.fulfill({ json: FEEDBACK });
      if (path === `/api/admin/feedback/${FEEDBACK_BUG}`) return route.fulfill({ json: FEEDBACK_DETAIL });
      if (path.startsWith(`/api/admin/feedback/${FEEDBACK_BUG}/files/`)) return route.fulfill({ body: PNG_1PX, contentType: 'image/png' });
      const credits = /^\/api\/admin\/users\/([^/]+)\/credits$/.exec(path);
      if (credits) return route.fulfill({ json: ledger(credits[1]) });
      const user = /^\/api\/admin\/users\/([^/]+)$/.exec(path);
      if (user) return route.fulfill({ json: userDetail(user[1], state) });
      return route.fulfill({ status: 404, json: { error: `not mocked: ${path}` } });
    },
  );
  return posts;
}
