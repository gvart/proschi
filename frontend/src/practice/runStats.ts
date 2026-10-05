import { loadJson, saveJson } from '../services/storage';
import { isSafeKey } from '../playground/sanitize';
import type { RunResult } from './workspace';

/**
 * Test runs per problem, kept in this browser, for the achievements of a
 * build without accounts ("solved on the first run", "cheaper than the
 * reference solution"). Signed in, the server keeps the same numbers in its
 * progress table, and those count instead.
 */

export const RUN_STATS_KEY = 'proschi.practice.runs';

export interface RunStats {
  /** Test runs that ran (not blocked by errors). */
  runs: number;
  /** Runs up to and including the first solve. */
  runsToSolve?: number;
  /** The monthly cost of the cheapest solving design. */
  bestCostUsd?: number;
  /** The monthly cost of the problem's reference solution, measured once it was solved. */
  referenceCostUsd?: number;
}

const isCost = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Run stats from storage: well-formed entries only. */
export function readRunStats(raw: unknown): Record<string, RunStats> {
  const out: Record<string, RunStats> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const v = value as Partial<RunStats> | null;
    if (!isSafeKey(id) || !v || typeof v !== 'object' || !Number.isInteger(v.runs) || (v.runs as number) < 1) continue;
    out[id] = {
      runs: v.runs as number,
      ...(Number.isInteger(v.runsToSolve) && (v.runsToSolve as number) >= 1 ? { runsToSolve: v.runsToSolve } : {}),
      ...(isCost(v.bestCostUsd) ? { bestCostUsd: v.bestCostUsd } : {}),
      ...(isCost(v.referenceCostUsd) ? { referenceCostUsd: v.referenceCostUsd } : {}),
    };
  }
  return out;
}

export function loadRunStats(): Record<string, RunStats> {
  return readRunStats(loadJson<unknown>(RUN_STATS_KEY, {}));
}

/**
 * A problem's stats after one more run: a solving run sets runsToSolve the
 * first time and keeps the cheaper cost; `referenceCostUsd` is asked for only
 * when a solve has none yet, since it runs the simulation.
 */
export function withRunStats(stats: RunStats | undefined, run: Pick<RunResult, 'solved' | 'metrics'>, referenceCostUsd: () => number | undefined): RunStats {
  const runs = (stats?.runs ?? 0) + 1;
  const next: RunStats = { ...stats, runs };
  if (!run.solved) return next;
  next.runsToSolve ??= runs;
  const cost = run.metrics?.costUsd;
  if (isCost(cost)) next.bestCostUsd = Math.min(next.bestCostUsd ?? Infinity, cost);
  if (next.referenceCostUsd === undefined) {
    const reference = referenceCostUsd();
    if (isCost(reference)) next.referenceCostUsd = reference;
  }
  return next;
}

/** Records a run of `id` in this browser; storage errors are ignored (services/storage.ts). */
export function recordRunStats(id: string, run: Pick<RunResult, 'solved' | 'metrics'>, referenceCostUsd: () => number | undefined): void {
  if (!isSafeKey(id)) return;
  const all = loadRunStats();
  saveJson(RUN_STATS_KEY, { ...all, [id]: withRunStats(all[id], run, referenceCostUsd) });
}
