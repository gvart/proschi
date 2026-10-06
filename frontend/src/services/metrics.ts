import { apiEnabled } from './api';
import { MAX_METRIC_BATCH, type ClientMetricEvent } from './metricsEvents';

/**
 * Anonymous usage counts (docs/PRIVACY.md "Usage counts"): `track(event)`
 * adds one to today's count of `event` on the server (POST /api/metrics),
 * and that is all that is sent: the event's name, no user, no page address,
 * no problem id, no cookie of ours. The server keeps one number per UTC day
 * and event.
 *
 * Off unless the build has the API (VITE_ACCOUNTS=true) and is a production
 * build served from a real host, so local development, `vite preview` and
 * the tests never send anything (VITE_METRICS=true turns it on anyway, e.g.
 * against `wrangler dev`). Also off when the browser asks not to be tracked
 * (Do Not Track or Global Privacy Control), even though nothing identifies
 * anyone. `track` never throws.
 */

export type Once = 'session' | 'browser';

export interface TrackOptions {
  /** Count it at most once per browser tab session, or once per browser ever. */
  once?: Once;
  /** What "once" is about, when not the event itself, e.g. `problem_start:<id>` (kept in the browser, never sent). */
  key?: string;
}

/** The subset of Storage the tracker needs. */
type KeyValue = Pick<Storage, 'getItem' | 'setItem'>;

export interface TrackerDeps {
  enabled: () => boolean;
  /** Sends a JSON body to POST /api/metrics; must not throw. */
  send: (body: string) => void;
  session?: () => KeyValue | undefined;
  local?: () => KeyValue | undefined;
  /** Runs the flush later; the default waits 2 s, so a burst of events is one request. */
  schedule?: (flush: () => void) => void;
}

export const METRICS_ONCE_KEY = 'proschi.metrics.once';
export const METRICS_URL = '/api/metrics';

export interface Tracker {
  track: (event: ClientMetricEvent, options?: TrackOptions) => void;
  /** Sends what is queued now (on leaving the page). */
  flush: () => void;
}

export function createTracker(deps: TrackerDeps): Tracker {
  const queue: ClientMetricEvent[] = [];
  /** Keys counted in this page when storage is unavailable, so "once" still holds per page. */
  const memory = new Set<string>();
  let scheduled = false;
  const schedule = deps.schedule ?? ((fn) => setTimeout(fn, 2000));

  /** Whether `key` was counted before in `store`; marks it counted. */
  const seenBefore = (store: KeyValue | undefined, key: string): boolean => {
    const memoryKey = `${store ? '' : 'mem:'}${key}`;
    try {
      if (store) {
        const seen = JSON.parse(store.getItem(METRICS_ONCE_KEY) ?? '[]') as unknown;
        const list = Array.isArray(seen) ? seen.filter((k): k is string => typeof k === 'string') : [];
        if (list.includes(key)) return true;
        store.setItem(METRICS_ONCE_KEY, JSON.stringify([...list, key].slice(-200)));
        return false;
      }
    } catch {
      // Storage blocked or full: fall back to this page's memory.
    }
    if (memory.has(memoryKey)) return true;
    memory.add(memoryKey);
    return false;
  };

  const flush = () => {
    scheduled = false;
    try {
      while (queue.length) deps.send(JSON.stringify({ events: queue.splice(0, MAX_METRIC_BATCH) }));
    } catch {
      queue.length = 0;
    }
  };

  const track = (event: ClientMetricEvent, options: TrackOptions = {}) => {
    try {
      if (!deps.enabled()) return;
      if (options.once) {
        const store = options.once === 'session' ? safe(deps.session) : safe(deps.local);
        if (seenBefore(store, options.key ?? event)) return;
      }
      queue.push(event);
      if (!scheduled) {
        scheduled = true;
        schedule(flush);
      }
    } catch {
      // Never let counting break the page.
    }
  };

  return { track, flush };
}

function safe(get: (() => KeyValue | undefined) | undefined): KeyValue | undefined {
  try {
    return get?.();
  } catch {
    return undefined;
  }
}

/** Whether the browser asks not to be tracked. */
export function privacySignal(nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  if (!nav) return false;
  const gpc = (nav as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl;
  return nav.doNotTrack === '1' || gpc === true;
}

function defaultEnabled(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (import.meta.env.MODE === 'test') return false;
  const forced = import.meta.env.VITE_METRICS === 'true';
  const local = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(window.location.hostname);
  if (!forced && (!apiEnabled || !import.meta.env.PROD || local)) return false;
  return !privacySignal();
}

function beacon(body: string): void {
  try {
    if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(METRICS_URL, new Blob([body], { type: 'application/json' }))) return;
  } catch {
    // Fall back to fetch.
  }
  try {
    void fetch(METRICS_URL, { method: 'POST', body, keepalive: true, credentials: 'omit', headers: { 'Content-Type': 'application/json' } }).catch(() => undefined);
  } catch {
    // Nothing more to try.
  }
}

const tracker = createTracker({
  enabled: defaultEnabled,
  send: beacon,
  session: () => sessionStorage,
  local: () => localStorage,
});

if (typeof window !== 'undefined') {
  try {
    window.addEventListener('pagehide', tracker.flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') tracker.flush();
    });
  } catch {
    // No DOM: nothing to flush on.
  }
}

/** Counts `event` (see the top of this file); never throws. */
export const track = tracker.track;
