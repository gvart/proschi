import { startAuthentication, startRegistration, type PublicKeyCredentialCreationOptionsJSON, type PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { api } from '../services/api';

/**
 * The admin panel's API (backend/src/adminAuth.ts and admin.ts, under
 * /api/admin). The admin session is an HttpOnly cookie of its own; every
 * call is same-origin.
 */

export interface Status {
  passkeys: boolean;
  setupAvailable: boolean;
  signedIn: boolean;
}

export const getStatus = () => api<Status>('/api/admin/status');

/** Registers the first passkey with the setup token; signed in afterwards. */
export async function setUp(setupToken: string, name: string): Promise<void> {
  const options = await api<PublicKeyCredentialCreationOptionsJSON>('/api/admin/setup/options', { method: 'POST', body: { setupToken } });
  const response = await startRegistration({ optionsJSON: options });
  await api('/api/admin/setup', { method: 'POST', body: { setupToken, name, response } });
}

export async function signIn(): Promise<void> {
  const options = await api<PublicKeyCredentialRequestOptionsJSON>('/api/admin/login/options', { method: 'POST' });
  const response = await startAuthentication({ optionsJSON: options });
  await api('/api/admin/login', { method: 'POST', body: { response } });
}

export const signOut = () => api('/api/admin/logout', { method: 'POST' });

export interface Passkey {
  id: string;
  name: string;
  transports: string[];
  createdAt: number;
  lastUsedAt: number | null;
  current: boolean;
}

export const getPasskeys = () => api<{ passkeys: Passkey[]; sessions: number }>('/api/admin/passkeys');

export async function addPasskey(name: string): Promise<void> {
  const options = await api<PublicKeyCredentialCreationOptionsJSON>('/api/admin/passkeys/options', { method: 'POST' });
  const response = await startRegistration({ optionsJSON: options });
  await api('/api/admin/passkeys', { method: 'POST', body: { name, response } });
}

export const deletePasskey = (id: string) => api(`/api/admin/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const revokeAdminSessions = () => api('/api/admin/sessions/revoke-all', { method: 'POST' });

export interface Overview {
  users: {
    total: number;
    blocked: number;
    public: number;
    emailReminders: number;
    new: { day: number; week: number; month: number };
    active: { day: number; week: number; month: number };
  };
  signups: { day: string; count: number }[];
  content: { shares: number; documents: number; attempts: number; solves: number; cardReviews: number; challenges: number; gameRuns: number };
  usage: { events: string[]; days: { day: string; counts: Record<string, number> }[] };
  events: { kind: string; level: string; n: number }[];
  /** What AI interviews cost, by the UTC day they started, in USD. */
  aiSpend: { day: string; costUsd: number }[];
}

export const getOverview = () => api<Overview>('/api/admin/overview');

/** The overview's time ranges, in days. */
export const RANGES = [7, 30, 90] as const;
export type Range = (typeof RANGES)[number];

export interface TrendPoint {
  /** A UTC day, YYYY-MM-DD. */
  day: string;
  signups: number;
  /** Weekly active accounts: any recorded activity in the 7 days to this day. */
  active: number;
  interviewsStarted: number;
  interviewsFinished: number;
  aiCostUsd: number;
  /** Credit top-ups paid. */
  topupOrders: number;
  webhookFailures: number;
  /** Counted back from today's with the webhook log (90 days). */
  proSubscribers: number;
}

/** The range's days and as many before them (2 × days points, oldest first). */
export interface Trends {
  days: Range;
  from: string;
  to: string;
  points: TrendPoint[];
  usage: { events: string[]; days: { day: string; counts: Record<string, number> }[] };
}

export const getTrends = (days: Range) => api<Trends>(`/api/admin/trends?days=${days}`);

export interface CronRun {
  job: string;
  level: string;
  at: number;
  detail: Record<string, unknown> | null;
}

export interface Health {
  checkedAt: number;
  worker: { environment: string; simVersion: number; versionId?: string; versionTag?: string; deployedAt?: string };
  database: { ok: boolean; latencyMs: number; sizeBytes?: number; migration?: string; error?: string; tables: Record<string, number> };
  cron: { jobs: string[]; runs: CronRun[] };
  errors: Record<string, { day: number; week: number }>;
  lastError: { at: number; message: string; detail: Record<string, unknown> | null } | null;
  email: { total: number; confirmed: number; paused: number; bound: boolean; sentLast7Days: number };
  config: {
    sessionSecret: boolean;
    providers: string[];
    appRedirects: boolean;
    metricsToken: boolean;
    setupToken: boolean;
    /** The paid features' configuration: whether each is set, never its value. */
    anthropicKey: boolean;
    aiGateway: boolean;
    polar: { accessToken: boolean; webhookSecret: boolean; productProMonthly: boolean; productProYearly: boolean; productMaxMonthly: boolean; productMaxYearly: boolean; productCredits1000: boolean };
    polarServer: 'sandbox' | 'live';
    billing: boolean;
    /** The Cloudflare usage page's secrets (backend/src/cfUsage.ts). */
    cloudflare?: { apiToken: boolean; accountId: boolean; zoneId: boolean; plan: CfPlan };
  };
}

export const getHealth = () => api<Health>('/api/admin/health');

/** GET /api/admin/cf-usage (backend/src/cfUsage.ts): the Cloudflare account's usage against its plan. */
export type CfPlan = 'free' | 'paid';
export type CfStatus = 'ok' | 'watch' | 'over';

export interface CfMetric {
  id: string;
  product: 'Workers' | 'D1' | 'R2' | 'Email';
  label: string;
  unit: 'requests' | 'ms' | 'rows' | 'bytes' | 'operations' | 'emails';
  kind: 'flow' | 'stock';
  period: 'day' | 'month';
  included: number;
  used: number;
  percent: number;
  periodStart: string;
  periodEnd: string;
  projected: number;
  passesAt: string | null;
  overageUsd: number | null;
  status: CfStatus;
  series: { day: string; value: number }[];
}

export interface CfFreeCheck {
  id: string;
  label: string;
  included: number;
  maxDay: number;
  daysOver7: number;
  daysOver30: number;
}

export interface CfUsage {
  plan: CfPlan;
  planSource: 'subscription' | 'CF_PLAN';
  period: { start: string; end: string; source: 'subscription' | 'calendar' };
  fetchedAt: string;
  cached: boolean;
  metrics: CfMetric[];
  freeTier: CfFreeCheck[];
  costs: { paidBaseUsd: number; paidOverageUsd: number; paidTotalUsd: number };
  errors: { product: string; message: string }[];
  notes: string[];
}

export const getCfUsage = () => api<CfUsage>('/api/admin/cf-usage');

export interface UserRow {
  id: string;
  displayName: string;
  publicProfile: boolean;
  createdAt: number;
  lastSeenDay: string | null;
  blockedAt: number | null;
  blockedReason: string | null;
  providers: string[];
  solved: number;
  hasEmail: boolean;
}

export type UserFilter = 'all' | 'blocked' | 'active' | 'public' | 'email';
export type UserSort = 'created' | 'seen' | 'name' | 'solved';

export const listUsers = (params: { q: string; filter: UserFilter; sort: UserSort; offset: number }) =>
  api<{ total: number; offset: number; pageSize: number; users: UserRow[] }>(`/api/admin/users?${new URLSearchParams({ ...params, offset: String(params.offset) })}`);

export interface AuditEntry {
  id: number;
  at: number;
  action: string;
  target?: string | null;
  detail: Record<string, unknown> | null;
  passkey?: string | null;
}

export interface UserDetail {
  user: {
    id: string;
    displayName: string;
    publicProfile: boolean;
    dailyGoal: number;
    createdAt: number;
    lastSeenDay: string | null;
    blockedAt: number | null;
    blockedReason: string | null;
    /** `users.plan`, e.g. free: what the subscription set. */
    plan: string;
    /** Pro given by the admin until then; null without. */
    compUntil: number | null;
    /** What the account gets now: its plan while subscribed, Pro while comped (a comp never lowers Max). */
    effectivePlan: string;
  };
  billing: Subscription | null;
  /** In credits, 3 decimals: the monthly allowance left (null on free), the sign-up and the top-up credits. */
  credits: UserCredits;
  polarDashboard: PolarDashboard;
  identities: { provider: string; subject: string }[];
  sessions: { kind: string; count: number; lastCreatedAt: number }[];
  progress: { problemId: string; runs: number; firstRunAt: number; updatedAt: number; solvedAt: number | null; runsToSolve: number | null }[];
  cards: { reviews: number; cards: number; lastReviewAt: number | null };
  achievements: number;
  lessonsRead: number;
  challenges: { submitted: number; best: number | null; lastDay: string | null };
  game: { runs: number; submitted: number; best: number | null; lastStartedAt: number | null };
  shares: { id: string; title: string; createdAt: number; hasImage: boolean }[];
  documents: { count: number; bytes: number; lastUpdatedAt: number | null };
  email: { address: string; confirmed: boolean; paused: boolean; reminders: Record<string, boolean>; timeZone: string; lastSentAt: number | null } | null;
  audit: AuditEntry[];
}

/** Polar's dashboard: refunds are done there. Links into it are built by polarLinks.ts. */
export interface PolarDashboard {
  server: 'sandbox' | 'live';
  customers: string;
  orders: string;
  subscriptions: string;
}

export interface Subscription {
  polarCustomerId: string | null;
  polarSubscriptionId: string | null;
  status: string | null;
  product: string | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  pastDue: boolean;
  updatedAt: number | null;
}

export interface UserCredits {
  balance: number;
  monthly: { allowance: number; left: number; resetsAt: number } | null;
  signup: number;
  topup: number;
}

export interface LedgerEntry {
  id: number;
  kind: 'signup_grant' | 'monthly_grant' | 'topup' | 'topup_revoke' | 'settle' | 'admin_grant' | 'admin_revoke' | 'migrated';
  bucket: 'monthly' | 'signup' | 'topup';
  period: string | null;
  /** In credits, 3 decimals. */
  credits: number;
  item: string;
  refId: string;
  createdAt: number;
}

const user = (id: string) => `/api/admin/users/${encodeURIComponent(id)}`;

export const getUser = (id: string) => api<UserDetail>(user(id));
export const patchUser = (id: string, body: { displayName?: string; publicProfile?: boolean }) => api(user(id), { method: 'PATCH', body });
export const blockUser = (id: string, reason: string) => api(`${user(id)}/block`, { method: 'POST', body: { reason } });
export const unblockUser = (id: string) => api(`${user(id)}/unblock`, { method: 'POST' });
export const signOutUser = (id: string) => api<{ sessions: number }>(`${user(id)}/sign-out`, { method: 'POST' });
export const deleteUserEmail = (id: string) => api(`${user(id)}/email`, { method: 'DELETE' });
export const deleteUser = (id: string) => api(user(id), { method: 'DELETE' });
export const listUserCredits = (id: string, offset: number) =>
  api<{ total: number; offset: number; pageSize: number; entries: LedgerEntry[] }>(`${user(id)}/credits?offset=${offset}`);
/** `ref` names this one action: sending it again changes nothing. */
export const adjustCredits = (id: string, body: { kind: 'grant' | 'revoke'; credits: number; ref: string; reason: string }) =>
  api<{ delta: number; duplicate?: boolean }>(`${user(id)}/credits`, { method: 'POST', body });
export const compUser = (id: string, until: number, reason: string) => api(`${user(id)}/comp`, { method: 'POST', body: { until, reason } });
export const endComp = (id: string, reason: string) => api(`${user(id)}/comp/end`, { method: 'POST', body: { reason } });

interface Owner {
  id: string;
  displayName: string;
}

export interface Billing {
  counts: {
    pro: number;
    max: number;
    monthly: number;
    yearly: number;
    maxMonthly: number;
    maxYearly: number;
    pastDue: number;
    canceling: number;
    comped: number;
    topupOrdersThisMonth: number;
    topupOrders: number;
    refundedThisMonth: number;
    refunded: number;
  };
  total: number;
  offset: number;
  pageSize: number;
  pro: {
    id: string;
    displayName: string;
    plan: 'pro' | 'max';
    source: 'subscription' | 'comp' | 'plan';
    compUntil: number | null;
    polarCustomerId: string | null;
    status: string | null;
    product: string | null;
    currentPeriodEnd: number | null;
    cancelAtPeriodEnd: boolean;
  }[];
  orders: { orderId: string; credits: number; createdAt: number; refunded: boolean; user: Owner | null }[];
  adjustments: { kind: string; refId: string; delta: number; createdAt: number; user: Owner | null }[];
  refundedOrders: { orderId: string; refundedAt: number; user: Owner | null }[];
  polarDashboard: PolarDashboard;
  billing: boolean;
}

export const getBilling = (offset: number) => api<Billing>(`/api/admin/billing?offset=${offset}`);

export interface AiDay {
  day: string;
  started: number;
  finished: number;
  failed: number;
  reviews: number;
  tokens: number;
  costUsd: number;
  /** Credits charged that day (credit_charges), and what they are in euros at €0.01 a credit. */
  credits: number;
  chargedEur: number;
  /** What the charged calls cost us, in USD. */
  chargedCostUsd: number;
}

export interface AiUsage {
  days: AiDay[];
  totals: { sessions: number; finished: number; tokens: number; costUsd: number; avgCostPerFinished: number | null; capped: number; cappedShare: number | null; reviews: number; credits: number; chargedEur: number; chargedCostUsd: number };
  tokenCap: number;
  cappedAt: number;
  topUsers: { id: string; displayName: string; sessions: number; tokens: number; costUsd: number }[];
}

export const getAi = () => api<AiUsage>('/api/admin/ai');

export type WebhookOutcome = 'applied' | 'duplicate' | 'ignored' | 'bad_signature' | 'stale' | 'error';

export interface WebhookDelivery {
  id: number;
  at: number;
  webhookId: string | null;
  type: string | null;
  outcome: WebhookOutcome;
  user: Owner | null;
}

export const listWebhooks = (outcome: string, before?: number) =>
  api<{ deliveries: WebhookDelivery[]; counts: { outcome: WebhookOutcome; n: number }[]; next: number | null }>(
    `/api/admin/webhooks?${new URLSearchParams({ outcome, ...(before ? { before: String(before) } : {}) })}`,
  );

export interface LiveShareRow {
  token: string;
  url: string;
  document: { id: string; name: string | null };
  createdAt: number;
  revokedAt: number | null;
  owner: { id: string; displayName: string; blocked: boolean };
}

export const listLiveShares = (q: string, state: 'live' | 'all', offset: number) =>
  api<{ total: number; offset: number; pageSize: number; links: LiveShareRow[] }>(`/api/admin/document-shares?${new URLSearchParams({ q, state, offset: String(offset) })}`);
export const revokeLiveShare = (token: string) => api(`/api/admin/document-shares/${encodeURIComponent(token)}`, { method: 'DELETE' });

export interface ShareRow {
  id: string;
  url: string;
  title: string;
  createdAt: number;
  hasImage: boolean;
  bytes: number;
  owner: { id: string; displayName: string; blocked: boolean };
}

export const listShares = (q: string, offset: number) =>
  api<{ total: number; offset: number; pageSize: number; shares: ShareRow[] }>(`/api/admin/shares?${new URLSearchParams({ q, offset: String(offset) })}`);
export const deleteShare = (id: string) => api(`/api/admin/shares/${encodeURIComponent(id)}`, { method: 'DELETE' });

export interface AppEvent {
  id: number;
  at: number;
  level: 'info' | 'warn' | 'error';
  kind: string;
  message: string;
  detail: unknown;
}

export const listEvents = (params: { kind: string; level: string; before?: number }) =>
  api<{ events: AppEvent[]; kinds: { kind: string; n: number }[]; next: number | null }>(
    `/api/admin/events?${new URLSearchParams({ kind: params.kind, level: params.level, ...(params.before ? { before: String(params.before) } : {}) })}`,
  );

export const listAudit = (before?: number) => api<{ entries: AuditEntry[]; next: number | null }>(`/api/admin/audit${before ? `?before=${before}` : ''}`);

// --- Campaigns (backend/src/campaigns.ts) ----------------------------------

export type Audience =
  | { type: 'all' }
  | { type: 'plan'; plan: 'free' | 'pro' | 'max' }
  | { type: 'active'; days: number }
  | { type: 'signup'; after?: string; before?: string }
  | { type: 'user'; id: string };

/** What the composer sends: `credits` 0 for none. */
export interface CampaignDraft {
  audience: Audience;
  credits: number;
  email: boolean;
  inapp: boolean;
  subject: string;
  body: string;
  linkUrl: string;
  linkLabel: string;
}

export type CampaignStatus = 'draft' | 'sending' | 'done' | 'cancelled';

export interface CampaignStats {
  recipients: number;
  pending: number;
  granted: number;
  sent: number;
  failed: number;
  skippedOptout: number;
  skippedUnconfirmed: number;
  shown: number;
  dismissed: number;
  clicked: number;
  unsubscribes: number;
}

export interface Campaign {
  id: string;
  status: CampaignStatus;
  audience: Audience;
  credits: number;
  email: boolean;
  inapp: boolean;
  subject: string;
  body: string;
  link: { url: string; label: string } | null;
  reason: string | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  stats: CampaignStats;
}

export interface AudienceCount {
  accounts: number;
  emails: number;
  optedOut: number;
  unconfirmed: number;
}

const campaigns = '/api/admin/campaigns';
const campaign = (id: string) => `${campaigns}/${encodeURIComponent(id)}`;

export const listCampaigns = () => api<{ campaigns: Campaign[]; dailyCap: number; sentToday: number; testAddress: string | null; emailConfigured: boolean }>(campaigns);
export const getCampaign = (id: string) => api<Campaign>(campaign(id));
export const createCampaign = (draft: CampaignDraft) => api<Omit<Campaign, 'stats'>>(campaigns, { method: 'POST', body: draft });
export const updateCampaign = (id: string, draft: CampaignDraft) => api<Omit<Campaign, 'stats'>>(campaign(id), { method: 'PUT', body: draft });
export const countAudience = (audience: Audience) => api<AudienceCount>(`${campaigns}/audience`, { method: 'POST', body: { audience } });
export const previewCampaign = (draft: CampaignDraft) => api<{ subject: string; html: string; text: string }>(`${campaigns}/preview`, { method: 'POST', body: draft });
export const testCampaign = (draft: CampaignDraft) => api<{ sent: boolean; to: string }>(`${campaigns}/test`, { method: 'POST', body: draft });
export const sendCampaign = (id: string, reason: string) => api<Omit<Campaign, 'stats'>>(`${campaign(id)}/send`, { method: 'POST', body: { reason } });
export const cancelCampaign = (id: string, reason: string) => api<Omit<Campaign, 'stats'>>(`${campaign(id)}/cancel`, { method: 'POST', body: { reason } });
export const resumeCampaign = (id: string, reason: string) => api<Omit<Campaign, 'stats'>>(`${campaign(id)}/resume`, { method: 'POST', body: { reason } });
