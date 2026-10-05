import { emptyMeta, readMeta, type Meta } from '../engine/meta';
import type { Action, RunSetup } from '../engine/types';

/**
 * What the Arcade keeps in the browser (docs/PRIVACY.md): progress while
 * signed out, the events to send when the player signs in, the run in
 * progress (so a reload carries on) and the settings. Every read survives
 * missing or malformed storage.
 */

export const META_KEY = 'proschi.game.meta';
export const OUTBOX_KEY = 'proschi.game.outbox';
export const RUN_KEY = 'proschi.game.run';
export const SETTINGS_KEY = 'proschi.game.settings';

/** Runs kept for sign-in at most; older ones still count here, but not on the account. */
export const OUTBOX_RUNS = 40;

export type OutboxEvent = { t: 'run'; setup: RunSetup; actions: Action[] } | { t: 'buy'; id: string } | { t: 'equip'; perks: string[] };

export interface SavedRun {
  setup: RunSetup;
  actions: Action[];
  /** A ranked run's id on the server. */
  runId?: string;
}

export interface Settings {
  sound: boolean;
  /** Ticks per 2.5 s: 1, 2 or 4. */
  speed: 1 | 2 | 4;
}

const read = <T>(key: string): T | undefined => {
  try {
    const text = localStorage.getItem(key);
    return text === null ? undefined : (JSON.parse(text) as T);
  } catch {
    return undefined;
  }
};

const write = (key: string, value: unknown) => {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Full or blocked storage: the game still plays, it just forgets.
  }
};

export const loadLocalMeta = (): Meta => readMeta(read(META_KEY) ?? emptyMeta());
export const saveLocalMeta = (meta: Meta) => write(META_KEY, meta);

export function loadOutbox(): OutboxEvent[] {
  const raw = read<unknown>(OUTBOX_KEY);
  return Array.isArray(raw) ? (raw.filter((e) => e && typeof e === 'object' && typeof (e as { t?: unknown }).t === 'string') as OutboxEvent[]) : [];
}

export function pushOutbox(event: OutboxEvent): void {
  const events = loadOutbox();
  if (event.t === 'run' && events.filter((e) => e.t === 'run').length >= OUTBOX_RUNS) return;
  write(OUTBOX_KEY, [...events, event]);
}

/** Drops the first `n` events: the server took them. */
export const shiftOutbox = (n: number) => {
  const rest = loadOutbox().slice(n);
  write(OUTBOX_KEY, rest.length ? rest : undefined);
};

export function loadRun(): SavedRun | undefined {
  const run = read<SavedRun>(RUN_KEY);
  return run && run.setup && Array.isArray(run.actions) ? run : undefined;
}
export const saveRun = (run: SavedRun | undefined) => write(RUN_KEY, run);

export function loadSettings(): Settings {
  const s = read<Partial<Settings>>(SETTINGS_KEY) ?? {};
  return { sound: s.sound === true, speed: s.speed === 2 || s.speed === 4 ? s.speed : 1 };
}
export const saveSettings = (s: Settings) => write(SETTINGS_KEY, s);
