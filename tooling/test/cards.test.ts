import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../src/cli';
import { findCardsDir, runCards } from '../src/cards';

function capture(args: string[], cwd?: string) {
  const out: string[] = [];
  const err: string[] = [];
  const code = cwd ? runCards(args, (s) => out.push(s), (s) => err.push(s), cwd) : run(['cards', ...args], (s) => out.push(s), (s) => err.push(s));
  return { code, out: out.join('\n'), err: err.join('\n') };
}

const repoCards = resolve(__dirname, '../../frontend/src/practice/cards');
const repoProblems = resolve(__dirname, '../../frontend/src/practice/problems');

/** A copy of the repository's cards folder, to break. */
function copy(): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'proschi-cards-')), 'cards');
  cpSync(repoCards, dir, { recursive: true });
  return dir;
}

describe('proschi cards check', () => {
  it("passes the repository's cards and counts them", () => {
    const r = capture(['check', repoCards]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^\d+ cards in 15 topics \(.*flip.*; \d+ in the sample deck\): no violations$/m);
  });

  it('finds the cards folder from inside the repository', () => {
    expect(findCardsDir(resolve(__dirname, '..'))).toBe(repoCards);
    expect(capture(['check'], resolve(__dirname, '..')).code).toBe(0);
  });

  it('reports a broken card, an unlocked one and an unknown related problem, with GitHub annotations', () => {
    const dir = copy();
    writeFileSync(join(dir, 'caching', 'brand-new.md'), '---\ntype: flip\ndifficulty: easy\nrelated: [no-such-problem]\n---\n## Front\nWhat is a zebra cache?\n## Back\nA striped one.\n');
    writeFileSync(join(dir, 'caching', 'broken.md'), '---\ntype: flip\n---\n');
    const r = capture(['check', '--problems', repoProblems, dir]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("caching/broken.md: 'difficulty' must be a non-empty string");
    expect(r.out).toContain('caching/brand-new.md: New card: add its id to ids.lock with `proschi cards lock`');
    expect(r.out).toContain('caching/brand-new.md: \'related\' names "no-such-problem", which is not a practice problem');
    const gh = capture(['check', '--format', 'github', dir]);
    expect(gh.out).toMatch(/^::error file=.*caching\/broken\.md,line=1,title=proschi cards::'difficulty' must be a non-empty string$/m);
    const json = JSON.parse(capture(['check', '--format', 'json', dir]).out);
    expect(json.violations.length).toBeGreaterThanOrEqual(3);
    rmSync(dir, { recursive: true });
  });

  it('refuses a deleted card', () => {
    const dir = copy();
    rmSync(join(dir, 'caching', 'cache-aside.md'));
    const r = capture(['check', dir]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/ids\.lock:\d+: "cache-aside" has no card file/);
  });

  it('rejects bad arguments', () => {
    expect(capture(['check', '--format', 'xml']).code).toBe(2);
    expect(capture(['check', '/no/such/dir']).err).toContain('No such directory');
    expect(capture(['shuffle']).err).toContain("Unknown cards command 'shuffle'");
  });
});

describe('proschi cards lock', () => {
  it('adds new ids sorted and leaves a complete lock alone', () => {
    const dir = copy();
    writeFileSync(join(dir, 'caching', 'aaa-first.md'), '---\ntype: flip\ndifficulty: easy\n---\n## Front\nQ\n## Back\nA\n');
    const r = capture(['lock', dir]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Added 1 id to .*ids\.lock:\n {2}aaa-first/);
    const lock = readFileSync(join(dir, 'ids.lock'), 'utf8');
    expect(lock.split('\n').filter((l) => l && !l.startsWith('#'))[0]).toBe('aaa-first');
    expect(capture(['lock', dir]).out).toContain('already lists every card');
  });
});
