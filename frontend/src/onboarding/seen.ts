/**
 * Whether a first-run tour was seen, and whether to start one. This module is
 * in the page bundles, so it stays tiny; the tours themselves load lazily.
 *
 * "Seen" lives in localStorage, falling back to sessionStorage and then to
 * memory, so with storage blocked a tour still shows at most once per page
 * session and nothing throws. `?tour=1` forces a tour, `?tour=0` suppresses
 * it (and the hint), for testing and for links in docs.
 */

/** `arcade`: Kernel's first-wave tutorial in Scale or Fail; `arcade-twists`: its intro to the twists. */
export type TourId = 'editor' | 'practice' | 'arcade' | 'arcade-twists';

/** Start the full tour, show a small non-blocking hint, or nothing. */
export type StartMode = 'tour' | 'hint' | null;

export const ONBOARDING_KEY = 'proschi.onboarding';

const memory = new Set<TourId>();
const requested = new Set<TourId>();

type StorageGetter = () => Storage;
const STORAGES: StorageGetter[] = [() => window.localStorage, () => window.sessionStorage];

function read(storage: StorageGetter): Record<string, unknown> | null {
  try {
    const raw = storage().getItem(ONBOARDING_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function hasSeen(id: TourId): boolean {
  return memory.has(id) || STORAGES.some((storage) => read(storage)?.[id] === true);
}

export function markSeen(id: TourId): void {
  memory.add(id);
  requested.delete(id);
  for (const storage of STORAGES) {
    try {
      storage().setItem(ONBOARDING_KEY, JSON.stringify({ ...read(storage), [id]: true }));
      return;
    } catch {
      // Blocked or full: try the next one; memory already has it.
    }
  }
}

/** `?tour=1` → 'on', `?tour=0` → 'off'. */
export function tourParam(search: string = window.location.search): 'on' | 'off' | null {
  const value = new URLSearchParams(search).get('tour');
  return value === '1' ? 'on' : value === '0' ? 'off' : null;
}

/** Asks the next page of this kind to start its tour (e.g. Help on the practice list opens a problem with it). */
export function requestTour(id: TourId): void {
  requested.add(id);
}

interface StartInput {
  /** The page opened a shared diagram or an example link: the content comes first. */
  deepLink?: boolean;
  /** Saved work from before tours existed: not a first visit. */
  returning?: boolean;
  search?: string;
}

/** What to show when a page opens. Side-effect free apart from remembering returning users, so it is safe in a state initializer. */
export function startMode(id: TourId, { deepLink = false, returning = false, search }: StartInput = {}): StartMode {
  const param = tourParam(search);
  if (requested.has(id) || param === 'on') return 'tour';
  if (param === 'off' || hasSeen(id)) return null;
  if (returning) {
    markSeen(id);
    return null;
  }
  return deepLink ? 'hint' : 'tour';
}

/** Test helper: forgets the in-memory state. */
export function resetOnboardingMemory(): void {
  memory.clear();
  requested.clear();
}
