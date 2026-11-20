import { describe, expect, it } from 'vitest';
import { addParallelStep, addStep, groupParallel, moveStep, outlineOf, setStep, ungroupParallel, type EditResult, type NewStep, type OutlineBranch, type OutlineParallel, type OutlineStep } from './edit';
import { format } from './format';
import { parse } from './parser';
import { problems } from '../practice/catalog';

/** The source of an edit that must succeed. */
const ok = (r: EditResult): string => {
  if (r.error !== undefined) throw new Error(r.error);
  return r.source;
};

const req = (from: string, to: string, label?: string): NewStep => ({ from, to, kind: 'request', label });

/** Diagnostics without their places, which an edit moves. */
const problemsOf = (text: string) => parse(text).diagnostics.map((d) => `${d.severity}: ${d.message}`);

/** A payload's text, without the indentation of its lines, which grouping changes as the formatter does. */
const flat = (body: string | undefined) => body?.replace(/\n\s*/g, '\n') ?? null;

/** The steps of every parsed flow, without where they are written or how they are grouped. */
const flows = (text: string) =>
  parse(text).diagram.useCases.flatMap((u) =>
    [u.steps, ...u.scenarios.map((s) => s.steps)].map((steps) => steps.map((s) => [s.fromServiceId, s.toServiceId, s.stepName, s.endpoint, s.statusCode, s.failed ?? false, flat(s.requestBody), flat(s.responseBody)])),
  );

const parallels = (text: string, useCase: string): OutlineParallel[] =>
  outlineOf(text, useCase)!.items.flatMap((i) => (i.kind === 'parallel' ? [i.block] : i.kind === 'scenarios' ? i.branches.flatMap((b) => b.items.flatMap((x) => (x.kind === 'parallel' ? [x.block] : []))) : []));

const branch = (text: string, useCase: string, name: string): OutlineBranch =>
  outlineOf(text, useCase)!.items.flatMap((i) => (i.kind === 'scenarios' ? i.branches : [])).find((b) => b.name === name)!;

const labels = (steps: OutlineStep[]) => steps.map((s) => s.label);

const src = [
  'web',
  'api',
  'db',
  'cache',
  'mail',
  'web -> api',
  'api -> db',
  'api -> cache',
  'api -> mail',
  '',
  'usecase "Order" {',
  '  web -> api : POST /orders',
  '  api -> db : INSERT order',
  '  # the receipt goes out at once',
  '  api ->> mail : SEND receipt',
  '  api -> cache : SET order',
  '  alt "Hit" {',
  '    api -> cache : GET order',
  '    api -> db : SELECT order',
  '    cache --> api : order',
  '  } alt "Miss" {',
  '    api -x cache : GET order',
  '  }',
  '  api --> web : 201',
  '}',
  '',
].join('\n');

