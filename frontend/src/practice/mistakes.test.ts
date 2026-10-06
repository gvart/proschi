import { describe, expect, it } from 'vitest';
import { defaultEngine } from '../hld/engine';
import { problems } from './catalog';
import { knownFailures, matchMistake, readMistake, type FailedTest } from './mistakes';
import { expectFailLines } from './problemFiles';
import type { Mistake, WrongDesign } from './types';
import { parseSolution, runTests } from './workspace';

const mistake = (title: string): Mistake => ({ title, explain: `${title}, explained.`, cards: [] });
const design = (name: string, expectFail: string[], withMistake = true): WrongDesign => ({ name, source: '', expectFail, ...(withMistake ? { mistake: mistake(name) } : {}) });
const result = (name: string, passed = false, category = 'flow'): FailedTest => ({ name, passed, category });

describe('readMistake', () => {
  it('reads the fields from the leading comments, joining explain lines', () => {
    const source = [
      '# expect-fail: Misses fill the cache',
      '# mistake: Cache misses that never fill the cache',
      '# explain: The miss never writes the cache.',
      '#explain:   The hit rate decays.  ',
      '# lesson: cache-aside-lazy-loading',
      '# cards: cache-aside, hit-rate-to-db-load,',
      '# A free comment.',
      'import "problem.proschi"',
      '# mistake: not read, after the code starts',
    ].join('\n');
    expect(readMistake(source)).toEqual({
      mistake: {
        title: 'Cache misses that never fill the cache',
        explain: 'The miss never writes the cache. The hit rate decays.',
        lesson: 'cache-aside-lazy-loading',
        cards: ['cache-aside', 'hit-rate-to-db-load'],
      },
      issues: [],
    });
    expect(expectFailLines(source)).toEqual(['Misses fill the cache']);
  });

  it('has no mistake without a mistake line, and reports repeated or empty fields', () => {
    expect(readMistake('# expect-fail: A\n# explain: Why.\nimport "problem.proschi"\n')).toEqual({ issues: [] });
    expect(readMistake('# mistake: A\n# mistake: B\n# lesson:\nimport "problem.proschi"\n')).toEqual({
      mistake: { title: 'A', explain: '', cards: [] },
      issues: [
        { message: '"# mistake:" appears twice', line: 2 },
        { message: '"# lesson:" is empty', line: 3 },
      ],
    });
  });
});

describe('matchMistake', () => {
  const wrong = [
    design('no-cache', ['Reads hit the cache first', 'p99 of Read < 50 ms']),
    design('miss-never-fills', ['Misses fill the cache']),
    design('one-node', ['survive any node failure']),
    design('unnamed', ['Writes are durable'], false),
  ];

  it('matches the design whose named failures the run all fails', () => {
    const match = matchMistake(wrong, [result('Misses fill the cache'), result('Reads hit the cache first', true)]);
    expect(match).toEqual({ design: 'miss-never-fills', mistake: mistake('miss-never-fills'), shared: ['Misses fill the cache'], full: true });
  });

  it('prefers a full match, then the one sharing the most failures', () => {
    const run = [result('Reads hit the cache first'), result('p99 of Read < 50 ms', false, 'latency'), result('Misses fill the cache')];
    expect(matchMistake(wrong, run)?.design).toBe('no-cache');
    // Only the flow test of no-cache fails: a partial match loses to a full one.
    expect(matchMistake(wrong, [result('Reads hit the cache first'), result('Misses fill the cache')])?.design).toBe('miss-never-fills');
  });

  it('falls back to a partial match on a test block, never on a requirement alone', () => {
    expect(matchMistake(wrong, [result('Reads hit the cache first')])).toMatchObject({ design: 'no-cache', full: false, shared: ['Reads hit the cache first'] });
    expect(matchMistake(wrong, [result('p99 of Read < 50 ms', false, 'latency')])).toBeUndefined();
    // A requirement the design names in full is a match.
    expect(matchMistake(wrong, [result('survive any node failure', false, 'resilience')])?.design).toBe('one-node');
  });

  it('matches nothing for a passing run, unknown failures, or designs without a mistake', () => {
    expect(matchMistake(wrong, [result('Misses fill the cache', true)])).toBeUndefined();
    expect(matchMistake(wrong, [result('Something else')])).toBeUndefined();
    expect(matchMistake(wrong, [result('Writes are durable', false, 'durability')])).toBeUndefined();
    expect(matchMistake(undefined, [result('Misses fill the cache')])).toBeUndefined();
  });

  it("prefers the design whose failures are most like the run's, when every design's failures are known", () => {
    const designs = [design('lb-not-cdn', ['Served by the CDN']), design('from-bucket', ['Served by the CDN', 'cost ≤ $45,000/month'])];
    const run = [result('Served by the CDN'), result('cost ≤ $45,000/month', false, 'cost')];
    expect(matchMistake(designs, run)?.design).toBe('from-bucket');
    const failures = new Map([
      ['lb-not-cdn', ['Served by the CDN', 'cost ≤ $45,000/month', 'p99 of Download < 1 s']],
      ['from-bucket', ['Served by the CDN', 'cost ≤ $45,000/month']],
    ]);
    expect(matchMistake(designs, [...run, result('p99 of Download < 1 s', false, 'latency')], failures)?.design).toBe('lb-not-cdn');
    expect(matchMistake(designs, run, failures)?.design).toBe('from-bucket');
  });

  it('breaks ties by name, so the match is stable', () => {
    const twins = [design('b', ['T']), design('a', ['T'])];
    expect(matchMistake(twins, [result('T')])?.design).toBe('a');
  });
});

describe('every wrong design teaches', () => {
  const wrong = problems.flatMap((p) => (p.wrong ?? []).map((w) => [`${p.id}/wrong/${w.name}`, p, w] as const));

  it.each(wrong)('%s names its mistake, and a run like it is matched to a known mistake', (_name, p, w) => {
    expect(w.mistake?.title).toBeTruthy();
    expect(w.mistake!.explain.length).toBeGreaterThan(40);
    expect(w.mistake!.lesson).toBeTruthy();
    expect(w.mistake!.cards.length).toBeGreaterThan(0);
    const run = runTests(parseSolution(p, w.source), defaultEngine);
    // Compared with what every design of the problem fails, a run of this design is matched to its own
    // mistake, or to one of a design that fails exactly the same tests (no run can tell those apart).
    const failures = knownFailures(p, defaultEngine);
    const match = matchMistake(p.wrong, run.results, failures)!.design;
    if (match !== w.name) expect(failures.get(match)).toEqual(failures.get(w.name));
    // Without that, the match still shows every failure the matched design names.
    const rough = matchMistake(p.wrong, run.results);
    expect(rough?.full || rough?.design === w.name).toBe(true);
  });
});
