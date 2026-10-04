import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from '../../dsl';
import { format } from '../../dsl/format';
import { DEMO_SCRIPT, DEMO_SOURCE, DEMO_USE_CASE, TOUR_END, Tour, captionAt, chapterAt, sourceAt, type TourFrame } from './demoScript';

describe('demo script', () => {
  it('ends in valid Proschi with no diagnostics, in canonical format', () => {
    const { diagram, diagnostics } = parse(DEMO_SOURCE);
    expect(diagnostics).toEqual([]);
    expect(diagram.nodes.every((n) => !n.implicit)).toBe(true);
    expect(diagram.nodes.map((n) => n.id).sort()).toEqual(['api', 'db', 'events', 'vpc', 'web']);
    expect(format(`${DEMO_SOURCE}\n`)).toBe(`${DEMO_SOURCE}\n`);
  });

  it('parses cleanly after every typed chunk, so the diagram never shows an error', () => {
    let index = 0;
    for (const [i, step] of DEMO_SCRIPT.entries()) {
      if (step.kind !== 'type') continue;
      const source = sourceAt({ index: i, typed: step.text.length });
      expect(parse(source).diagnostics, `after chunk ${++index}`).toEqual([]);
      // Each chunk adds to the diagram.
      expect(parse(source).diagram.nodes.length + parse(source).diagram.edges.length).toBeGreaterThan(0);
    }
  });

  it('plays scenarios the use case really has, the failing one last', () => {
    const [useCase] = parse(DEMO_SOURCE).diagram.useCases;
    expect([useCase.id, useCase.name]).toEqual([DEMO_USE_CASE.id, DEMO_USE_CASE.name]);
    const played = DEMO_SCRIPT.flatMap((s) => (s.kind === 'play' ? [s.scenario] : []));
    expect(played).toEqual(useCase.scenarios.map((s) => s.id));
    const failing = useCase.scenarios.find((s) => s.id === played.at(-1))!;
    expect(failing.steps.some((s) => s.failed)).toBe(true);
    expect(failing.steps[0].statusCode).toBe(503);
  });

  it('ends with the hand-off', () => {
    expect(DEMO_SCRIPT.at(-1)).toEqual({ kind: 'handoff', say: 'Your turn — edit anything.' });
    expect(sourceAt(TOUR_END)).toBe(DEMO_SOURCE);
    expect(captionAt(TOUR_END)).toBe('Your turn — edit anything.');
    expect(chapterAt(TOUR_END)).toBe(4);
  });
});

describe('tour', () => {
  let setItem: ReturnType<typeof vi.fn>;
  let replaceState: ReturnType<typeof vi.fn>;
  let pushState: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    setItem = vi.fn();
    replaceState = vi.fn();
    pushState = vi.fn();
    vi.stubGlobal('localStorage', { setItem, getItem: vi.fn(() => null), removeItem: setItem, clear: setItem });
    vi.stubGlobal('sessionStorage', { setItem, getItem: vi.fn(() => null), removeItem: setItem, clear: setItem });
    vi.stubGlobal('history', { replaceState, pushState });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Runs the tour to the end, finishing each scenario as the player would. */
  function runTour(): { frames: TourFrame[]; tour: Tour } {
    const frames: TourFrame[] = [];
    const tour = new Tour({ onFrame: (f) => frames.push(f) });
    tour.start();
    for (let guard = 0; !tour.done && guard < 10_000; guard++) {
      if (tour.step?.kind === 'play') tour.played();
      else vi.advanceTimersToNextTimer();
    }
    return { frames, tour };
  }

  it('types the whole document, plays both scenarios and hands off, never touching storage or history', () => {
    const { frames, tour } = runTour();
    expect(tour.done).toBe(true);
    expect(sourceAt(tour.current)).toBe(DEMO_SOURCE);
    // The document only ever grows while the tour types.
    const sources = frames.map((f) => sourceAt(f));
    for (let i = 1; i < sources.length; i++) expect(sources[i].startsWith(sources[i - 1])).toBe(true);
    expect(setItem).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
    expect(pushState).not.toHaveBeenCalled();
  });

  it('takes about 15 seconds of typing and waiting, plus the playback', () => {
    const tour = new Tour({ onFrame: () => {} });
    tour.start();
    const start = Date.now();
    while (tour.step?.kind !== 'play') vi.advanceTimersToNextTimer();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThan(8_000);
    expect(elapsed).toBeLessThan(20_000);
  });

  it('holds still while paused and goes on from the same place', () => {
    const frames: TourFrame[] = [];
    const tour = new Tour({ onFrame: (f) => frames.push(f) });
    tour.start();
    vi.advanceTimersByTime(1500);
    tour.pause();
    const at = tour.current;
    const count = frames.length;
    vi.advanceTimersByTime(60_000);
    expect(frames.length).toBe(count);
    tour.resume();
    vi.advanceTimersByTime(1000);
    expect(frames.length).toBeGreaterThan(count);
    expect(sourceAt(tour.current).startsWith(sourceAt(at))).toBe(true);
  });

  it('waits for the player at each scenario', () => {
    const tour = new Tour({ onFrame: () => {} });
    tour.start();
    while (tour.step?.kind !== 'play') vi.advanceTimersToNextTimer();
    const at = tour.current;
    vi.advanceTimersByTime(60_000);
    expect(tour.current).toEqual(at);
    tour.played();
    expect(tour.current.index).toBe(at.index + 1);
  });

  it('finish() jumps to the hand-off', () => {
    const tour = new Tour({ onFrame: () => {} });
    tour.start();
    vi.advanceTimersByTime(700);
    tour.finish();
    expect(tour.done).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(tour.done).toBe(true);
  });
});

describe('live demo', () => {
  // Persistence-free by construction: nothing the demo imports, however
  // indirectly, can save documents, write share links or touch storage.
  const here = dirname(fileURLToPath(import.meta.url));
  const FORBIDDEN = [/services\/storage/, /playground\/(documents|backup|imports)/, /onboarding\/seen/, /Playground\/Playground/];

  function importGraph(entry: string): Map<string, string> {
    const seen = new Map<string, string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      const text = readFileSync(file, 'utf8');
      seen.set(file, text);
      for (const m of text.matchAll(/(?:import|export)[^'"]*?from\s+'(\.[^']+)'|import\(\s*'(\.[^']+)'\s*\)|import\s+'(\.[^']+)'/g)) {
        const spec = m[1] ?? m[2] ?? m[3];
        if (/\.(css|svg|png)$/.test(spec) || spec.includes('?')) continue;
        const base = resolve(dirname(file), spec);
        const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
        const found = candidates.find((c) => {
          try {
            return readFileSync(c) && /\.tsx?$/.test(c);
          } catch {
            return false;
          }
        });
        if (found) visit(found);
      }
    };
    visit(entry);
    return seen;
  }

  it('imports nothing that persists', () => {
    const graph = importGraph(resolve(here, 'LiveDemo.tsx'));
    expect(graph.size).toBeGreaterThan(10);
    for (const [file, text] of graph) {
      expect(FORBIDDEN.some((re) => re.test(file)), file).toBe(false);
      expect(text, file).not.toMatch(/\b(localStorage|sessionStorage|indexedDB)\b/);
      expect(text, file).not.toMatch(/history\.(replaceState|pushState)/);
    }
  });
});
