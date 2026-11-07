import { api } from '../services/api';

/** The Inbox's API (backend/src/feedback.ts, under /api/admin/feedback). */

export type FeedbackKind = 'bug' | 'question' | 'proposal' | 'other';
export type FeedbackStatus = 'new' | 'in_progress' | 'done';

export interface FeedbackCounts {
  unread: number;
  /** New and in progress. */
  open: number;
  new: number;
  inProgress: number;
  done: number;
}

export interface FeedbackRow {
  id: string;
  kind: FeedbackKind;
  subject: string | null;
  /** The message's first 160 characters. */
  excerpt: string;
  status: FeedbackStatus;
  createdAt: number;
  read: boolean;
  hasDiagram: boolean;
  screenshots: number;
  sender: { id: string; displayName: string; blocked: boolean };
}

export interface FeedbackMessage {
  id: string;
  kind: FeedbackKind;
  subject: string | null;
  message: string;
  context: { path?: string; userAgent?: string; viewport?: string; plan?: string; version?: { id: string; tag: string | null; timestamp: string } | null };
  diagram: string | null;
  status: FeedbackStatus;
  note: string | null;
  createdAt: number;
  updatedAt: number;
  /** email: a confirmed address the user can be answered at, or null. */
  sender: { id: string; displayName: string; blocked: boolean; email: string | null };
  screenshots: { key: string; type: string; bytes: number }[];
}

export interface FeedbackFilter {
  /** '' is every message, 'open' new and in progress. */
  status: FeedbackStatus | 'open' | '';
  kind: FeedbackKind | '';
  q: string;
  offset: number;
}

export const listFeedback = (filter: FeedbackFilter) =>
  api<{ total: number; offset: number; pageSize: number; counts: FeedbackCounts; messages: FeedbackRow[] }>(
    `/api/admin/feedback?${new URLSearchParams({ status: filter.status, kind: filter.kind, q: filter.q, offset: String(filter.offset) })}`,
  );
export const getFeedback = (id: string) => api<FeedbackMessage>(`/api/admin/feedback/${encodeURIComponent(id)}`);
export const patchFeedback = (id: string, body: { status?: FeedbackStatus; note?: string }) =>
  api<{ status: FeedbackStatus; note: string | null }>(`/api/admin/feedback/${encodeURIComponent(id)}`, { method: 'PATCH', body });
export const deleteFeedback = (id: string, reason: string) => api(`/api/admin/feedback/${encodeURIComponent(id)}`, { method: 'DELETE', body: { reason } });
export const feedbackFileUrl = (id: string, key: string) => `/api/admin/feedback/${encodeURIComponent(id)}/files/${encodeURIComponent(key)}`;

export const KIND_LABEL: Record<FeedbackKind, string> = { bug: 'Bug', question: 'Question', proposal: 'Proposal', other: 'Other' };
export const STATUS_LABEL: Record<FeedbackStatus, string> = { new: 'New', in_progress: 'In progress', done: 'Done' };
