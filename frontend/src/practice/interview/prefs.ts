import { useCallback, useState } from 'react';
import { loadJson, saveJson } from '../../services/storage';
import type { Duration } from '../modes/session';

/**
 * What the interview room remembers in this browser (services/storage.ts
 * guards every access): the room's toggles, the last interview's set-up, the
 * problems done in an interview, and the design on the whiteboard of the
 * interview in progress, per problem.
 */

export type Talk = 'voice' | 'text';
export type Kind = 'mock' | 'solo';

const KEYS = {
  sound: 'proschi.interview.sound',
  talk: 'proschi.interview.talk',
  code: 'proschi.interview.code',
  rail: 'proschi.interview.rail',
  last: 'proschi.interview.last',
  done: 'proschi.interview.done',
} as const;

const DONE_MAX = 100;

/** A remembered value: `read` checks what storage gave back and falls back to the default. */
function usePref<T>(key: string, read: (raw: unknown) => T): [T, (next: T) => void] {
  const [value, setValue] = useState(() => read(loadJson<unknown>(key, undefined)));
  const set = useCallback(
    (next: T) => {
      setValue(next);
      saveJson(key, next);
    },
    [key],
  );
  return [value, set];
}

/** Sound effects: on by default. */
export const useSoundPref = () => usePref(KEYS.sound, (raw) => raw !== false);
export const soundOn = (): boolean => loadJson<unknown>(KEYS.sound, true) !== false;
/** Voice or text with the interviewer: text by default. */
export const useTalkPref = () => usePref<Talk>(KEYS.talk, (raw) => (raw === 'voice' ? 'voice' : 'text'));
/** The code editor beside the whiteboard: hidden by default. */
export const useCodePref = () => usePref(KEYS.code, (raw) => raw === true);
/** The chat rail folded away. */
export const useRailFoldedPref = () => usePref(KEYS.rail, (raw) => raw === true);

export interface LastInterview {
  problem: string;
  kind: Kind;
  minutes: Duration;
}

export function loadLast(): LastInterview | undefined {
  const raw = loadJson<Partial<LastInterview> | undefined>(KEYS.last, undefined);
  return raw && typeof raw.problem === 'string' && (raw.kind === 'mock' || raw.kind === 'solo') && [30, 45, 60].includes(raw.minutes as number) ? (raw as LastInterview) : undefined;
}

/** The problems started in an interview in this browser, oldest first. */
export function loadDone(): string[] {
  const raw = loadJson<unknown>(KEYS.done, []);
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
}

/** Remembers an interview that starts: the last set-up, and its problem as done (moved to the end). */
export function recordStart(last: LastInterview): void {
  saveJson(KEYS.last, last);
  saveJson(KEYS.done, [...loadDone().filter((id) => id !== last.problem), last.problem].slice(-DONE_MAX));
}

const DESIGN_KEY = (problem: string) => `proschi.interview.design.${problem}`;

export function loadDesign(problem: string): string | undefined {
  const raw = loadJson<unknown>(DESIGN_KEY(problem), undefined);
  return typeof raw === 'string' ? raw : undefined;
}

export function saveDesign(problem: string, source: string | undefined): void {
  if (source !== undefined) saveJson(DESIGN_KEY(problem), source);
  else {
    try {
      localStorage.removeItem(DESIGN_KEY(problem));
    } catch {
      // Storage unavailable: nothing was stored.
    }
  }
}
