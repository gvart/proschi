import { describe, expect, it } from 'vitest';
import { addConnection, addNode, addScenario, addStep, addUseCase, giveOperations, moveStep, removeScenario, removeStep, removeUseCase, renameScenario, renameUseCase, setReplicas, setStep, outlineOf, type EditResult, type NewStep, type OutlineStep } from './edit';
import { problems } from '../practice/catalog';
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

  it("labels the connection a step needs with its target's protocol", () => {
    const src = ok(addStep(addUseCase('api [REST API]\ndb [PostgreSQL]\n', 'U'), 'U', req('api', 'db', 'SELECT orders')));
    expect(src).toContain('api -> db : SQL\n');
    expect(parse(src).diagnostics).toEqual([]);
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
    const outline = outlineOf(src, 'Redirect')!;
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
    const outline = outlineOf(src, 'U')!;
    expect(outline.endLine).toBe(15);
    expect(outline.items.map((i) => i.kind)).toEqual(['step', 'scenarios', 'parallel']);
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

  it('snowflake-ids from its starter, as the e2e test of the interview room does', () => {
    const problem = findProblem('snowflake-ids')!;
    let src = setReplicas(problem.starter, 'idgen', 15);
    src = addUseCase(src, 'Start generator');
    src = ok(addStep(src, 'Start generator', req('idgen', 'zk', 'CREATE worker id')));
    src = ok(addStep(src, 'Start generator', res('zk', 'idgen', 'worker id')));
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
    for (const s of [req('visitor', 'lb', 'POST /links'), req('lb', 'api', 'POST /links'), req('api', 'db', 'PutItem Url'), res('db', 'api', 'ok'), res('api', 'lb', '201'), res('lb', 'visitor', '201')]) {
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

describe('editing, moving and inserting steps', () => {
  const src = [
    'web [Browser]',
    'api [REST API]',
    'db [PostgreSQL]',
    'web -> api : HTTP',
    'api -> db : SQL',
    '',
    'traffic {',
    '  "Order" 10 rps mix "Hit" 90%, "Miss" 10%',
    '}',
    '',
    'usecase "Order" {',
    '  web -> api : POST /orders',
    '  par {',
    '    api -> db : INSERT order',
    '    api ->> db : NOTIFY order',
    '  }',
    '  alt "Hit" {',
    '    db --> api : 1 row',
    '  } alt "Miss" {',
    '    api -x db : SELECT order',
    '  }',
    '  api --> web : 201',
    '}',
    '',
  ].join('\n');
  const steps = (text: string) =>
    outlineOf(text, 'Order')!.items.flatMap((i) => (i.kind === 'step' ? [i.step] : i.kind === 'parallel' ? i.block.steps : i.kind === 'scenarios' ? i.branches.flatMap((b) => b.steps) : []));

  it('reads par blocks and failed calls into the outline', () => {
    const items = outlineOf(src, 'Order')!.items;
    expect(items.map((i) => i.kind)).toEqual(['step', 'parallel', 'scenarios', 'step']);
    const par = items[1].kind === 'parallel' ? items[1].block : undefined;
    expect(par).toMatchObject({ line: 13, endLine: 16, other: 0 });
    expect(par!.steps.map((s) => s.label)).toEqual(['INSERT order', 'NOTIFY order']);
    expect(steps(src).find((s) => s.kind === 'failed')).toMatchObject({ from: 'api', to: 'db', label: 'SELECT order' });
  });

  it('replaces a step in place, keeping its indent and every other line', () => {
    const next = ok(setStep(src, 14, { from: 'api', to: 'db', kind: 'request', label: 'UPDATE order' }));
    expect(next).toBe(src.replace('    api -> db : INSERT order', '    api -> db : UPDATE order'));
    expect(ok(setStep(src, 20, { from: 'api', to: 'db', kind: 'failed', label: 'SELECT order' }))).toBe(src);
    expect(setStep(src, 1, req('web', 'api')).error).toMatch(/no step/);
  });

  it('replaces a multi-line payload with one line', () => {
    const multi = 'a\nb\na -> b\nusecase "U" {\n  a -> b : POST {\n    "x": 1\n  }\n  b --> a : 200\n}\n';
    expect(ok(setStep(multi, 5, req('a', 'b', 'GET /x')))).toBe('a\nb\na -> b\nusecase "U" {\n  a -> b : GET /x\n  b --> a : 200\n}\n');
  });

  it('moves a step among its siblings: past whole blocks in the main flow, within its block otherwise', () => {
    const down = ok(moveStep(src, 12, 'down'));
    expect(steps(down).map((s) => s.label)).toEqual(['INSERT order', 'NOTIFY order', 'POST /orders', '1 row', 'SELECT order', '201']);
    expect(ok(moveStep(down, 16, 'up'))).toBe(src);
    expect(steps(ok(moveStep(src, 15, 'up'))).map((s) => s.label).slice(1, 3)).toEqual(['NOTIFY order', 'INSERT order']);
    // The first and last of a block stay.
    expect(ok(moveStep(src, 14, 'up'))).toBe(src);
    expect(ok(moveStep(src, 22, 'down'))).toBe(src);
  });

  it('inserts a step before another, in its block', () => {
    const next = ok(addStep(src, 'Order', { from: 'api', to: 'db', kind: 'request', label: 'BEGIN' }, undefined, 14));
    expect(next).toBe(src.replace('    api -> db : INSERT order', '    api -> db : BEGIN\n    api -> db : INSERT order'));
    expect(addStep(src, 'Order', req('api', 'db'), undefined, 3).error).toMatch(/no step/);
  });

  it('renames a use case and its traffic, and a scenario and its share of the mix', () => {
    const renamed = ok(renameUseCase(src, 'Order', 'Place order'));
    expect(renamed).toContain('usecase "Place order" {');
    expect(renamed).toContain('  "Place order" 10 rps mix');
    expect(parse(renamed).diagnostics).toEqual(parse(src).diagnostics);
    expect(renameUseCase(src, 'Nope', 'X').error).toMatch(/no use case/);
    const scenario = ok(renameScenario(src, 'Order', 'Miss', 'Cache miss'));
    expect(scenario).toContain('} alt "Cache miss" {');
    expect(scenario).toContain('mix "Hit" 90%, "Cache miss" 10%');
    expect(renameScenario(src, 'Order', 'Miss', 'Hit').error).toMatch(/already has/);
  });

  it('leaves every other line of the practice solutions byte for byte', () => {
    for (const p of problems) {
      const useCase = parse(p.solution).diagram.useCases.find((u) => u.loc.file === undefined);
      if (!useCase) continue;
      const lines = p.solution.split('\n');
      const all: OutlineStep[] = outlineOf(p.solution, useCase.name)!.items.flatMap((i) => (i.kind === 'step' ? [i.step] : i.kind === 'parallel' ? i.block.steps : i.kind === 'scenarios' ? i.branches.flatMap((b) => b.steps) : []));
      for (const s of all.slice(0, 3)) {
        // Down and back up is the text it was.
        const down = moveStep(p.solution, s.line, 'down');
        if (down.source !== undefined && down.source !== p.solution) {
          const moved = outlineOf(down.source, useCase.name)!.items.flatMap((i) => (i.kind === 'step' ? [i.step] : i.kind === 'parallel' ? i.block.steps : i.kind === 'scenarios' ? i.branches.flatMap((b) => b.steps) : []));
          const now = moved.find((m) => m.label === s.label && m.from === s.from && m.to === s.to && m.kind === s.kind);
          expect(now, `${p.id}: ${s.label}`).toBeDefined();
          expect(ok(moveStep(down.source, now!.line, 'up')), `${p.id}: ${s.label}`).toBe(p.solution);
        }
        // Replacing a one-line step touches only its line.
        if (lines[s.line - 1].includes('{') || s.from.includes('.') || s.to.includes('.')) continue;
        const next = ok(setStep(p.solution, s.line, { from: s.from, to: s.to, kind: s.kind, label: 'X' })).split('\n');
        // Parsed alone, a solution can't see the connections its problem gives, so the step's own may be added.
        const added = new RegExp(`^${s.from} -> ${s.to}( : .*)?$`);
        const kept = next.filter((l) => !added.test(l) || lines.includes(l));
        expect(kept[s.line - 1], p.id).toMatch(/ : X$/);
        expect(kept.filter((_, i) => i !== s.line - 1), `${p.id}: ${s.label}`).toEqual(lines.filter((_, i) => i !== s.line - 1));
      }
    }
  });
});

describe('giving a component operations', () => {
  it('declares a type with the operations after the title, and the component takes it', () => {
    const src = 'title "Shop"\n\npay "Payments" [Service]\napi [REST API]\napi -> pay\n';
    const next = ok(giveOperations(src, 'pay', 'Payments', 'Service', [{ name: 'charge', access: 'write' }, { name: 'status', access: 'read' }, { name: 'charge', access: 'write' }]));
    expect(next).toBe('title "Shop"\n\ntype Payments extends Service {\n  op write charge\n  op read status\n}\n\npay "Payments" [Payments]\napi [REST API]\napi -> pay\n');
    const { diagram, diagnostics } = parse(`${next}usecase "U" {\n  api -> pay : charge card\n}\n`);
    expect(diagnostics).toEqual([]);
    expect(diagram.useCases[0].steps[0].op?.name).toBe('charge');
    expect(giveOperations(next, 'pay', 'payments', 'Service', []).error).toMatch(/already/);
  });
});
