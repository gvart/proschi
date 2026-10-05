import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from '../dsl';
import { defaultEngine, nullEngine, type Engine, type TestResult } from '../hld/engine';
import { parseInline, parseMarkdown, safeHref } from './markdown';
import { catalogErrors, findProblem, problems } from './catalog';
import { loadProblem } from './loadProblem';
import { PROGRESS_KEY, loadProgress, saveProgress, sourceOf, statusOf, withRun, withSource } from './progress';
import { CAPACITY_MESSAGE, PROBLEM_FILE, parseSolution, problemResolver, runTests } from './workspace';
import { validateProblem } from './validate';
import type { Problem } from './types';

describe('problem catalog', () => {
  it('reads every problem folder', () => {
    expect(catalogErrors.map((e) => e.message)).toEqual([]);
    expect(problems.length).toBeGreaterThanOrEqual(17);
  });

  it('has unique ids and finds problems by id', () => {
    const ids = problems.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(findProblem('url-shortener')?.title).toBe('URL Shortener');
    expect(findProblem('nope')).toBeUndefined();
  });

  it('loads one problem on its own, the same as the catalog has it', async () => {
    for (const p of problems) expect(await loadProblem(p.id)).toEqual(p);
    expect(await loadProblem('nope')).toBeUndefined();
  });

  it('lists problems by difficulty, then order, then title', () => {
    expect(problems.map((p) => p.id)).toEqual([
      'shopping-cart',
      'pastebin',
      'rate-limiter',
      'snowflake-ids',
      'url-shortener',
      'chat',
      'job-queue',
      'file-storage',
      'news-feed',
      'notification-fanout',
      'ride-matching',
      'search-autocomplete',
      'view-counting',
      'payments',
      'social-graph-cache',
      'ticket-booking',
      'video-streaming',
    ]);
  });

  // validate.ts is the definition `proschi problem check` uses too.
  it.each(problems.map((p) => [p.id, p] as const))('%s is a valid problem', (_id, p: Problem) => {
    expect(validateProblem(p, defaultEngine).violations).toEqual([]);
  });

  const wrong = problems.flatMap((p) => (p.wrong ?? []).map((w) => [`${p.id}/wrong/${w.name}`, p, w.name] as const));
  it('has plausible wrong designs', () => expect(wrong.length).toBeGreaterThanOrEqual(36));
  it.each(wrong)('%s fails the tests it names', (_name, p: Problem, name: string) => {
    const report = validateProblem(p, defaultEngine).wrong.find((w) => w.name === name)!;
    expect(report.expectFail.length).toBeGreaterThan(0);
    expect(report.missing).toEqual([]);
    for (const test of report.expectFail) expect(report.failed).toContain(test);
  });

  it('notification-fanout: the SMS failover may check the primary in the background without losing the fallback', () => {
    const p = findProblem('notification-fanout')!;
    const from = '    smsBackup --> worker    : 202\n    worker    --> events    : delete\n';
    expect(p.solution).toContain(from);
    const source = p.solution.replace(from, `${from}    worker     -> sms       : GET /messages/m_1/status\n    sms       --> worker    : 404 never sent\n`);
    const run = runTests(parseSolution(p, source), defaultEngine);
    expect(run.blocked).toBeUndefined();
    expect(run.results.filter((r) => !r.passed)).toEqual([]);
  });
});

