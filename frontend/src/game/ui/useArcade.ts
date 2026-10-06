import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, apiEnabled } from '../../services/api';
import { challengeDay } from '../../learn/challenge';
import { localDay } from '../../learn/streak';
import { recordLocalRun } from '../../practice/activity';
import type { AccountState } from '../../practice/useAccount';
import { buy as buyLocal, dailyScenario, equip as equipLocal, firstClear, loadoutFor, MetaError, recordRun, runTwists, type Meta } from '../engine/meta';
import { dailySeed } from '../engine/rng';
import type { Game } from '../engine/run';
import type { GameContent, RunSetup } from '../engine/types';
import { loadLocalMeta, loadOutbox, pushOutbox, saveLocalMeta, shiftOutbox, type OutboxEvent } from './store';
import { track } from '../../services/metrics';
import { DAILY_KEY, localDaily } from './daily';

/**
 * Where the Arcade's progress lives. Signed out (or in a build without
 * accounts) it is in the browser, and every run and purchase is also queued
 * for the server. Signed in, the server owns it: the queue is sent first
 * (POST /api/game/sync, which replays the runs), ranked runs are started by
 * the server (it picks the seed and the loadout) and scored by replaying
 * them.
 */

export interface ServerMe {
  meta: Meta;
  best: Record<string, number>;
  daily: { day: string; scenario: string; runId?: string; submitted?: boolean; score?: number | null };
}

export interface RunResult {
  score: number;
  blueprints: number;
  firstClear: boolean;
  /** Signed in: the run's rank on its leaderboard, and how many played. */
  rank?: number | null;
  players?: number;
  /** Why a signed-in run was not recorded. */
  error?: string;
}

export interface Arcade {
  meta: Meta;
  signedIn: boolean;
  /** Loading or syncing with the server. */
  busy: boolean;
  best: Record<string, number>;
  daily: { day: string; scenario: string; played: boolean; score?: number | null };
  error?: string;
  buy: (id: string) => Promise<void>;
  equip: (perks: string[]) => Promise<void>;
  /** A run to play: from the server signed in (ranked), else made here. */
  start: (opts: { mode: 'normal' | 'daily'; scenario?: string; ascension?: number }) => Promise<{ setup: RunSetup; runId?: string }>;
  /** Banks a finished run. */
  finish: (game: Game, runId?: string) => Promise<RunResult>;
}

