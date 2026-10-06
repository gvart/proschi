import { useEffect, useState } from 'react';
import { api, apiEnabled, type BoardMetric, type Leaderboard, type ProblemBoard, type ProblemStats, type StatsSummary } from '../services/api';

/** Global practice stats from the API; undefined while loading, without an API, or when it cannot be reached. `key` changes refetch. */
function useApi<T>(path: string | undefined, key = ''): T | undefined {
  const [data, setData] = useState<T>();
  useEffect(() => {
    if (!apiEnabled || !path) return;
    let cancelled = false;
    api<T>(path)
      .then((value) => !cancelled && setData(value))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [path, key]);
  // Keep showing the last answer while a refresh loads.
  return data;
}

export const useStatsSummary = () => useApi<StatsSummary>('/api/stats');
export const useLeaderboard = () => useApi<Leaderboard>('/api/leaderboard');
/** Signed in, includes where the user's designs fall (`you`); `refresh` refetches, e.g. after a run is recorded. */
export const useProblemStats = (problemId: string | undefined, signedIn: boolean, refresh: number) =>
  useApi<ProblemStats>(problemId ? `/api/stats/${encodeURIComponent(problemId)}` : undefined, `${signedIn}|${refresh}`);
/** A problem's board by `metric`; signed in, with your rank. `refresh` refetches, e.g. after a run is recorded. */
export const useProblemBoard = (problemId: string | undefined, metric: BoardMetric, signedIn: boolean, refresh: number) =>
  useApi<ProblemBoard>(problemId ? `/api/problems/${encodeURIComponent(problemId)}/leaderboard?metric=${metric}` : undefined, `${signedIn}|${refresh}`);