describe('practice capacity rule', () => {
  const p = findProblem('url-shortener')!;
  const cheat = `${p.solution}\ncapacity {\n  db 1m rps cost 1 usd/month\n}\n`;

  it('reference solutions set no capacity of their own beyond shards', () => {
    for (const q of problems) {
      for (const c of parseSolution(q, q.solution).diagram.capacity ?? []) {
        if (c.loc.file !== PROBLEM_FILE) expect(Object.keys(c).sort(), q.id).toEqual(['loc', 'node', 'shards']);
      }
    }
  });

  it('reports capacity in the solver file as an error and ignores it', () => {
    const parsed = parseSolution(p, cheat);
    const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toEqual([expect.objectContaining({ message: expect.stringContaining(CAPACITY_MESSAGE), line: cheat.split('\n').indexOf('  db 1m rps cost 1 usd/month') + 1 })]);
    expect(errors[0].file).toBeUndefined();
    expect(parsed.diagram.capacity).toBeUndefined();
    expect(runTests(parsed, defaultEngine).blocked).toBe('errors');
    // The override has no effect on the simulation: same figures as without it.
    const honest = defaultEngine.analyze(parseSolution(p, p.solution).diagram)!;
    const cheated = defaultEngine.analyze(parsed.diagram)!;
    expect(cheated.totalCostUsd).toBe(honest.totalCostUsd);
    expect(cheated.nodes.find((n) => n.id === 'db')).toEqual(honest.nodes.find((n) => n.id === 'db'));
    // A regular document believes it.
    const plain = defaultEngine.analyze(parse(cheat.replace('import "problem.proschi"\n', p.given)).diagram)!;
    expect(plain.totalCostUsd).toBeLessThan(honest.totalCostUsd);
  });

  it('keeps the given capacity, and shards from the solver file', () => {
    const q = findProblem('ticket-booking')!;
    const parsed = parseSolution(q, q.solution);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.diagram.capacity?.map((c) => [c.node, c.loc.file])).toEqual([
      ['payments', PROBLEM_FILE],
      ['db', undefined],
    ]);
    const mixed = parseSolution(q, q.solution.replace('  db shards 2\n', '  db shards 2 writes 50k rps\n'));
    expect(mixed.diagnostics.map((d) => d.message)).toEqual([expect.stringContaining(CAPACITY_MESSAGE)]);
    expect(mixed.diagram.capacity?.find((c) => c.node === 'db')).toEqual({ node: 'db', shards: 2, loc: expect.anything() });
  });

  it('does not let the solver shorten timeouts: a failure scenario would cost nothing', () => {
    const q = findProblem('ticket-booking')!;
    const timed = parseSolution(q, q.solution.replace('  db shards 2\n', '  db shards 2 timeout 1ms\n'));
    expect(timed.diagnostics.map((d) => d.message)).toEqual([expect.stringContaining(CAPACITY_MESSAGE)]);
    expect(timed.diagram.capacity?.find((c) => c.node === 'db')).toEqual({ node: 'db', shards: 2, loc: expect.anything() });
  });

  it('does not touch the given capacity or regular documents', () => {
    const q = findProblem('payments')!;
    expect(parseSolution(q, q.solution).diagram.capacity).toEqual([expect.objectContaining({ node: 'gateway', rps: 5000, latencyMs: 250 })]);
    expect(parse(cheat.replace('import "problem.proschi"\n', p.given)).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
});

describe('statement Markdown', () => {
  it('reads headings, paragraphs, lists, nested lists and code', () => {
    const blocks = parseMarkdown('# Title\n\nSome *text*\ncontinued.\n\n- one\n- two\n  - nested\n  more\n\n1. first\n2. second\n\n```proschi\na -> b\n```\n## Next');
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'list', 'list', 'code', 'heading']);
    expect(blocks[1]).toEqual({ kind: 'paragraph', children: [{ kind: 'text', text: 'Some ' }, { kind: 'em', children: [{ kind: 'text', text: 'text' }] }, { kind: 'text', text: ' continued.' }] });
    expect(blocks[2]).toEqual({
      kind: 'list',
      ordered: false,
      items: [
        { children: [{ kind: 'text', text: 'one' }] },
        { children: [{ kind: 'text', text: 'two' }], sublist: { ordered: false, items: [[{ kind: 'text', text: 'nested more' }]] } },
      ],
    });
    expect(blocks[3]).toMatchObject({ kind: 'list', ordered: true });
    expect(blocks[4]).toEqual({ kind: 'code', lang: 'proschi', text: 'a -> b' });
    expect(blocks[5]).toMatchObject({ kind: 'heading', level: 2 });
  });

  it('reads inline code, bold, italics and links; markup inside code stays text', () => {
    expect(parseInline('Use `**not bold**` and **bold _both_** or __b__ [docs](https://x.dev/a)')).toEqual([
      { kind: 'text', text: 'Use ' },
      { kind: 'code', text: '**not bold**' },
      { kind: 'text', text: ' and ' },
      { kind: 'strong', children: [{ kind: 'text', text: 'bold ' }, { kind: 'em', children: [{ kind: 'text', text: 'both' }] }] },
      { kind: 'text', text: ' or ' },
      { kind: 'strong', children: [{ kind: 'text', text: 'b' }] },
      { kind: 'text', text: ' ' },
      { kind: 'link', href: 'https://x.dev/a', children: [{ kind: 'text', text: 'docs' }] },
    ]);
    // Underscores inside words are not emphasis.
    expect(parseInline('snake_case_name')).toEqual([{ kind: 'text', text: 'snake_case_name' }]);
  });

  it('never produces unsafe links or HTML', () => {
    expect(parseInline('[click](javascript:alert)')).toEqual([{ kind: 'text', text: 'click' }]);
    expect(safeHref('data:text/html,x')).toBeUndefined();
    expect(safeHref('../app/')).toBe('../app/');
    expect(safeHref('#top')).toBe('#top');
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(parseMarkdown('<script>alert(1)</script>')).toEqual([{ kind: 'paragraph', children: [{ kind: 'text', text: '<script>alert(1)</script>' }] }]);
  });

  it.each(problems.map((p) => [p.id, p.statement] as const))('%s statement has headings and lists', (_id, statement) => {
    const blocks = parseMarkdown(statement);
    expect(blocks.filter((b) => b.kind === 'heading').length).toBeGreaterThanOrEqual(3);
    expect(blocks.some((b) => b.kind === 'list')).toBe(true);
  });
});

