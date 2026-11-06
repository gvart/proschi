import { api } from './api';

/**
 * Live share links (backend/src/documentShares.ts, docs/SHARING.md): a Pro
 * user's private, revocable, read-only link to one of their synced diagrams,
 * at /share/<token>. Unlike a short link (services/shares.ts), a snapshot, it
 * shows the diagram as last saved to the account, and its owner can revoke it.
 */

/** Paid plans are on in this build (docs/design/paid-plans.md P10): only then do non-Pro users see the upgrade hint. */
export const billingEnabled = import.meta.env.VITE_BILLING === 'true';

/** Where the upgrade hint sends people, from the site root. */
export const UPGRADE_PATH = 'pricing/';

export interface LiveShare {
  token: string;
  url: string;
  /** Unix milliseconds. */
  createdAt: number;
}

export interface SharedDocument {
  name: string;
  title: string;
  source: string;
  imports?: Record<string, string>;
  /** Unix milliseconds: when the owner last saved it. */
  updatedAt: number;
}

export const isPro = (plan: string | undefined): boolean => plan === 'pro';

const path = (docId: string) => `/api/me/documents/${encodeURIComponent(docId)}/share`;

/** The diagram's live link, or null without one. */
export const getLiveShare = async (docId: string): Promise<LiveShare | null> => (await api<{ share: LiveShare | null }>(path(docId))).share;

/** The diagram's live link, made if there is none (402 plan_required off Pro). */
export const createLiveShare = async (docId: string): Promise<LiveShare> => (await api<{ share: LiveShare }>(path(docId), { method: 'POST' })).share;

export const revokeLiveShare = (docId: string): Promise<void> => api<void>(path(docId), { method: 'DELETE' });

/** The diagram behind a link, for anyone who has it. */
export const fetchSharedDocument = (token: string): Promise<SharedDocument> => api<SharedDocument>(`/api/share/${token}`);

/** The token of a /share/<token> address (under any base path), if well formed. */
export function shareTokenFromPath(pathname: string): string | undefined {
  return /\/share\/([A-Za-z0-9_-]{22})\/?$/.exec(pathname)?.[1];
}
