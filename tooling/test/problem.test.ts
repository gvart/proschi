import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../src/cli';
import { format } from '../src/proschi';
import { findProblemsDir, runProblem } from '../src/problem';
import { problemTemplate } from '../src/problemTemplate';

function capture(args: string[], cwd?: string) {
  const out: string[] = [];
  const err: string[] = [];
  const code = cwd ? runProblem(args, (s) => out.push(s), (s) => err.push(s), cwd) : run(['problem', ...args], (s) => out.push(s), (s) => err.push(s));
  return { code, out: out.join('\n'), err: err.join('\n') };
}

const root = mkdtempSync(join(tmpdir(), 'proschi-problem-'));
const repoProblems = resolve(__dirname, '../../frontend/src/practice/problems');

/** A fresh problems dir holding one scaffolded problem `echo`, with `edit` applied to its files. */
function problemsWith(edit: (folder: string) => void = () => {}): string {
  const dir = mkdtempSync(join(root, 'problems-'));
  expect(capture(['new', 'echo', '--dir', dir]).code).toBe(0);
  edit(join(dir, 'echo'));
  return dir;
}
const rewrite = (file: string, f: (s: string) => string) => writeFileSync(file, f(readFileSync(file, 'utf8')));

describe('proschi problem new', () => {
  it('scaffolds a folder that already passes problem check, and prints next steps', () => {
    const dir = mkdtempSync(join(root, 'new-'));
    const r = capture(['new', 'cache-me', '--dir', dir]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('problem.md\n  given.proschi\n  starter.proschi\n  solution.proschi\n  wrong/database-only.proschi');
    expect(r.out).toMatch(/1\. problem\.md[\s\S]*5\. Run: proschi problem check/);
    expect(readFileSync(join(dir, 'cache-me', 'problem.md'), 'utf8')).toMatch(/^---\ntitle: Cache Me\nsummary: TODO/);
    const check = capture(['check', dir]);
    expect(check.out).toContain('✓ cache-me: 5 tests, the starter fails');
    expect(check.out).toContain('wrong/database-only: fails "Items are read from the cache first"');
    expect(check.code).toBe(0);
  });

  it('writes canonical Proschi', () => {
    const files = problemTemplate('x');
    for (const name of ['given.proschi', 'starter.proschi', 'solution.proschi']) expect(format(files[name]), name).toBe(files[name]);
  });

  it('refuses a bad id, an existing folder and bad usage', () => {
    const dir = mkdtempSync(join(root, 'new-'));
    expect(capture(['new', 'Bad_Id', '--dir', dir]).code).toBe(2);
    expect(capture(['new', 'ok', '--dir', dir]).code).toBe(0);
    const again = capture(['new', 'ok', '--dir', dir]);
    expect(again.code).toBe(1);
    expect(again.err).toMatch(/already exists/);
    expect(capture(['new']).code).toBe(2);
    expect(capture(['new', 'a', 'b']).code).toBe(2);
    expect(capture(['new', 'a', '--dir']).code).toBe(2);
    expect(capture(['new', 'a', '--nope']).code).toBe(2);
  });

  it('defaults to the repository problems dir inside the repo, else ./problems', () => {
    expect(findProblemsDir(__dirname)).toBe(repoProblems);
    expect(findProblemsDir(root)).toBeUndefined();
    const cwd = mkdtempSync(join(root, 'cwd-'));
    expect(capture(['new', 'here'], cwd).code).toBe(0);
    expect(readFileSync(join(cwd, 'problems', 'here', 'given.proschi'), 'utf8')).toContain('traffic');
  });
});

describe('proschi problem check', () => {
  it('passes the repository problems', () => {
    const r = capture(['check', repoProblems]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^17 problems, \d+ wrong designs: no violations$/m);
    expect(capture(['check'], __dirname).out).toBe(r.out);
  });

  it.each([
    ['bad front matter', (f: string) => rewrite(join(f, 'problem.md'), (s) => s.replace('difficulty: easy', 'difficulty: easy: very')), /echo\/problem\.md:4: Ambiguous value/],
    ['an empty company', (f: string) => rewrite(join(f, 'problem.md'), (s) => s.replace('difficulty: easy', 'difficulty: easy\ncompany: ""')), /echo\/problem\.md: 'company' must be a non-empty string/],
    ['an unknown field', (f: string) => rewrite(join(f, 'problem.md'), (s) => s.replace('difficulty: easy', 'difficulty: easy\ncompanies: [Twitter]')), /echo\/problem\.md: Unknown front matter field 'companies'/],
    ['an unknown difficulty', (f: string) => rewrite(join(f, 'problem.md'), (s) => s.replace('difficulty: easy', 'difficulty: trivial')), /echo\/problem\.md: 'difficulty' must be one of/],
    ['a missing file', (f: string) => rmSync(join(f, 'starter.proschi')), /echo: Missing starter\.proschi/],
    ['an unexpected file', (f: string) => writeFileSync(join(f, 'notes.txt'), ''), /echo: Unexpected file notes\.txt/],
    ['a given with errors', (f: string) => rewrite(join(f, 'given.proschi'), (s) => `${s}x [Redis]\nx [Redis]\n`), /echo\/given\.proschi:\d+: error: Duplicate id 'x'/],
    ['a non-canonical given', (f: string) => rewrite(join(f, 'given.proschi'), (s) => s.replace('user "User" [Actor]', 'user  "User"  [Actor]')), /echo\/given\.proschi: Not in canonical format/],
    ['a solution with a warning', (f: string) => rewrite(join(f, 'solution.proschi'), (s) => s.replace('[PostgreSQL]', '[PostgreSQX]')), /echo\/solution\.proschi:6: warning: Unknown tech stack 'PostgreSQX'/],
    ['a non-canonical solution', (f: string) => rewrite(join(f, 'solution.proschi'), (s) => s.replace('user -> lb\n', 'user  ->  lb\n')), /echo\/solution\.proschi: Not in canonical format/],
    ['a failing solution', (f: string) => rewrite(join(f, 'given.proschi'), (s) => s.replace('cost <= 2000 usd/month', 'cost <= 10 usd/month')), /echo\/solution\.proschi: Fails "cost ≤ \$10\/month"/],
    ['capacity in the solution', (f: string) => rewrite(join(f, 'solution.proschi'), (s) => `${s}\ncapacity {\n  db 1m rps cost 1 usd/month\n}\n`), /echo\/solution\.proschi:\d+: error: capacity is set by the problem; change the design \(replicas, shards, caching\) instead/],
    ['a starter that passes', (f: string) => cpSync(join(f, 'solution.proschi'), join(f, 'starter.proschi')), /echo\/starter\.proschi: The starter passes every test/],
    ['a starter with errors', (f: string) => rewrite(join(f, 'starter.proschi'), (s) => `${s}api [Redis]\n`), /echo\/starter\.proschi:\d+: error: Duplicate id 'api'/],
    ['a wrong design that passes', (f: string) => writeFileSync(join(f, 'wrong', 'fine.proschi'), `# expect-fail: Items are read from the cache first\n${readFileSync(join(f, 'solution.proschi'), 'utf8')}`), /echo\/wrong\/fine\.proschi:1: Expected to fail "Items are read from the cache first", but it passes/],
    ['a wrong design naming no test', (f: string) => rewrite(join(f, 'wrong', 'database-only.proschi'), (s) => s.replace('# expect-fail: Items are read from the cache first', '# expect-fail: Items are fast')), /echo\/wrong\/database-only\.proschi:1: No test or requirement is named "Items are fast"/],
    ['a wrong design without expect-fail', (f: string) => rewrite(join(f, 'wrong', 'database-only.proschi'), (s) => s.replace('# expect-fail: Items are read from the cache first\n', '')), /echo\/wrong\/database-only\.proschi:1: Start the file with one or more "# expect-fail: <test name>" lines/],
    ['a wrong design without the import', (f: string) => rewrite(join(f, 'wrong', 'database-only.proschi'), (s) => s.replace('import "problem.proschi"\n', '')), /echo\/wrong\/database-only\.proschi:3: After the comment lines the file must start with import "problem.proschi"/],
  ])('fails on %s', (_name, edit, message) => {
    const dir = problemsWith(edit);
    const r = capture(['check', dir]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(message);
    expect(r.out).toMatch(/✗ echo/);
    expect(r.out).toMatch(/1 problem, \d wrong designs?: \d+ violation\(s\) in 1 problem$/);
  });

  it('accepts a company', () => {
    const dir = problemsWith((f) => rewrite(join(f, 'problem.md'), (s) => s.replace('difficulty: easy', 'difficulty: easy\ncompany: Twitter')));
    const r = capture(['check', dir]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/no violations$/m);
  });

  it('writes GitHub annotations and JSON', () => {
    const dir = problemsWith((f) => rewrite(join(f, 'given.proschi'), (s) => s.replace('user "User" [Actor]', 'user  "User"  [Actor]')));
    const github = capture(['check', '--format', 'github', dir]);
    expect(github.code).toBe(1);
    expect(github.out).toMatch(/^::error file=.*echo\/given\.proschi,line=1,title=proschi problem echo::Not in canonical format; run proschi fmt$/);
    const json = JSON.parse(capture(['check', '--format', 'json', dir]).out);
    expect(json.problems).toHaveLength(1);
    expect(json.problems[0]).toMatchObject({ id: 'echo', loaded: true, tests: 5, violations: [{ file: 'given.proschi', message: 'Not in canonical format; run proschi fmt' }] });
    expect(json.problems[0].wrong[0]).toMatchObject({ name: 'database-only', expectFail: ['Items are read from the cache first'], missing: [] });
    expect(capture(['check', '--format', 'github', problemsWith()]).out).toBe('');
  });

  it('rejects bad usage', () => {
    expect(capture(['check', '--format', 'xml', root]).code).toBe(2);
    expect(capture(['check', '--nope']).code).toBe(2);
    expect(capture(['check', 'a', 'b']).code).toBe(2);
    expect(capture(['check', join(root, 'missing')]).code).toBe(2);
    expect(capture(['check'], root).err).toMatch(/give the problems directory/);
    expect(capture(['check', mkdtempSync(join(root, 'empty-'))]).code).toBe(1);
    expect(capture([]).code).toBe(2);
    expect(capture(['frob']).code).toBe(2);
  });
});
