import type { Engine } from '../hld/engine';
import type { Mistake, Problem, WrongDesign } from './types';
import { parseSolution, runTests } from './workspace';

/**
 * Failing tests that teach (docs/PRACTICE.md, "Known mistakes"): each wrong
 * design names the mistake it makes in its leading comments, and a learner's
 * failed run is matched to the known mistake whose failures it shows. Pure,
 * so the problem page, the tests and `proschi problem check` share it.
 *
 *   # expect-fail: Misses fill the cache
 *   # mistake: Cache misses that never fill the cache
 *   # explain: The miss reads the database … After a miss, SET the code in the cache.
 *   # lesson: cache-aside-lazy-loading
 *   # cards: cache-aside, hit-rate-to-db-load
 */

export const MISTAKE_FIELDS = ['mistake', 'explain', 'lesson', 'cards'] as const;
type Field = (typeof MISTAKE_FIELDS)[number];

const FIELD_LINE = /^#\s*(mistake|explain|lesson|cards):\s*(.*?)\s*$/;

export interface MistakeIssue {
  message: string;
  /** 1-based line in the wrong design. */
  line: number;
}

/**
 * The mistake a wrong design's leading comments describe, and what is wrong
 * with those lines (a repeated field, an empty value). `explain` may span
 * several `# explain:` lines, joined with spaces; the other fields appear
 * once. Undefined when there is no `# mistake:` line.
 */
export function readMistake(source: string): { mistake?: Mistake; issues: MistakeIssue[] } {
  const values: Partial<Record<Field, string>> = {};
  const issues: MistakeIssue[] = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length && lines[i].startsWith('#'); i++) {
    const m = FIELD_LINE.exec(lines[i]);
    if (!m) continue;
    const field = m[1] as Field;
    const value = m[2];
    if (value === '') issues.push({ message: `"# ${field}:" is empty`, line: i + 1 });
    if (field === 'explain') values.explain = values.explain ? `${values.explain} ${value}` : value;
    else if (values[field] !== undefined) issues.push({ message: `"# ${field}:" appears twice`, line: i + 1 });
    else values[field] = value;
  }
  if (values.mistake === undefined) return { issues };
  const cards = (values.cards ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  return {
    mistake: {
      title: values.mistake,
      explain: values.explain ?? '',
      ...(values.lesson ? { lesson: values.lesson } : {}),
      cards,
    },
    issues,
  };
}

/** A test result as the matcher needs it (sim/tests.ts's TestResult fits). */
export interface FailedTest {
  name: string;
  passed: boolean;
  /** `flow` for a `test` block, else the requirement's kind. */
  category: string;
}

export interface MistakeMatch {
  /** The wrong design's name, e.g. miss-never-fills-cache. */
  design: string;
  mistake: Mistake;
  /** Its `# expect-fail:` names the run fails too. */
  shared: string[];
  /** The run fails every test the design names. */
  full: boolean;
}

/**
 * Every test each wrong design of a problem fails, by design name: what
 * matchMistake compares a run with. Runs each design once.
 */
export function knownFailures(problem: Problem, engine: Engine): Map<string, string[]> {
  return new Map(
    (problem.wrong ?? []).map((w) => [
      w.name,
      runTests(parseSolution(problem, w.source), engine)
        .results.filter((r) => !r.passed)
        .map((r) => r.name),
    ]),
  );
}

/**
 * The known mistake a run most likely makes, or undefined. A wrong design
 * matches when the run fails every test its `# expect-fail:` lines name (a
 * full match), or, short of that, at least one of its `test` blocks (a
 * partial match: a requirement such as `survive any node failure` alone has
 * too many causes to name one). Full matches come first; then the design
 * whose failures are most like the run's (the share of the two sets of failed
 * tests they have in common, from `failures` when given, see knownFailures,
 * else its `# expect-fail:` names); then the one sharing the most named
 * failures, the most `test` blocks, and the name.
 */
export function matchMistake(
  wrong: readonly WrongDesign[] | undefined,
  results: readonly FailedTest[],
  failures?: ReadonlyMap<string, readonly string[]>,
): MistakeMatch | undefined {
  const failed = new Map(results.filter((r) => !r.passed).map((r) => [r.name, r.category]));
  if (failed.size === 0) return undefined;
  const candidates: (MistakeMatch & { flows: number; similarity: number })[] = [];
  for (const w of wrong ?? []) {
    if (!w.mistake || w.expectFail.length === 0) continue;
    const shared = w.expectFail.filter((name) => failed.has(name));
    const flows = shared.filter((name) => failed.get(name) === 'flow').length;
    const full = shared.length === w.expectFail.length;
    if (!full && flows === 0) continue;
    const theirs = new Set([...(failures?.get(w.name) ?? []), ...w.expectFail]);
    const common = [...theirs].filter((name) => failed.has(name)).length;
    const similarity = common / (theirs.size + failed.size - common);
    candidates.push({ design: w.name, mistake: w.mistake, shared, full, flows, similarity });
  }
  candidates.sort(
    (a, b) =>
      Number(b.full) - Number(a.full) ||
      b.similarity - a.similarity ||
      b.shared.length - a.shared.length ||
      b.flows - a.flows ||
      a.design.localeCompare(b.design),
  );
  const best = candidates[0];
  return best && { design: best.design, mistake: best.mistake, shared: best.shared, full: best.full };
}
