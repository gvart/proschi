import { api, ApiError } from '../../services/api';
import { roadmapHref } from '../roadmap';
import type { Skill } from '../modes/ai/api';
import topics from '../cards/tags.json';

/**
 * Interview history and the AI roadmap's picks (backend/src/interviews.ts
 * interviewHistory, backend/src/roadmap.ts; docs/design/paid-plans.md P1,
 * P9, P10). Both are Pro on the server: history answers every session to
 * Pro and the latest only to other plans; the picks answer 402 off Pro.
 * Without the AI key (501) the page hides them and keeps the roadmap's own
 * order.
 */

export interface HistorySession {
  id: string;
  problem: string;
  minutes: number;
  /** Unix ms. */
  startedAt: number;
  endedAt?: number;
  passed: boolean;
  scores: Record<Skill, number>;
}

export interface History {
  /** Every finished session (Pro), or only the latest. */
  full: boolean;
  /** How many finished sessions there are. */
  total: number;
  /** Newest first. */
  sessions: HistorySession[];
}

export type PickKind = 'problem' | 'cards';

export interface RoadmapPick {
  kind: PickKind;
  id: string;
  reason: string;
}

export interface RoadmapNext {
  createdAt: number;
  source: 'interview' | 'review';
  sourceId?: string;
  picks: RoadmapPick[];
}

/** What a call came back with: the data, `off` (no AI on the server: 501, or no answer), or `upgrade` (402, not Pro). */
export type Answer<T> = { status: 'ok'; data: T } | { status: 'off' } | { status: 'upgrade' };

async function answer<T>(call: () => Promise<T>): Promise<Answer<T>> {
  try {
    return { status: 'ok', data: await call() };
  } catch (e) {
    if (e instanceof ApiError && e.status === 402) return { status: 'upgrade' };
    return { status: 'off' };
  }
}

export const getHistory = (): Promise<Answer<History>> => answer(() => api<History>('/api/interviews/history'));

/** The newest picks, or (with `interview`) the picks made after that interview's verdict; null when there are none. */
export const getRoadmapNext = (interview?: string): Promise<Answer<RoadmapNext | null>> =>
  answer(async () => (await api<{ next: RoadmapNext | null }>(`/api/roadmap/next${interview ? `?interview=${encodeURIComponent(interview)}` : ''}`)).next);

/** Where a pick goes: a problem's roadmap step, or a card topic's review deck. */
export const pickHref = (pick: Pick<RoadmapPick, 'kind' | 'id'>): string => (pick.kind === 'problem' ? roadmapHref(pick.id) : `#/review/${pick.id}`);

const topicTitles = new Map((topics as { id: string; title: string }[]).map((t) => [t.id, t.title]));

/** A pick's title: the problem's (from `problemTitle`) or the card topic's. */
export function pickTitle(pick: Pick<RoadmapPick, 'kind' | 'id'>, problemTitle: (id: string) => string | undefined): string {
  return (pick.kind === 'problem' ? problemTitle(pick.id) : topicTitles.get(pick.id)) ?? pick.id;
}

/** The address of a past session's verdict on the progress page. */
export const verdictHref = (id: string): string => `#/progress/interview/${encodeURIComponent(id)}`;

/** The session id of a `progress/interview/<id>` route. */
export function verdictIdOf(route: string): string | undefined {
  const m = /^progress\/interview\/([^/]+)$/.exec(route);
  return m ? decodeURIComponent(m[1]) : undefined;
}

/** A session's date, e.g. "Nov 6, 2026". */
export const formatDay = (ms: number): string => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
