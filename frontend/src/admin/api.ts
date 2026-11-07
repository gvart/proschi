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
    polar: { accessToken: boolean; webhookSecret: boolean; productProMonthly: boolean; productProYearly: boolean; productPack5: boolean };
    polarServer: 'sandbox' | 'live';
    billing: boolean;
  };
}

export const getHealth = () => api<Health>('/api/admin/health');

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
    /** What the account gets now: Pro while subscribed or comped. */
    effectivePlan: string;
  };
  billing: Subscription | null;
  credits: { total: number; monthly: number; trial: number; pack: number; period: string };
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

/** Polar's dashboard: refunds are done there. Append a customer's or an order's id. */
export interface PolarDashboard {
  server: 'sandbox' | 'live';
  customers: string;
  orders: string;
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

export interface LedgerEntry {
  id: number;
  kind: 'grant' | 'spend' | 'refund' | 'revoke' | 'admin_grant' | 'admin_revoke';
  bucket: 'monthly' | 'trial' | 'pack';
  period: string | null;
  delta: number;
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
    monthly: number;
    yearly: number;
    pastDue: number;
    canceling: number;
    comped: number;
    packOrdersThisMonth: number;
    packOrders: number;
    refundedThisMonth: number;
    refunded: number;
  };
  total: number;
  offset: number;
  pageSize: number;
  pro: {
    id: string;
    displayName: string;
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
  refunded: number;
  reviews: number;
  tokens: number;
  costUsd: number;
}

export interface AiUsage {
  days: AiDay[];
  totals: { sessions: number; finished: number; tokens: number; costUsd: number; avgCostPerFinished: number | null; capped: number; cappedShare: number | null; reviews: number };
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
