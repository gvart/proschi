import { useSyncExternalStore } from 'react';
import { loadJson, saveJson } from '../../services/storage';
import { isSafeKey } from '../../playground/sanitize';
import { api } from '../../services/api';

/**
 * The known mistakes failed runs matched lately (practice/mistakes.ts), kept
 * in this browser for "Your next steps" (learn/nextSteps.ts): the latest per
 * problem, at most MAX_MISTAKES problems. Signed in, they are also kept with
 * the account (GET and POST /api/me/mistakes, backend/src/mistakes.ts), so
 * the retry step follows the learner to another device. docs/PRIVACY.md
 * lists the key.
 */
export const MISTAKES_KEY = 'proschi.practice.mistakes';
export const MAX_MISTAKES = 20;

export interface RecentMistake {
  problem: string;
  /** The mistake's title. */
  title: string;
  /** Unix seconds. */
  at: number;
  /** The wrong design's name (the account keeps it by this); absent on those kept before it was. */
  id?: string;
}

/** The list read back from storage: anything malformed is dropped. */
export function readMistakes(raw: unknown): RecentMistake[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((m): m is RecentMistake => {
    const v = m as Partial<RecentMistake> | null;
    return (
      !!v &&
      typeof v === 'object' &&
      typeof v.problem === 'string' &&
      isSafeKey(v.problem) &&
      typeof v.title === 'string' &&
      Number.isInteger(v.at) &&
      (v.id === undefined || typeof v.id === 'string')
    );
  });
}

export function loadMistakes(): RecentMistake[] {
  return readMistakes(loadJson<unknown>(MISTAKES_KEY, []));
}

type Source = 'here' | 'account';
const listeners = new Set<(added: RecentMistake[], source: Source) => void>();

/** Hears each change: the mistakes recorded here, or merged from the account. */
export function onMistakesChange(listener: (added: RecentMistake[], source: Source) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function save(list: RecentMistake[], added: RecentMistake[], source: Source): void {
  saveJson(MISTAKES_KEY, list);
  listeners.forEach((l) => l(added, source));
}

/** Keeps a matched mistake: it replaces the problem's earlier one, the newest first. */
export function recordMistake(problem: string, title: string, id?: string, now = Math.floor(Date.now() / 1000)): void {
  if (!isSafeKey(problem)) return;
  const mistake: RecentMistake = { problem, title, at: now, ...(id ? { id } : {}) };
  const rest = loadMistakes().filter((m) => m.problem !== problem);
  save([mistake, ...rest].slice(0, MAX_MISTAKES), [mistake], 'here');
}

/**
 * This browser's mistakes and the account's as one list: the newest per
 * problem, newest first, at most MAX_MISTAKES; and this browser's the
 * account lacks (or has older), to send.
 */
export function mergeMistakes(local: readonly RecentMistake[], remote: readonly RecentMistake[]): { merged: RecentMistake[]; toSend: RecentMistake[] } {
  const byProblem = new Map<string, RecentMistake>();
  for (const m of [...remote, ...local]) {
    const other = byProblem.get(m.problem);
    if (!other || m.at > other.at) byProblem.set(m.problem, m);
  }
  const merged = [...byProblem.values()].sort((a, b) => b.at - a.at || a.problem.localeCompare(b.problem)).slice(0, MAX_MISTAKES);
  const toSend = local.filter((m) => m.id !== undefined && !remote.some((r) => r.problem === m.problem && r.id === m.id && r.at >= m.at));
  return { merged, toSend };
}

/** Sends mistakes to the account; a failure is dropped: they stay in this browser, and the next sign-in sends them again. */
export async function sendMistakes(list: readonly RecentMistake[]): Promise<void> {
  const mistakes = list.filter((m) => m.id !== undefined).map(({ problem, id, title, at }) => ({ problem, id, title, at }));
  if (!mistakes.length) return;
  try {
    await api('/api/me/mistakes', { method: 'POST', body: { mistakes } });
  } catch {
    // Kept in this browser.
  }
}

/** Signed in: the account's mistakes join this browser's, and this browser's the account lacks are sent. Offline, nothing changes. */
export async function syncMistakes(): Promise<void> {
  let remote: RecentMistake[];
  try {
    remote = readMistakes((await api<{ mistakes: unknown }>('/api/me/mistakes')).mistakes);
  } catch {
    return;
  }
  const local = loadMistakes();
  const { merged, toSend } = mergeMistakes(local, remote);
  if (JSON.stringify(merged) !== JSON.stringify(local)) save(merged, merged, 'account');
  await sendMistakes(toSend);
}

// One list per change, so the snapshot is stable between reads.
let cached: { key: string; list: RecentMistake[] } | undefined;

function snapshot(): RecentMistake[] {
  const list = loadMistakes();
  const key = JSON.stringify(list);
  if (cached?.key !== key) cached = { key, list };
  return cached.list;
}

const subscribe = (onChange: () => void) => onMistakesChange(() => onChange());

/** This browser's mistakes, updated as they are recorded or merged from the account. */
export function useRecentMistakes(): RecentMistake[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
