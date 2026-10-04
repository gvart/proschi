import { useEffect, useState } from 'react';
import { api, apiEnabled, type Leaderboard, type ProblemStats, type StatsSummary } from '../services/api';

/** Global practice stats from the API; undefined while loading, without an API, or when it cannot be reached. */
function useApi<T>(path: string | undefined, token?: string, refresh = 0): T | undefined {
  const [data, setData] = useState<{ key: string; value: T }>();
  const key = `${path}|${token ?? ''}|${refresh}`;
  useEffect(() => {
    if (!apiEnabled || !path) return;
    let cancelled = false;
    api<T>(path, { token })
      .then((value) => !cancelled && setData({ key, value }))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [path, token, key]);
  // Keep showing the last answer while a refresh loads.
  return data?.value;
}

export const useStatsSummary = () => useApi<StatsSummary>('/api/stats');
export const useLeaderboard = () => useApi<Leaderboard>('/api/leaderboard');
/** With a token, includes where the user's designs fall (`you`); `refresh` refetches, e.g. after a run is recorded. */
export const useProblemStats = (problemId: string | undefined, token: string | undefined, refresh: number) =>
  useApi<ProblemStats>(problemId ? `/api/stats/${encodeURIComponent(problemId)}` : undefined, token, refresh);
