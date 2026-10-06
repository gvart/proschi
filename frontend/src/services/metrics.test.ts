import { describe, expect, it } from 'vitest';
import { createTracker, METRICS_ONCE_KEY, privacySignal, track, type TrackerDeps } from './metrics';
import { isClientMetricEvent, MAX_METRIC_BATCH, METRIC_EVENTS } from './metricsEvents';

function memoryStore(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  } as Storage;
}

/** A tracker that flushes when told to, and the bodies it sent. */
function setup(overrides: Partial<TrackerDeps> = {}) {
  const sent: string[][] = [];
  const pending: (() => void)[] = [];
  const session = memoryStore();
  const local = memoryStore();
  const tracker = createTracker({
    enabled: () => true,
    send: (body) => void sent.push((JSON.parse(body) as { events: string[] }).events),
    session: () => session,
    local: () => local,
    schedule: (fn) => void pending.push(fn),
    ...overrides,
  });
  const run = () => pending.splice(0).forEach((fn) => fn());
  return { tracker, sent, run, session, local };
}

describe('metrics', () => {
  it('batches a burst of events into one request', () => {
    const { tracker, sent, run } = setup();
    tracker.track('editor_open');
    tracker.track('test_run');
    tracker.track('test_run');
    expect(sent).toEqual([]);
    run();
    expect(sent).toEqual([['editor_open', 'test_run', 'test_run']]);
  });

  it(`splits more than ${MAX_METRIC_BATCH} events into several requests`, () => {
    const { tracker, sent } = setup();
    for (let i = 0; i < MAX_METRIC_BATCH + 3; i++) tracker.track('export');
    tracker.flush();
    expect(sent.map((b) => b.length)).toEqual([MAX_METRIC_BATCH, 3]);
  });

  it('counts a "once" event once per session or browser, by key', () => {
    const { tracker, sent, run, session, local } = setup();
    tracker.track('editor_open', { once: 'session' });
    tracker.track('editor_open', { once: 'session' });
    tracker.track('editor_first_edit', { once: 'browser' });
    tracker.track('editor_first_edit', { once: 'browser' });
    tracker.track('problem_start', { once: 'session', key: 'problem_start:a' });
    tracker.track('problem_start', { once: 'session', key: 'problem_start:b' });
    tracker.track('problem_start', { once: 'session', key: 'problem_start:a' });
    run();
    expect(sent).toEqual([['editor_open', 'editor_first_edit', 'problem_start', 'problem_start']]);
    expect(JSON.parse(session.getItem(METRICS_ONCE_KEY)!)).toEqual(['editor_open', 'problem_start:a', 'problem_start:b']);
    expect(JSON.parse(local.getItem(METRICS_ONCE_KEY)!)).toEqual(['editor_first_edit']);

    // A new tab session with the same browser storage.
    const next = createTracker({ enabled: () => true, send: (b) => void sent.push(JSON.parse(b).events), session: memoryStore, local: () => local, schedule: (fn) => fn() });
    next.track('editor_first_edit', { once: 'browser' });
    next.track('editor_open', { once: 'session' });
    expect(sent.at(-1)).toEqual(['editor_open']);
  });

  it('keeps "once" in memory when storage throws', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } as unknown as Storage;
    const { tracker, sent, run } = setup({ session: () => broken, local: () => { throw new Error('no storage'); } });
    tracker.track('landing_view', { once: 'session' });
    tracker.track('landing_view', { once: 'session' });
    tracker.track('editor_first_edit', { once: 'browser' });
    tracker.track('editor_first_edit', { once: 'browser' });
    run();
    expect(sent).toEqual([['landing_view', 'editor_first_edit']]);
  });

  it('sends nothing when disabled, and never throws', () => {
    const off = setup({ enabled: () => false });
    off.tracker.track('export');
    off.run();
    off.tracker.flush();
    expect(off.sent).toEqual([]);

    const failing = setup({ send: () => { throw new Error('offline'); }, enabled: () => true });
    expect(() => {
      failing.tracker.track('export');
      failing.run();
    }).not.toThrow();
    const exploding = setup({ enabled: () => { throw new Error('boom'); } });
    expect(() => exploding.tracker.track('export')).not.toThrow();
  });

  it('is off in tests: the real track sends nothing and does not throw', () => {
    expect(() => track('landing_view')).not.toThrow();
  });

  it('reads Do Not Track and Global Privacy Control', () => {
    expect(privacySignal({ doNotTrack: '1' } as Navigator)).toBe(true);
    expect(privacySignal({ doNotTrack: null, globalPrivacyControl: true } as unknown as Navigator)).toBe(true);
    expect(privacySignal({ doNotTrack: '0' } as Navigator)).toBe(false);
    expect(privacySignal(undefined)).toBe(false);
  });

  it('lets a page send every event but sign_in, which only the server counts', () => {
    expect(METRIC_EVENTS.filter((e) => !isClientMetricEvent(e))).toEqual(['sign_in']);
    expect(isClientMetricEvent('page_view')).toBe(false);
  });
});
