import { describe, expect, it } from 'vitest';
import { defaultEngine } from '../../hld/engine';
import { findProblem, problems } from '../catalog';
import { ROADMAP } from '../roadmapStages';
import { parseSolution, runTests } from '../workspace';
import { currentStep, describeCheck, evaluateChecks, guidedIssues, guidedReducer, parseGuided, readGuidedProgress, readSelector } from './guidedFile';

const FILE = `## Add an API
- node: any service
- edge: visitor -> any service

Add the API.

## Store it
- node: any database
- replicas: any database x2
- usecase: Shorten
- test: Codes are stored before they are returned

Store the code.
`;

const problem = findProblem('url-shortener')!;
const design = (source: string) => parseSolution(problem, `import "problem.proschi"\n\n${source}`).diagram;

describe('guided.md', () => {
  it('reads steps and their checks', () => {
    const { steps, issues } = parseGuided(FILE);
    expect(issues).toEqual([]);
    expect(steps.map((s) => s.title)).toEqual(['Add an API', 'Store it']);
    expect(steps[0].checks).toEqual([
      { type: 'node', node: { kind: 'service' } },
      { type: 'edge', from: { id: 'visitor' }, to: { kind: 'service' } },
    ]);
    expect(steps[1].checks).toEqual([
      { type: 'node', node: { kind: 'database' } },
      { type: 'replicas', node: { kind: 'database' }, min: 2 },
      { type: 'usecase', name: 'Shorten' },
      { type: 'test', name: 'Codes are stored before they are returned' },
    ]);
    expect(steps[1].explanation).toBe('Store the code.');
  });

  it('reads selectors', () => {
    expect(readSelector('visitor')).toEqual({ id: 'visitor' });
    expect(readSelector('any cache')).toEqual({ kind: 'cache' });
    expect(readSelector('any spaceship')).toBeUndefined();
    expect(readSelector('two words')).toBeUndefined();
  });

  it.each([
    ['an empty file', '', /empty/],
    ['one step', FILE.slice(0, FILE.indexOf('## Store it')), /At least 2 steps/],
    ['a step without checks', FILE.replace('- node: any service\n- edge: visitor -> any service\n', ''), /needs at least one check/],
    ['a step without text', FILE.replace('Add the API.', ''), /write what to do/],
    ['an unknown kind', FILE.replace('- node: any service', '- node: any spaceship'), /takes a node id or "any <kind>"/],
    ['a bad edge', FILE.replace('visitor -> any service', 'visitor any service'), /"<node> -> <node>"/],
    ['a bad replica count', FILE.replace('any database x2', 'any database x1'), /n of 2 or more/],
    ['an unknown check', FILE.replace('- node: any database', '- cache: yes'), /unknown setting "cache"/],
    ['text before the first step', `Intro\n\n${FILE}`, /nothing goes before the first one/],
  ])('reports %s', (_, text, message) => {
    expect(parseGuided(text).issues.map((i) => i.message).join('\n')).toMatch(message);
  });

  it('evaluates structural checks on a parsed design', () => {
    const { steps } = parseGuided(FILE);
    const tests = () => undefined;
    const empty = design('');
    expect(evaluateChecks(steps[0].checks, empty, tests).map((r) => r.passed)).toEqual([false, false]);
    const api = design('api "API" [REST API]\n\nvisitor -> api\n');
    expect(evaluateChecks(steps[0].checks, api, tests).map((r) => r.passed)).toEqual([true, true]);
    // A use case step counts as a connection too.
    const viaStep = design('api "API" [REST API]\n\nusecase "Shorten" {\n  visitor -> api : POST /links\n  api --> visitor : 201\n}\n');
    expect(evaluateChecks(steps[0].checks, viaStep, tests).map((r) => r.passed)).toEqual([true, true]);
    // Replicas: every matching node, and at least one.
    const one = design('db "DB" [DynamoDB]\ndb2 "DB2" [PostgreSQL] x2\n');
    expect(evaluateChecks([{ type: 'replicas', node: { kind: 'database' }, min: 2 }], one, tests)[0].passed).toBe(false);
    expect(evaluateChecks([{ type: 'replicas', node: { kind: 'database' }, min: 2 }], design('db "DB" [DynamoDB] x3\n'), tests)[0].passed).toBe(true);
    expect(evaluateChecks([{ type: 'replicas', node: { kind: 'cache' }, min: 2 }], one, tests)[0].passed).toBe(false);
  });

  it('runs the tests once, and only when a check needs them', () => {
    const { steps } = parseGuided(FILE);
    let calls = 0;
    const tests = () => {
      calls++;
      return runTests(parseSolution(problem, problem.solution), defaultEngine).results;
    };
    evaluateChecks(steps[0].checks, design(''), tests);
    expect(calls).toBe(0);
    const solved = parseSolution(problem, problem.solution).diagram;
    const results = evaluateChecks([...steps[1].checks, { type: 'test', name: 'Redirects redirect' }], solved, tests);
    expect(calls).toBe(1);
    expect(results.every((r) => r.passed)).toBe(true);
    // The tests cannot run (errors in the design): a test check fails.
    expect(evaluateChecks([{ type: 'test', name: 'Redirects redirect' }], solved, () => undefined)[0].passed).toBe(false);
  });

  it('describes checks in words', () => {
    expect(describeCheck({ type: 'edge', from: { id: 'visitor' }, to: { kind: 'loadbalancer' } })).toBe('A connection from `visitor` to a load balancer');
    expect(describeCheck({ type: 'replicas', node: { kind: 'cache' }, min: 2 })).toBe('Every cache with at least 2 replicas (`x2`)');
    expect(describeCheck({ type: 'test', name: 'Misses fill the cache' })).toBe('The test “Misses fill the cache” passes');
  });

  it('checks a walkthrough against the problem: ids, use cases, tests, and the reference solution passing every check', () => {
    const solution = parseSolution(problem, problem.solution).diagram;
    const tests = runTests(parseSolution(problem, problem.solution), defaultEngine).results;
    expect(guidedIssues(FILE.replace('- edge: visitor -> any service\n', ''), solution, tests)).toEqual([]);
    const messages = (text: string) => guidedIssues(text, solution, tests).map((i) => i.message);
    // The reference solution puts a load balancer between the visitor and the API.
    expect(messages(FILE)).toEqual(['"Add an API": the reference solution fails the check "A connection from `visitor` to a service"']);
    expect(messages(FILE.replace('visitor -> any service', 'ghost -> any service')).join('\n')).toMatch(/no node "ghost"/);
    expect(messages(FILE.replace('- usecase: Shorten', '- usecase: Expand')).join('\n')).toMatch(/no use case "Expand"/);
    expect(messages(FILE.replace('- test: Codes are stored before they are returned', '- test: Nope')).join('\n')).toMatch(/no requirement or test is named "Nope"/);
  });

  it('unlocks steps in order', () => {
    let p = { done: [] as ('passed' | 'skipped')[] };
    expect(currentStep(p)).toBe(0);
    p = guidedReducer(p, { type: 'pass', step: 1 }, 3);
    expect(p.done).toEqual([]);
    p = guidedReducer(p, { type: 'pass', step: 0 }, 3);
    p = guidedReducer(p, { type: 'skip', step: 1 }, 3);
    expect(p.done).toEqual(['passed', 'skipped']);
    expect(currentStep(p)).toBe(2);
    p = guidedReducer(p, { type: 'pass', step: 2 }, 3);
    expect(guidedReducer(p, { type: 'pass', step: 3 }, 3)).toBe(p);
    expect(guidedReducer(p, { type: 'restart' }, 3).done).toEqual([]);
    expect(readGuidedProgress({ done: ['passed', 'nope'] }, 3)).toEqual({ done: [] });
    expect(readGuidedProgress({ done: ['passed', 'passed', 'passed', 'passed'] }, 3)).toEqual({ done: ['passed', 'passed', 'passed'] });
  });

  it('the roadmap’s first stage has a walkthrough, and only it', () => {
    const first = new Set(ROADMAP[0].problems);
    for (const p of problems) expect(p.guided !== undefined, p.id).toBe(first.has(p.id));
    for (const id of first) {
      const p = findProblem(id)!;
      const run = runTests(parseSolution(p, p.solution), defaultEngine);
      expect(guidedIssues(p.guided!, parseSolution(p, p.solution).diagram, run.results), id).toEqual([]);
      // The starter already passes the first step: a beginner starts with a success.
      const { steps } = parseGuided(p.guided!);
      const starter = parseSolution(p, p.starter);
      const starterTests = () => runTests(starter, defaultEngine).results;
      expect(evaluateChecks(steps[0].checks, starter.diagram, starterTests).every((r) => r.passed), id).toBe(true);
    }
  });
});