describe('grouping steps to run at the same time', () => {
  it('wraps consecutive steps of the main flow in a par block, comments between them too', () => {
    const grouped = ok(groupParallel(src, [15, 13]));
    expect(grouped).toBe(src.replace('  api -> db : INSERT order\n  # the receipt goes out at once\n  api ->> mail : SEND receipt\n', '  par {\n    api -> db : INSERT order\n    # the receipt goes out at once\n    api ->> mail : SEND receipt\n  }\n'));
    expect(problemsOf(grouped)).toEqual(problemsOf(src));
    expect(flows(grouped)).toEqual(flows(src));
    const main = parse(grouped).diagram.useCases[0].steps;
    expect(main.filter((s) => s.isParallel).map((s) => s.stepName)).toEqual(['INSERT order', 'SEND receipt']);
    const items = outlineOf(grouped, 'Order')!.items;
    expect(items.map((i) => i.kind)).toEqual(['step', 'parallel', 'step', 'scenarios', 'step']);
    expect(parallels(grouped, 'Order')).toEqual([
      {
        line: 13,
        endLine: 17,
        other: 0,
        steps: [
          { line: 14, from: 'api', to: 'db', kind: 'request', label: 'INSERT order' },
          { line: 16, from: 'api', to: 'mail', kind: 'async', label: 'SEND receipt' },
        ],
      },
    ]);
  });

  it('indents the block as the formatter does', () => {
    // Only the indentation: the formatter also lines up the columns of neighbouring steps, which no edit redoes.
    const indents = (text: string) => text.split('\n').map((l) => /^\s*/.exec(l)![0]);
    const formatted = format(src);
    for (const lines of [
      [13, 15],
      [18, 19, 20],
    ]) {
      const grouped = ok(groupParallel(formatted, lines));
      expect(indents(format(grouped))).toEqual(indents(grouped));
    }
  });

  it('groups the steps of a scenario, responses and failed calls too, and reads the block into the scenario', () => {
    const grouped = ok(groupParallel(src, [18, 19, 20]));
    expect(grouped).toBe(src.replace('    api -> cache : GET order\n    api -> db : SELECT order\n    cache --> api : order\n', '    par {\n      api -> cache : GET order\n      api -> db : SELECT order\n      cache --> api : order\n    }\n'));
    expect(problemsOf(grouped)).toEqual(problemsOf(src));
    expect(flows(grouped)).toEqual(flows(src));
    const hit = parse(grouped).diagram.useCases[0].scenarios.find((s) => s.name === 'Hit')!;
    expect(hit.steps.filter((s) => s.isParallel).map((s) => s.stepName)).toEqual(['GET order', 'SELECT order']);
    const b = branch(grouped, 'Order', 'Hit');
    expect(b.items.map((i) => i.kind)).toEqual(['parallel']);
    expect(b).toMatchObject({ steps: [], other: 1, line: 17, endLine: 23 });
    expect(labels(parallels(grouped, 'Order')[0].steps)).toEqual(['GET order', 'SELECT order', 'order']);

    // A failed call, alone in its scenario, can't be grouped; a second step can be added and then it can.
    expect(groupParallel(src, [22]).error).toMatch(/at least two/);
    const miss = ok(addStep(src, 'Order', req('api', 'db', 'SELECT order'), 'Miss'));
    const both = ok(groupParallel(miss, [22, 23]));
    expect(both).toContain('  } alt "Miss" {\n    par {\n      api -x cache : GET order\n      api -> db : SELECT order\n    }\n  }');
    expect(problemsOf(both)).toEqual(problemsOf(miss));
  });

  it('moves a step with a payload over several lines as a whole', () => {
    const multi = ['a', 'b', 'c', 'a -> b', 'a -> c', 'usecase "U" {', '  a -> b : POST {', '    "x": 1,', '    "y": [1, 2]', '  }', '  a -> c : POST {', '    "z": 2', '  }', '  b --> a : 200', '}', ''].join('\n');
    const grouped = ok(groupParallel(multi, [7, 11]));
    expect(grouped).toBe(['a', 'b', 'c', 'a -> b', 'a -> c', 'usecase "U" {', '  par {', '    a -> b : POST {', '      "x": 1,', '      "y": [1, 2]', '    }', '    a -> c : POST {', '      "z": 2', '    }', '  }', '  b --> a : 200', '}', ''].join('\n'));
    expect(problemsOf(grouped)).toEqual(problemsOf(multi));
    expect(flows(grouped)).toEqual(flows(multi));
    expect(parse(grouped).diagram.useCases[0].steps.filter((s) => s.isParallel)).toHaveLength(2);
    expect(parallels(grouped, 'U')[0]).toMatchObject({ line: 7, endLine: 15, steps: [{ line: 8 }, { line: 12 }] });
    expect(format(grouped)).toBe(grouped);
    expect(ok(ungroupParallel(grouped, 7))).toBe(multi);
    // A payload step followed right away by the next one.
    expect(groupParallel(multi, [11, 14]).error).toBeUndefined();
  });

  it("keeps a file's own indentation", () => {
    const four = 'a\nb\nusecase "U" {\n    a -> b : one\n    a -> b : two\n    alt "B" {\n        a -> b : three\n        a -> b : four\n    }\n}\n';
    const grouped = ok(groupParallel(four, [4, 5]));
    expect(grouped).toBe('a\nb\nusecase "U" {\n    par {\n        a -> b : one\n        a -> b : two\n    }\n    alt "B" {\n        a -> b : three\n        a -> b : four\n    }\n}\n');
    expect(ok(ungroupParallel(grouped, 4))).toBe(four);
    const inBranch = ok(groupParallel(four, [7, 8]));
    expect(inBranch).toContain('    alt "B" {\n        par {\n            a -> b : three\n            a -> b : four\n        }\n    }');
    expect(ok(ungroupParallel(inBranch, 7))).toBe(four);
    const tabs = 'a\nb\nusecase "U" {\n\ta -> b : one\n\ta -> b : two\n}\n';
    const tabbed = ok(groupParallel(tabs, [4, 5]));
    expect(tabbed).toBe('a\nb\nusecase "U" {\n\tpar {\n\t\ta -> b : one\n\t\ta -> b : two\n\t}\n}\n');
    expect(ok(ungroupParallel(tabbed, 4))).toBe(tabs);
  });

  it('refuses fewer than two steps', () => {
    expect(groupParallel(src, []).error).toBe('Choose at least two steps to run at the same time.');
    expect(groupParallel(src, [13]).error).toBe('Choose at least two steps to run at the same time.');
    expect(groupParallel(src, [13, 13]).error).toBe('Choose at least two steps to run at the same time.');
  });

  it('refuses a line that is not a step', () => {
    expect(groupParallel(src, [1, 13]).error).toBe('There is no step on line 1.');
    expect(groupParallel(src, [13, 14]).error).toBe('There is no step on line 14.');
    expect(groupParallel(src, [13, 17]).error).toBe('There is no step on line 17.');
  });

  it('refuses steps that are not next to each other', () => {
    const notNext = 'Only steps that follow each other can run at the same time.';
    expect(groupParallel(src, [12, 15]).error).toBe(notNext);
    // A scenarios group between them.
    expect(groupParallel(src, [16, 24]).error).toBe(notNext);
    // A par block between them.
    const withPar = ok(groupParallel(src, [13, 15]));
    expect(groupParallel(withPar, [12, 18]).error).toBe(notNext);
    // Within a scenario too.
    expect(groupParallel(src, [18, 20]).error).toBe(notNext);
  });

  it('refuses steps of different blocks', () => {
    const apart = 'Only steps of the same flow or scenario can run at the same time.';
    // Two scenarios, written one after the other.
    expect(groupParallel(src, [20, 22]).error).toBe(apart);
    // A scenario and the main flow.
    expect(groupParallel(src, [16, 18]).error).toBe(apart);
    expect(groupParallel(src, [22, 24]).error).toBe(apart);
    // Two use cases.
    const two = `${src}\nusecase "Other" {\n  web -> api : GET /orders\n}\n`;
    expect(groupParallel(two, [24, 28]).error).toBe(apart);
    expect(groupParallel(two, [28, 24]).error).toBe(apart);
  });

  it('refuses a step that is already in a par block', () => {
    const withPar = ok(groupParallel(src, [13, 15]));
    const already = 'A step you chose already runs at the same time as others; ungroup that block first.';
    expect(groupParallel(withPar, [14, 16]).error).toBe(already);
    expect(groupParallel(withPar, [16, 18]).error).toBe(already);
    expect(groupParallel(withPar, [12, 14]).error).toBe(already);
  });
});

