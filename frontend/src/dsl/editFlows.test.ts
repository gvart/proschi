import { describe, expect, it } from 'vitest';
import { addConnection, addNode, addScenario, addStep, addUseCase, removeScenario, removeStep, removeUseCase, setReplicas, useCaseOutline, type EditResult, type NewStep } from './edit';
import { parse } from './parser';
import { findProblem } from '../practice/catalog';
import { parseSolution, runTests } from '../practice/workspace';
import { defaultEngine } from '../hld/engine';

/** The source of an edit that must succeed. */
const ok = (r: EditResult): string => {
  if (r.error !== undefined) throw new Error(r.error);
  return r.source;
};

const req = (from: string, to: string, label?: string): NewStep => ({ from, to, kind: 'request', label });
const res = (from: string, to: string, label?: string): NewStep => ({ from, to, kind: 'response', label });

describe('use case edits', () => {
  it('adds an empty use case at the end, once per name', () => {
    const src = 'api\ndb\napi -> db\n';
    const added = addUseCase(src, 'Read');
    expect(added).toBe('api\ndb\napi -> db\n\nusecase "Read" {\n}\n');
    expect(addUseCase(added, 'Read')).toBe(added);
    expect(addUseCase(added, '  ')).toBe(added);
    expect(addUseCase('', 'A')).toBe('usecase "A" {\n}\n');
    expect(parse(added).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('appends steps to the main flow and connects the components a request needs', () => {
    let src = addUseCase('user\napi\n', 'Say hello');
    src = ok(addStep(src, 'Say hello', req('user', 'api', 'GET /hello')));
    src = ok(addStep(src, 'Say hello', res('api', 'user', '200 {"message": "Hello"}')));
    expect(src).toBe('user\napi\nuser -> api\n\nusecase "Say hello" {\n  user -> api : GET /hello\n  api --> user : 200 {"message": "Hello"}\n}\n');
    const { diagram, diagnostics } = parse(src);
    expect(diagnostics).toEqual([]);
    expect(diagram.useCases[0].steps).toHaveLength(1);
    expect(diagram.useCases[0].steps[0].statusCode).toBe(200);
  });

  it('keeps a label with an unclosed bracket on its line', () => {
    const src = ok(addStep(addUseCase('a\nb\na -> b\n', 'U'), 'U', req('a', 'b', 'POST {"x": 1')));
    expect(src).toContain('  a -> b : POST "x": 1\n}');
  });

  it('refuses a step to itself, or into a use case or scenario that does not exist', () => {
    const src = addUseCase('a\nb\n', 'U');
    expect(addStep(src, 'U', req('a', 'a')).error).toMatch(/one component to another/);
    expect(addStep(src, 'Nope', req('a', 'b')).error).toMatch(/no use case "Nope"/);
    expect(addStep(src, 'U', req('a', 'b'), 'Hit').error).toMatch(/no scenario "Hit"/);
  });

  it('adds scenarios side by side, steps into each, and the main flow continues after them', () => {
    let src = addUseCase('v\napi\ncache\ndb\n', 'Redirect');
    src = ok(addStep(src, 'Redirect', req('v', 'api', 'GET /x')));
    src = ok(addStep(src, 'Redirect', req('api', 'cache', 'GET x')));
    src = ok(addScenario(src, 'Redirect', 'Cache hit'));
    src = ok(addScenario(src, 'Redirect', 'Cache miss'));
    expect(addScenario(src, 'Redirect', 'Cache hit').error).toMatch(/already has/);
    src = ok(addStep(src, 'Redirect', res('cache', 'api', 'target'), 'Cache hit'));
    src = ok(addStep(src, 'Redirect', res('cache', 'api', 'nil'), 'Cache miss'));
    src = ok(addStep(src, 'Redirect', req('api', 'db', 'GetItem'), 'Cache miss'));
    src = ok(addStep(src, 'Redirect', res('db', 'api', 'target'), 'Cache miss'));
    src = ok(addStep(src, 'Redirect', res('api', 'v', '302')));
    expect(src.slice(src.indexOf('usecase'))).toBe(
      [
        'usecase "Redirect" {',
        '  v -> api : GET /x',
        '  api -> cache : GET x',
        '  alt "Cache hit" {',
        '    cache --> api : target',
        '  }',
        '  alt "Cache miss" {',
        '    cache --> api : nil',
        '    api -> db : GetItem',
        '    db --> api : target',
        '  }',
        '  api --> v : 302',
        '}',
        '',
      ].join('\n'),
    );
    const { diagram, diagnostics } = parse(src);
    expect(diagnostics).toEqual([]);
    expect(diagram.useCases[0].scenarios.map((s) => s.name)).toEqual(['Cache hit', 'Cache miss']);
    const outline = useCaseOutline(src, 'Redirect')!;
    expect(outline.items.map((i) => i.kind)).toEqual(['step', 'step', 'scenarios', 'step']);
    const group = outline.items[2];
    expect(group.kind === 'scenarios' && group.branches.map((b) => [b.name, b.steps.length])).toEqual([
      ['Cache hit', 1],
      ['Cache miss', 3],
    ]);
  });

  it('reads scenarios written on one line with the close, nested blocks and multi-line payloads', () => {
    const src = [
      'usecase "U" {',
      '  a -> b : POST {',
      '    "x": 1',
      '  }',
      '  alt "One" when "it is" {',
      '    b --> a : 200',
      '  } alt "Two" {',
      '    alt "Deep" {',
      '      b --> a : 500',
      '    }',
      '  }',
      '  par {',
      '    a ->> c : log',
      '  }',
      '}',
    ].join('\n');
    const outline = useCaseOutline(src, 'U')!;
    expect(outline.endLine).toBe(15);
    expect(outline.items.map((i) => i.kind)).toEqual(['step', 'scenarios', 'other']);
    const group = outline.items[1];
    if (group.kind !== 'scenarios') throw new Error('scenarios');
    expect(group.branches.map((b) => ({ name: b.name, shared: b.shared, steps: b.steps.length, other: b.other, line: b.line, endLine: b.endLine }))).toEqual([
      { name: 'One', shared: false, steps: 1, other: 0, line: 5, endLine: 7 },
      { name: 'Two', shared: true, steps: 0, other: 1, line: 7, endLine: 11 },
    ]);
    // Removing the first keeps the second's opening.
    const removed = ok(removeScenario(src, 'U', 'One'));
    expect(removed).toContain('  a -> b : POST {\n    "x": 1\n  }\n  alt "Two" {\n    alt "Deep"');
    expect(parse(removed).diagram.useCases[0].scenarios.map((s) => s.name)).toEqual(['Two › Deep']);
    expect(removeScenario(src, 'U', 'Two').error).toMatch(/remove it in the code/);
    // A multi-line step goes as a whole.
    expect(removeStep(src, 2)).not.toContain('"x": 1');
  });

  it('removes a scenario, a step and a use case', () => {
    let src = addUseCase('a\nb\na -> b\n', 'U');
    src = ok(addScenario(src, 'U', 'S'));
    src = ok(addStep(src, 'U', req('a', 'b', 'go'), 'S'));
    expect(ok(removeScenario(src, 'U', 'S'))).toBe('a\nb\na -> b\n\nusecase "U" {\n}\n');
    src = ok(addStep(src, 'U', res('b', 'a', 'ok')));
    const line = src.split('\n').findIndex((l) => l.includes('b --> a')) + 1;
    expect(removeStep(src, line)).not.toContain('b --> a');
    expect(removeUseCase(src, 'U')).toBe('a\nb\na -> b\n');
  });
});

/** Builds a design with the canvas's edits alone, as the interview room's whiteboard does. */
describe('a practice problem solved with the visual edits alone', () => {
  it('hello-proschi', () => {
    const problem = findProblem('hello-proschi')!;
    let src = 'import "problem.proschi"\n';
    src = addNode(src, { id: 'api', name: 'Greeting API', tech: 'REST API' }).source;
    src = addNode(src, { id: 'db', name: 'Greetings DB', tech: 'PostgreSQL' }).source;
    src = setReplicas(setReplicas(src, 'api', 2), 'db', 2);
    src = addUseCase(src, 'Say hello');
    src = ok(addStep(src, 'Say hello', req('user', 'api', 'GET /hello')));
    src = ok(addStep(src, 'Say hello', req('api', 'db', 'SELECT greeting')));
    src = ok(addStep(src, 'Say hello', res('db', 'api', 'Hello')));
    src = ok(addStep(src, 'Say hello', res('api', 'user', '200 Hello')));
    const run = runTests(parseSolution(problem, src), defaultEngine);
    expect(run.results.filter((r) => !r.passed).map((r) => r.name)).toEqual([]);
    expect(run.solved).toBe(true);
  });

  it('url-shortener, with its scenarios', () => {
    const problem = findProblem('url-shortener')!;
    let src = 'import "problem.proschi"\n';
    for (const [id, name, tech, n] of [
      ['lb', 'Load Balancer', 'AWS Load Balancer', 2],
      ['api', 'Shortener API', 'REST API', 12],
      ['cache', 'Code Cache', 'Redis', 2],
      ['db', 'Links DB', 'DynamoDB', 2],
    ] as const) {
      src = setReplicas(addNode(src, { id, name, tech }).source, id, n);
    }
    src = addConnection(src, 'visitor', 'lb');
    src = addUseCase(src, 'Shorten');
    for (const s of [req('visitor', 'lb', 'POST /links'), req('lb', 'api', 'POST /links'), req('api', 'db', 'INSERT Url'), res('db', 'api', 'ok'), res('api', 'lb', '201'), res('lb', 'visitor', '201')]) {
      src = ok(addStep(src, 'Shorten', s));
    }
    src = addUseCase(src, 'Redirect');
    for (const s of [req('visitor', 'lb', 'GET /aZ3x9'), req('lb', 'api', 'GET /aZ3x9'), req('api', 'cache', 'GET code')]) src = ok(addStep(src, 'Redirect', s));
    src = ok(addScenario(src, 'Redirect', 'Cache hit'));
    src = ok(addScenario(src, 'Redirect', 'Cache miss'));
    src = ok(addStep(src, 'Redirect', res('cache', 'api', 'target'), 'Cache hit'));
    for (const s of [res('cache', 'api', 'nil'), req('api', 'db', 'GetItem Url'), res('db', 'api', 'target')]) src = ok(addStep(src, 'Redirect', s, 'Cache miss'));
    src = ok(addStep(src, 'Redirect', { from: 'api', to: 'cache', kind: 'async', label: 'SET code' }, 'Cache miss'));
    src = ok(addStep(src, 'Redirect', res('api', 'lb', '302 Location')));
    src = ok(addStep(src, 'Redirect', res('lb', 'visitor', '302 Location')));
    const parsed = parseSolution(problem, src);
    expect(parsed.diagnostics.filter((d) => d.file === undefined)).toEqual([]);
    const run = runTests(parsed, defaultEngine);
    expect(run.results.filter((r) => !r.passed).map((r) => `${r.name}: ${r.message}`)).toEqual([]);
    expect(run.solved).toBe(true);
  });
});
