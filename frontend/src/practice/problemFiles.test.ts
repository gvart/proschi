import { describe, expect, it } from 'vitest';
import { defaultEngine } from '../hld/engine';
import { FrontMatterError, frontMatterString, isPlainSafe, parseFrontMatter } from './frontMatter';
import { catalogFromFiles, compareProblems, expectFailLines, problemFromFiles, ProblemFolderError } from './problemFiles';
import type { Problem } from './types';
import { validateProblem } from './validate';

describe('front matter', () => {
  it('reads strings, quoted strings, numbers and lists, then the body', () => {
    const { data, body } = parseFrontMatter(
      [
        '---',
        'title: URL Shortener',
        '# a comment',
        'summary: "Fast: cache-first # always"',
        "quote: 'It''s'",
        'order: 2',
        'ratio: -1.5',
        'tags: [caching, "read, heavy", \'x\']',
        'hints:',
        '  - First',
        '  - "Second: quoted"',
        '',
        '---',
        '',
        'Body **text**',
        '',
      ].join('\n'),
    );
    expect(data).toEqual({ title: 'URL Shortener', summary: 'Fast: cache-first # always', quote: "It's", order: 2, ratio: -1.5, tags: ['caching', 'read, heavy', 'x'], hints: ['First', 'Second: quoted'] });
    expect(body).toBe('Body **text**');
  });

  it.each([
    ['no opening line', 'title: x\n---\n', 1, /start with/],
    ['no closing line', '---\ntitle: x\n', 1, /closing/],
    ['a duplicate key', '---\na: x\na: y\n---\n', 3, /Duplicate key 'a'/],
    ['a plain value with ": "', '---\na: b: c\n---\n', 2, /Ambiguous.*double quotes/],
    ['a plain value with " #"', '---\na: b #c\n---\n', 2, /Ambiguous/],
    ['a boolean-looking value', '---\na: yes\n---\n', 2, /Ambiguous/],
    ['an indicator at the start', '---\na: `x`\n---\n', 2, /Ambiguous/],
    ['a bad escape', '---\na: "\\q"\n---\n', 2, /escape/],
    ['an unterminated string', '---\na: "x\n---\n', 2, /Unterminated/],
    ['an unclosed list', '---\na: [x, y\n---\n', 2, /close on the same line/],
    ['an empty list item', '---\na: [x, , y]\n---\n', 2, /Empty item/],
    ['a number in a list', '---\na:\n  - 3\n---\n', 3, /must be strings/],
    ['an item without a key', '---\n  - x\n---\n', 2, /must follow a key/],
    ['an indented key', '---\na: x\n  b: y\n---\n', 3, /indented/],
    ['a key without a value', '---\na:\nb: x\n---\n', 2, /'a' has no value/],
    ['a line that is not key: value', '---\njust text\n---\n', 2, /key: value/],
  ])('rejects %s', (_name, text, line, message) => {
    let error: unknown;
    try {
      parseFrontMatter(text);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(FrontMatterError);
    expect((error as FrontMatterError).line).toBe(line);
    expect((error as FrontMatterError).message).toMatch(message);
  });

  it('writes strings plain only when they read back the same', () => {
    for (const s of ['plain words', 'Fast: yes', 'a #b', '-x', '42', 'true', ' padded', '`code`', 'ends:', "it's"]) {
      expect(parseFrontMatter(`---\nv: ${frontMatterString(s)}\n---\n`).data.v).toBe(s);
    }
    expect(isPlainSafe('a, b')).toBe(true);
    expect(isPlainSafe('a, b', true)).toBe(false);
  });
});

const MD = `---
title: Echo
summary: Says it back.
difficulty: easy
tags: [basics]
hints:
  - Connect the client to the API.
---

Echo the request.

## Functional requirements

- **Echo**: the client calls the API.
`;
const GIVEN = `client "Client" [Actor]

traffic {
  "Echo" 10 rps
}

test "Echo goes through the API" {
  "Echo" calls api
}
`;
const SOLUTION = `import "problem.proschi"

api "API" [REST API] x2

client -> api

usecase "Echo" {
  client -> api    : GET /echo
  api   --> client : 200
}
`;
const STARTER = `import "problem.proschi"

usecase "Echo" {
  client -> client : think
}
`;
const files = (extra: Record<string, string> = {}): Record<string, string> => ({
  'problem.md': MD,
  'given.proschi': GIVEN,
  'starter.proschi': STARTER,
  'solution.proschi': SOLUTION,
  ...extra,
});

describe('problem folders', () => {
  it('build a Problem from plain files', () => {
    const p = problemFromFiles('echo', files({ 'wrong/no-api.proschi': `# expect-fail: Echo goes through the API\n# Talks to itself.\n${STARTER}` }));
    expect(p).toMatchObject({ id: 'echo', title: 'Echo', summary: 'Says it back.', difficulty: 'easy', tags: ['basics'], hints: ['Connect the client to the API.'], given: GIVEN, starter: STARTER, solution: SOLUTION });
    expect(p.statement).toBe(MD.slice(MD.indexOf('Echo the request.')).trimEnd());
    expect(p.order).toBeUndefined();
    expect(p.wrong).toEqual([{ name: 'no-api', source: expect.stringContaining('# expect-fail'), expectFail: ['Echo goes through the API'] }]);
  });

  it.each([
    ['a missing file', 'echo', files({ 'solution.proschi': undefined as unknown as string }), /problems\/echo: Missing solution\.proschi/],
    ['an unexpected file', 'echo', files({ 'solutoin.proschi': '' }), /problems\/echo: Unexpected file solutoin\.proschi/],
    ['a bad wrong file name', 'echo', files({ 'wrong/No Way.proschi': '' }), /Unexpected file wrong\/No Way\.proschi/],
    ['a bad folder name', 'Echo', files(), /problems\/Echo: The folder name/],
    ['bad front matter', 'echo', files({ 'problem.md': MD.replace('title: Echo', 'title: Echo: the problem') }), /problems\/echo: problem\.md:2: Ambiguous/],
    ['an unknown field', 'echo', files({ 'problem.md': MD.replace('title: Echo', 'title: Echo\nlevel: 3') }), /Unknown front matter field 'level'/],
    ['a bad difficulty', 'echo', files({ 'problem.md': MD.replace('difficulty: easy', 'difficulty: trivial') }), /'difficulty' must be one of easy, medium, hard/],
    ['a missing summary', 'echo', files({ 'problem.md': MD.replace('summary: Says it back.\n', '') }), /'summary' must be a non-empty string/],
    ['a string order', 'echo', files({ 'problem.md': MD.replace('tags:', 'order: first\ntags:') }), /'order' must be a number/],
    ['tags that are not a list', 'echo', files({ 'problem.md': MD.replace('tags: [basics]', 'tags: basics') }), /'tags' must be a list/],
    ['an empty statement', 'echo', files({ 'problem.md': MD.slice(0, MD.indexOf('---\n\n') + 4) }), /statement .* is empty/],
  ])('reject %s, naming the folder', (_name, id, folderFiles, message) => {
    const clean = Object.fromEntries(Object.entries(folderFiles).filter(([, v]) => v !== undefined));
    expect(() => problemFromFiles(id, clean)).toThrow(ProblemFolderError);
    expect(() => problemFromFiles(id, clean)).toThrow(message);
  });

  it('a catalog sorts by difficulty, order, then title, and keeps errors apart', () => {
    const md = (title: string, difficulty: string, order?: number) => MD.replace('title: Echo', `title: ${title}`).replace('difficulty: easy', `difficulty: ${difficulty}`).replace('tags:', order === undefined ? 'tags:' : `order: ${order}\ntags:`);
    const folder = (id: string, text: string) => Object.fromEntries(Object.entries(files({ 'problem.md': text })).map(([k, v]) => [`${id}/${k}`, v]));
    const catalog = catalogFromFiles({
      ...folder('c', md('Zed', 'easy')),
      ...folder('b', md('Alpha', 'easy')),
      ...folder('a', md('Hard one', 'hard')),
      ...folder('d', md('Late', 'easy', 1)),
      ...folder('e', md('Medium', 'medium')),
      'broken/problem.md': MD,
    });
    expect(catalog.problems.map((p) => p.id)).toEqual(['d', 'b', 'c', 'e', 'a']);
    expect(catalog.errors.map((e) => e.message)).toEqual(['problems/broken: Missing given.proschi']);
    expect(compareProblems(catalog.problems[0], catalog.problems[0])).toBe(0);
  });

  it('reads expect-fail lines from the leading comments only', () => {
    expect(expectFailLines('# expect-fail: A\n# note\n#expect-fail:  B \nimport "problem.proschi"\n# expect-fail: C\n')).toEqual(['A', 'B']);
  });
});

describe('validateProblem', () => {
  const valid = problemFromFiles('echo', files({ 'wrong/no-api.proschi': `# expect-fail: Echo goes through the API\n${STARTER}` }));
  const check = (p: Partial<Problem>) => validateProblem({ ...valid, ...p }, defaultEngine);
  const messages = (p: Partial<Problem>) => check(p).violations.map((v) => `${v.file}${v.line ? `:${v.line}` : ''}: ${v.message}`);

  it('passes a valid problem and reports what the wrong designs fail', () => {
    const report = check({});
    expect(report.violations).toEqual([]);
    expect(report.tests).toBe(1);
    expect(report.starterFails).toEqual(['Echo goes through the API']);
    expect(report.wrong).toEqual([{ name: 'no-api', file: 'wrong/no-api.proschi', expectFail: ['Echo goes through the API'], failed: ['Echo goes through the API'], missing: [], alsoFails: [] }]);
  });

  it('reports statement and use case mismatches', () => {
    expect(messages({ statement: 'Nothing here.' })).toEqual(['problem.md: The statement needs a "## Functional requirements" section', 'problem.md: The statement must name the use case **Echo** in bold']);
    expect(messages({ solution: SOLUTION.replace('usecase "Echo"', 'usecase "Ping"') })).toContain('solution.proschi: The solution must define usecase "Echo" from the traffic');
  });

  it('reports a given with errors, imports or non-canonical format', () => {
    expect(messages({ given: `import "x.proschi"\n${GIVEN}` })).toEqual(expect.arrayContaining(['given.proschi:1: The given must not import anything']));
    expect(messages({ given: GIVEN.replace('client "Client" [Actor]', 'client   "Client"   [Actor]') })).toEqual(['given.proschi: Not in canonical format; run proschi fmt']);
    expect(messages({ given: `${GIVEN}a [X]\na [Y]\n` }).some((m) => /^given\.proschi:\d+: error:/.test(m))).toBe(true);
  });

  it('reports a solution with diagnostics, bad format, a missing import or failing tests', () => {
    expect(messages({ solution: SOLUTION.replace('api "API" [REST API] x2', 'api "API" [REST API] x2\napi "Other" [Redis]') })).toEqual(expect.arrayContaining([expect.stringMatching(/^solution\.proschi:\d+: (warning|error): /)]));
    expect(messages({ solution: SOLUTION.replace('client -> api\n', 'client  ->  api\n') })).toEqual(['solution.proschi: Not in canonical format; run proschi fmt']);
    expect(messages({ solution: SOLUTION.replace('import "problem.proschi"\n', '') })).toEqual(expect.arrayContaining(['solution.proschi:1: Must start with import "problem.proschi"']));
    expect(messages({ solution: STARTER })).toEqual(expect.arrayContaining([expect.stringMatching(/^solution\.proschi(:\d+)?: Fails "Echo goes through the API"/)]));
  });

  it('reports capacity in the solution', () => {
    expect(messages({ solution: `${SOLUTION}\ncapacity {\n  api 1m rps\n}\n` })).toEqual([expect.stringMatching(/^solution\.proschi:13: error: capacity is set by the problem; change the design \(replicas, shards, caching\) instead/)]);
  });

  it('reports a starter that already passes, or has errors', () => {
    expect(messages({ starter: SOLUTION })).toEqual(['starter.proschi: The starter passes every test; it must leave something to solve']);
    expect(messages({ starter: `${STARTER}a [X]\na [Y]\n` })).toEqual(expect.arrayContaining([expect.stringMatching(/^starter\.proschi:\d+: error:/)]));
  });

  it('reports wrong designs that pass what they name, name no test, lack the header or have errors', () => {
    const wrong = (source: string, expectFail = expectFailLines(source)) => messages({ wrong: [{ name: 'w', source, expectFail }] });
    expect(wrong(`# expect-fail: Echo goes through the API\n${SOLUTION}`)).toEqual(['wrong/w.proschi:1: Expected to fail "Echo goes through the API", but it passes']);
    expect(wrong(`# expect-fail: Echo is fast\n${STARTER}`)).toEqual(['wrong/w.proschi:1: No test or requirement is named "Echo is fast" (names: "Echo goes through the API")']);
    expect(wrong(STARTER)).toEqual(['wrong/w.proschi:1: Start the file with one or more "# expect-fail: <test name>" lines']);
    expect(wrong(`# expect-fail: Echo goes through the API\n\n${STARTER}`)).toEqual(['wrong/w.proschi:2: After the comment lines the file must start with import "problem.proschi"']);
    expect(wrong(`# expect-fail: Echo goes through the API\n${STARTER}capacity {\n  client 1 rps\n}\n`)).toEqual([expect.stringMatching(/^wrong\/w\.proschi:\d+: error: capacity is set by the problem/)]);
  });
});