describe('ungrouping a par block', () => {
  it('round-trips grouping in the main flow and in a scenario, byte for byte', () => {
    const main = ok(groupParallel(src, [12, 13, 15, 16]));
    expect(ok(ungroupParallel(main, 12))).toBe(src);
    const scenario = ok(groupParallel(src, [19, 20]));
    expect(ok(ungroupParallel(scenario, 19))).toBe(src);
    expect(outlineOf(ok(ungroupParallel(scenario, 19)), 'Order')).toEqual(outlineOf(src, 'Order'));
  });

  it('dedents a hand-written block, keeping blank lines', () => {
    const hand = 'a\nb\nusecase "U" {\n  par {\n    a -> b : one\n\n    a ->> b : two\n  }\n  par {\n  }\n}\n';
    const flat = ok(ungroupParallel(hand, 4));
    expect(flat).toBe('a\nb\nusecase "U" {\n  a -> b : one\n\n  a ->> b : two\n  par {\n  }\n}\n');
    expect(parse(flat).diagram.useCases[0].steps.every((s) => !s.isParallel)).toBe(true);
    expect(outlineOf(flat, 'U')!.items.map((i) => i.kind)).toEqual(['step', 'step', 'parallel']);
    // An empty block goes entirely.
    expect(ok(ungroupParallel(flat, 7))).toBe('a\nb\nusecase "U" {\n  a -> b : one\n\n  a ->> b : two\n}\n');
  });

  it('refuses a line with no par block, and a block that closes on a line with more code', () => {
    const none = 'There are no steps that run at the same time on that line.';
    expect(ungroupParallel(src, 12).error).toBe(none);
    expect(ungroupParallel(src, 1).error).toBe(none);
    const shared = 'a\nb\nusecase "U" {\n  par {\n    a -> b : one\n  } alt "B" {\n    a -> b : two\n  }\n}\n';
    expect(ungroupParallel(shared, 4).error).toMatch(/ungroup it in the code/);
  });
});