describe('progress', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const problem = problems[0];

  it('starts empty and round-trips through storage', () => {
    expect(loadProgress()).toEqual({});
    expect(statusOf({}, problem.id)).toBe('todo');
    expect(sourceOf({}, problem)).toBe(problem.starter);
    const progress = withSource({}, problem, 'a -> b');
    saveProgress(progress);
    expect(JSON.parse(store.get(PROGRESS_KEY)!)).toEqual({ [problem.id]: { status: 'attempted', source: 'a -> b' } });
    expect(loadProgress()).toEqual(progress);
    expect(sourceOf(loadProgress(), problem)).toBe('a -> b');
  });

  it('editing makes a problem attempted; the starter alone does not; solved stays solved', () => {
    expect(withSource({}, problem, problem.starter)).toEqual({ [problem.id]: { status: 'todo' } });
    const solved = withRun(withSource({}, problem, 'x'), problem, true);
    expect(statusOf(solved, problem.id)).toBe('solved');
    expect(statusOf(withSource(solved, problem, 'y'), problem.id)).toBe('solved');
    expect(statusOf(withRun(solved, problem, false), problem.id)).toBe('solved');
    expect(statusOf(withRun({}, problem, false), problem.id)).toBe('attempted');
  });

  it('ignores damaged entries and unavailable storage', () => {
    store.set(PROGRESS_KEY, JSON.stringify({ a: { status: 'solved', source: 1 }, b: { status: 'weird' }, c: null }));
    expect(loadProgress()).toEqual({ a: { status: 'solved' } });
    store.set(PROGRESS_KEY, '[1,2]');
    expect(loadProgress()).toEqual({});
    store.set(PROGRESS_KEY, '{not json');
    expect(loadProgress()).toEqual({});
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(loadProgress()).toEqual({});
    expect(() => saveProgress({ a: { status: 'todo' } })).not.toThrow();
  });
});

describe('problem.proschi', () => {
  const fake: Problem = {
    ...problems[0],
    given: 'client "Client" [Actor]\nusecase "Ping" {\n  client -> api : GET /ping\n}\n',
  };

  it('resolves to the given source, so its nodes and use cases join the solution', () => {
    const result = parseSolution(fake, `import "${PROBLEM_FILE}"\napi "API" [REST API]\nclient -> api\n`);
    expect(result.diagnostics).toEqual([]);
    expect(result.imports).toEqual([expect.objectContaining({ path: PROBLEM_FILE, resolved: PROBLEM_FILE })]);
    expect(result.diagram.nodes.find((n) => n.id === 'client')?.loc.file).toBe(PROBLEM_FILE);
    expect(result.diagram.useCases.map((u) => u.name)).toEqual(['Ping']);
  });

  it('resolves ./problem.proschi too, and nothing else', () => {
    const resolve = problemResolver(fake);
    expect(resolve('./problem.proschi', 'solution.proschi')?.source).toBe(fake.given);
    expect(resolve('other.proschi', 'solution.proschi')).toBeUndefined();
    expect(parseSolution(fake, 'import "other.proschi"\n').diagnostics[0].message).toMatch(/other\.proschi/);
  });

  it('works for every problem', () => {
    for (const p of problems) {
      const result = parseSolution(p, p.starter);
      expect(result.imports?.[0].resolved).toBe(PROBLEM_FILE);
      expect(result.diagram.nodes.some((n) => n.loc.file === PROBLEM_FILE)).toBe(true);
    }
  });
});

describe('running tests', () => {
  const problem = problems[0];
  const ok = parse('a -> b');
  const result = (passed: boolean): TestResult => ({ id: `t${passed}`, name: 'T', category: 'flow', passed, message: '' });

  it('needs the simulation and a document without errors', () => {
    expect(runTests(ok, nullEngine)).toEqual({ blocked: 'no-engine', results: [], passed: 0, solved: false });
    const engine: Engine = { available: true, analyze: () => undefined, runTests: () => [result(true)] };
    expect(runTests(parse('a [X]\na [Y]'), engine).blocked).toBe('errors');
    expect(runTests(parseSolution(problem, 'a -> b'), engine)).toMatchObject({ passed: 1, solved: true });
  });

  it('is solved only when every test passes and there is at least one', () => {
    const engine = (results: TestResult[]): Engine => ({ available: true, analyze: () => undefined, runTests: () => results });
    expect(runTests(ok, engine([result(true), result(false)]))).toMatchObject({ passed: 1, solved: false });
    expect(runTests(ok, engine([])).solved).toBe(false);
  });
});
