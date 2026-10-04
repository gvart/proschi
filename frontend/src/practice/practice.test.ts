import { format } from '../dsl/format';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from '../dsl';
import { defaultEngine, nullEngine, type Engine, type TestResult } from '../hld/engine';
import { parseInline, parseMarkdown, safeHref } from './markdown';
import { findProblem, problems } from './problems';
import { PROGRESS_KEY, loadProgress, saveProgress, sourceOf, statusOf, withRun, withSource } from './progress';
import { PROBLEM_FILE, parseSolution, problemResolver, runTests } from './workspace';
import { DIFFICULTIES, type Problem } from './types';

/** Use case names in the given `traffic` block. */
const trafficUseCases = (given: string) => [...(given.match(/traffic\s*\{([\s\S]*?)\}/)?.[1] ?? '').matchAll(/^\s*"([^"]+)"/gm)].map((m) => m[1]);

describe('problem index', () => {
  it('has unique, URL-safe ids', () => {
    const ids = problems.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(findProblem('url-shortener')?.title).toBe('URL Shortener');
    expect(findProblem('nope')).toBeUndefined();
  });

  it.each(problems.map((p) => [p.id, p] as const))('%s is complete', (_id, p: Problem) => {
    expect(DIFFICULTIES).toContain(p.difficulty);
    expect(p.title.trim()).not.toBe('');
    expect(p.tags.length).toBeGreaterThan(0);
    expect(p.hints.length).toBeGreaterThan(0);
    expect(p.statement).toMatch(/^## Functional requirements$/m);
    expect(p.starter.startsWith(`import "${PROBLEM_FILE}"\n`)).toBe(true);
    expect(p.solution.startsWith(`import "${PROBLEM_FILE}"\n`)).toBe(true);
    expect(p.given).not.toMatch(/^\s*import /m);
    // The traffic names use cases the reference solution defines, and the statement asks for them.
    const useCases = trafficUseCases(p.given);
    expect(useCases.length).toBeGreaterThan(0);
    for (const name of useCases) {
      expect(p.solution).toContain(`usecase "${name}"`);
      expect(p.statement).toContain(`**${name}**`);
    }
  });

  it.each(problems.map((p) => [p.id, p] as const))('%s starter has no errors of its own', (_id, p: Problem) => {
    expect(parseSolution(p, p.starter).diagnostics.filter((d) => d.file === undefined && d.severity === 'error')).toEqual([]);
  });

  it.each(problems.map((p) => [p.id, p] as const))('%s given and solution parse without any diagnostic', (_id, p: Problem) => {
    expect(parse(p.given).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(parseSolution(p, p.solution).diagnostics).toEqual([]);
  });

  it.each(problems.map((p) => [p.id, p] as const))('%s given and solution are in canonical format', (_id, p: Problem) => {
    expect(format(p.given)).toBe(p.given);
    expect(format(p.solution)).toBe(p.solution);
  });

  it.each(problems.map((p) => [p.id, p] as const))('%s reference solution passes every test', (_id, p: Problem) => {
    const run = runTests(parseSolution(p, p.solution), defaultEngine);
    expect(run.blocked).toBeUndefined();
    expect(run.results.filter((r) => !r.passed)).toEqual([]);
    expect(run.solved).toBe(true);
  });

  it.each(problems.map((p) => [p.id, p] as const))('%s starter fails at least one test', (_id, p: Problem) => {
    const run = runTests(parseSolution(p, p.starter), defaultEngine);
    expect(run.blocked).toBeUndefined();
    expect(run.results.length).toBeGreaterThan(0);
    expect(run.solved).toBe(false);
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