describe('adding a step alongside the ones in a par block', () => {
  it('appends it at the end of the block, written and connected as addStep does', () => {
    const grouped = ok(groupParallel(src, [13, 15]));
    const added = ok(addParallelStep(grouped, 13, { from: 'api', to: 'web', kind: 'async', label: 'PUSH  progress' }));
    expect(added).toBe(grouped.replace('    api ->> mail : SEND receipt\n  }', '    api ->> mail : SEND receipt\n    api ->> web : PUSH  progress\n  }').replace('api -> mail\n', 'api -> mail\napi -> web\n'));
    expect(labels(parallels(added, 'Order')[0].steps)).toEqual(['INSERT order', 'SEND receipt', 'PUSH  progress']);
    expect(parse(added).diagnostics).toEqual([]);
    // A response needs no connection.
    const response = ok(addParallelStep(grouped, 13, { from: 'db', to: 'api', kind: 'response', label: 'ok' }));
    expect(response.split('\n').length).toBe(grouped.split('\n').length + 1);
  });

  it("labels the connection with its target's protocol", () => {
    const typed = 'api [REST API]\ndb [PostgreSQL]\nq [AWS SQS]\napi -> q\nusecase "U" {\n  par {\n    api ->> q : PUBLISH\n  }\n}\n';
    expect(ok(addParallelStep(typed, 6, req('api', 'db', 'INSERT')))).toContain('api -> db : SQL\n');
  });

  it('adds to a par block in a scenario, and to an empty block', () => {
    const grouped = ok(groupParallel(src, [18, 19]));
    const added = ok(addParallelStep(grouped, 18, req('api', 'mail', 'SEND')));
    expect(added).toContain('    par {\n      api -> cache : GET order\n      api -> db : SELECT order\n      api -> mail : SEND\n    }\n');
    expect(labels(parallels(added, 'Order')[0].steps)).toEqual(['GET order', 'SELECT order', 'SEND']);
    expect(problemsOf(added)).toEqual(problemsOf(grouped));

    const empty = 'a\nb\na -> b\nusecase "U" {\n    alt "B" {\n        par {\n        }\n    }\n}\n';
    const filled = ok(addParallelStep(empty, 6, req('a', 'b', 'x')));
    expect(filled).toBe('a\nb\na -> b\nusecase "U" {\n    alt "B" {\n        par {\n            a -> b : x\n        }\n    }\n}\n');
    expect(parse(filled).diagram.useCases[0].scenarios[0].steps[0].isParallel).toBe(true);
  });

  it('refuses a line with no par block, and a step to itself', () => {
    expect(addParallelStep(src, 12, req('api', 'db')).error).toMatch(/no steps that run at the same time/);
    const grouped = ok(groupParallel(src, [13, 15]));
    expect(addParallelStep(grouped, 13, req('api', 'api')).error).toMatch(/one component to another/);
  });
});

describe('par blocks in scenarios, for the other step edits', () => {
  const grouped = ok(groupParallel(src, [18, 19]));

  it('replaces, inserts before and moves the steps in them', () => {
    expect(ok(setStep(grouped, 19, req('api', 'cache', 'MGET order')))).toBe(grouped.replace('      api -> cache : GET order', '      api -> cache : MGET order'));
    const before = ok(addStep(grouped, 'Order', req('api', 'db', 'BEGIN'), undefined, 20));
    expect(labels(parallels(before, 'Order')[0].steps)).toEqual(['GET order', 'BEGIN', 'SELECT order']);
    const moved = ok(moveStep(grouped, 20, 'up'));
    expect(labels(parallels(moved, 'Order')[0].steps)).toEqual(['SELECT order', 'GET order']);
    expect(ok(moveStep(moved, 19, 'down'))).toBe(grouped);
    // The last of its block stays.
    expect(ok(moveStep(grouped, 20, 'down'))).toBe(grouped);
  });

  it('keeps the order of steps and blocks in the scenario', () => {
    const b = branch(grouped, 'Order', 'Hit');
    expect(b.items.map((i) => (i.kind === 'step' ? i.step.label : `par ${labels(i.block.steps).join(', ')}`))).toEqual(['par GET order, SELECT order', 'order']);
    expect(labels(b.steps)).toEqual(['order']);
  });
});

describe('grouping the practice solutions', () => {
  it('groups two steps that follow each other in each, and ungroups them back byte for byte', () => {
    let grouped = 0;
    for (const p of problems) {
      const useCase = parse(p.solution).diagram.useCases.find((u) => u.loc.file === undefined);
      if (!useCase) continue;
      const outline = outlineOf(p.solution, useCase.name)!;
      const pair = outline.items.findIndex((item, i) => item.kind === 'step' && outline.items[i + 1]?.kind === 'step');
      if (pair === -1) continue;
      const [a, b] = [outline.items[pair], outline.items[pair + 1]].map((item) => (item.kind === 'step' ? item.step.line : 0));
      const result = groupParallel(p.solution, [a, b]);
      if (result.error !== undefined) {
        // Only comments or blank lines can't stand between them, so the refusal must be about something else in between.
        expect(result.error, p.id).toBe('Only steps that follow each other can run at the same time.');
        continue;
      }
      grouped++;
      expect(problemsOf(result.source), p.id).toEqual(problemsOf(p.solution));
      expect(flows(result.source), p.id).toEqual(flows(p.solution));
      expect(ok(ungroupParallel(result.source, a)), p.id).toBe(p.solution);
    }
    expect(grouped).toBeGreaterThan(10);
  });
});
