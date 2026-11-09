import { useSyncExternalStore } from 'react';
import { readPlanSettings, type PlanItem, type PlanSettings } from '../../learn/interviewPlan';
import { isDay } from '../../learn/review';
import { api } from '../../services/api';
import { loadJson, saveJson } from '../../services/storage';

/**
 * The interview-date plan's state in this browser (`proschi.practice.plan`,
 * listed in docs/PRIVACY.md): the date and minutes, today's list once made
 * (so its ticks stay put, and its open problems carry over to the next day,
 * learn/interviewPlan.ts) and what was ticked by hand. Signed in on Max, the
 * date and minutes are the account's too (GET and PUT
 * /api/me/interview-plan, docs/design/paid-plans.md P54), with today's list
 * for the evening reminder.
 */

export const PLAN_KEY = 'proschi.practice.plan';

export interface PlanState {
  settings?: PlanSettings;
  /** The last list made, and its day. */
  last?: { day: string; items: PlanItem[] };
  /** Keys ticked by hand on `ticked.day`. */
  ticked?: { day: string; keys: string[] };
}

const KINDS = new Set(['problem', 'cards', 'topic', 'interview', 'recap']);

function readItems(raw: unknown): PlanItem[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const ok = raw.every((i) => i && typeof i === 'object' && KINDS.has(i.kind) && typeof i.key === 'string' && typeof i.title === 'string' && typeof i.reason === 'string' && typeof i.minutes === 'number');
  return ok ? (raw as PlanItem[]) : undefined;
}

export function parsePlanState(raw: unknown): PlanState {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const settings = readPlanSettings(r.settings);
  const last = r.last as { day?: unknown; items?: unknown } | undefined;
  const items = last && isDay(last.day) ? readItems(last.items) : undefined;
  const ticked = r.ticked as { day?: unknown; keys?: unknown } | undefined;
  return {
    ...(settings ? { settings } : {}),
    ...(items ? { last: { day: last!.day as string, items } } : {}),
    ...(ticked && isDay(ticked.day) && Array.isArray(ticked.keys) ? { ticked: { day: ticked.day, keys: ticked.keys.filter((k): k is string => typeof k === 'string') } } : {}),
  };
}

let current: PlanState | undefined;
const listeners = new Set<() => void>();

function read(): PlanState {
  current ??= parsePlanState(loadJson<unknown>(PLAN_KEY, undefined));
  return current;
}

export function updatePlan(update: (s: PlanState) => PlanState): void {
  current = update(read());
  saveJson(PLAN_KEY, current);
  for (const l of listeners) l();
}

/** New settings (or none): today's list is made again from them. */
export const setPlanSettings = (settings: PlanSettings | undefined) => updatePlan((s) => ({ ...(settings ? { settings } : {}), ticked: s.ticked }));

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== PLAN_KEY) return;
    current = undefined;
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

const EMPTY: PlanState = {};
export const usePlanState = (): PlanState => useSyncExternalStore(subscribe, read, () => EMPTY);

// ---- The account's copy (Max) ----

export interface TodayList {
  day: string;
  items: { title: string; done: boolean }[];
}

export const getAccountPlan = () => api<{ plan: PlanSettings | null }>('/api/me/interview-plan');
export const putAccountPlan = (settings: PlanSettings, today?: TodayList) => api<{ plan: PlanSettings }>('/api/me/interview-plan', { method: 'PUT', body: { ...settings, ...(today ? { today } : {}) } });
export const deleteAccountPlan = () => api<void>('/api/me/interview-plan', { method: 'DELETE' });

const same = (a: PlanSettings | undefined, b: PlanSettings | undefined) => a?.date === b?.date && a?.minutes === b?.minutes && a?.start === b?.start;

/**
 * On opening the plan signed in on Max: the account's plan wins; an account
 * without one gets this browser's. Never throws: the plan keeps working here.
 */
export async function mergeAccountPlan(): Promise<void> {
  try {
    const { plan } = await getAccountPlan();
    const local = read().settings;
    if (plan) {
      const remote = readPlanSettings(plan);
      if (remote && !same(remote, local)) setPlanSettings(remote);
    } else if (local) {
      await putAccountPlan(local);
    }
  } catch {
    // Offline or refused: this browser's plan stands.
  }
}