function randomSeed(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * `onRunDone` is called once a finished run counts toward the daily streak:
 * signed in, when the server has kept it; in a build without accounts, when
 * its day is kept in this browser. Signed out there is no streak.
 */
export function useArcade(content: GameContent, account: AccountState, onRunDone?: () => void): Arcade {
  const signedIn = apiEnabled && account.status === 'signed-in';
  const [meta, setMeta] = useState<Meta>(() => loadLocalMeta());
  const [server, setServer] = useState<ServerMe | undefined>();
  const [busy, setBusy] = useState(signedIn);
  const [error, setError] = useState<string | undefined>();
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const doneRef = useRef(onRunDone);
  doneRef.current = onRunDone;
  const keptHere = account.status === 'off';

  const refresh = useCallback(async () => {
    const me = await api<ServerMe>('/api/game/me');
    setServer(me);
    setMeta(me.meta);
  }, []);

  useEffect(() => {
    if (!signedIn) {
      setServer(undefined);
      setMeta(loadLocalMeta());
      setBusy(false);
      return;
    }
    let cancelled = false;
    setBusy(true);
    void (async () => {
      try {
        // What was played signed out goes first, a few runs at a time.
        for (let guard = 0; guard < 30; guard++) {
          const events = loadOutbox().slice(0, 20);
          if (events.length === 0) break;
          const answer = await api<{ meta: Meta; applied: number; error?: string }>('/api/game/sync', { method: 'POST', body: { events } });
          shiftOutbox(answer.error ? answer.applied + 1 : answer.applied);
          if (answer.applied === 0 && !answer.error) break;
        }
        if (!cancelled) await refresh();
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : 'Could not reach the server; your progress is kept in this browser.');
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signedIn, refresh]);

  const local = useCallback((next: Meta, event?: OutboxEvent) => {
    setMeta(next);
    saveLocalMeta(next);
    if (event) pushOutbox(event);
  }, []);

  const buy = useCallback(
    async (id: string) => {
      setError(undefined);
      if (signedIn) {
        const answer = await api<{ meta: Meta }>('/api/game/buy', { method: 'POST', body: { id } });
        setMeta(answer.meta);
        return;
      }
      local(buyLocal(content, metaRef.current, id), { t: 'buy', id });
    },
    [signedIn, content, local],
  );

  const equip = useCallback(
    async (perks: string[]) => {
      if (signedIn) {
        const answer = await api<{ meta: Meta }>('/api/game/equip', { method: 'POST', body: { perks } });
        setMeta(answer.meta);
        return;
      }
      local(equipLocal(content, metaRef.current, perks), { t: 'equip', perks });
    },
    [signedIn, content, local],
  );

  const start = useCallback(
    async ({ mode, scenario, ascension = 0 }: { mode: 'normal' | 'daily'; scenario?: string; ascension?: number }) => {
      track('arcade_run_start');
      if (signedIn) return api<{ runId: string; setup: RunSetup }>('/api/game/runs', { method: 'POST', body: { mode, scenario, ascension } });
      if (mode === 'daily') {
        const day = challengeDay();
        return { setup: { scenario: dailyScenario(content, day).id, seed: dailySeed(day), ascension: 0, mode: 'daily' as const, loadout: loadoutFor(metaRef.current, 0), twists: runTwists(content, metaRef.current, 'daily') } };
      }
      // Signed out the same rule as the Worker's: the basic rules until the first clear.
      return { setup: { scenario: scenario!, seed: randomSeed(), ascension, mode: 'normal' as const, loadout: loadoutFor(metaRef.current, ascension), twists: runTwists(content, metaRef.current, 'normal') } };
    },
    [signedIn, content],
  );

  const finish = useCallback(
    async (game: Game, runId?: string): Promise<RunResult> => {
      track('arcade_run_end');
      const before = metaRef.current;
      const first = firstClear(before, game.setup.scenario) && game.state.cleared;
      if (signedIn && runId) {
        try {
          const answer = await api<{ score: number; blueprints: number; meta: Meta; rank: number | null; players: number }>(`/api/game/runs/${runId}/submit`, {
            method: 'POST',
            // The local date: a finished run meets the daily goal.
            body: { actions: game.state.log, day: localDay() },
          });
          setMeta(answer.meta);
          void refresh().catch(() => undefined);
          doneRef.current?.();
          return { score: answer.score, blueprints: answer.blueprints, firstClear: first, rank: answer.rank, players: answer.players };
        } catch (e) {
          return { score: game.state.score, blueprints: 0, firstClear: false, error: e instanceof ApiError ? e.message : 'Could not reach the server to save this run.' };
        }
      }
      const blueprints = game.blueprints(firstClear(before, game.setup.scenario));
      const survived = game.state.history.filter((h) => h.survived).length;
      local(
        recordRun(before, { scenario: game.setup.scenario, ascension: game.setup.ascension, reached: survived, cleared: game.state.cleared, blueprints, seen: game.seen() }),
        { t: 'run', setup: game.setup, actions: game.state.log },
      );
      if (keptHere) {
        recordLocalRun(localDay());
        doneRef.current?.();
      }
      if (game.setup.mode === 'daily') {
        try {
          localStorage.setItem(DAILY_KEY, JSON.stringify({ day: challengeDay(), score: game.state.score }));
        } catch {
          // Without storage the daily run can be played again; it is not ranked signed out anyway.
        }
      }
      return { score: game.state.score, blueprints, firstClear: first };
    },
    [signedIn, local, refresh, keptHere],
  );

  const day = challengeDay();
  const played = server ? !!server.daily.submitted : localDaily()?.day === day;
  return {
    meta,
    signedIn,
    busy,
    best: server?.best ?? {},
    daily: { day, scenario: server?.daily.scenario ?? dailyScenario(content, day).id, played, score: server ? server.daily.score : localDaily()?.day === day ? localDaily()?.score : undefined },
    error,
    buy: async (id) => {
      try {
        await buy(id);
      } catch (e) {
        setError(e instanceof MetaError || e instanceof ApiError ? e.message : 'That did not work; try again.');
      }
    },
    equip: async (perks) => {
      try {
        await equip(perks);
      } catch (e) {
        setError(e instanceof MetaError || e instanceof ApiError ? e.message : 'That did not work; try again.');
      }
    },
    start,
    finish,
  };
}
