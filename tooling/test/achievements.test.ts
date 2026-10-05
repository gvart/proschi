import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../src/cli';
import { findAchievementsFile, runAchievements } from '../src/achievements';
import { writeAchievementsLock } from '../../frontend/src/learn/achievements';

function capture(args: string[], cwd?: string) {
  const out: string[] = [];
  const err: string[] = [];
  const code = cwd ? runAchievements(args, (s) => out.push(s), (s) => err.push(s), cwd) : run(['achievements', ...args], (s) => out.push(s), (s) => err.push(s));
  return { code, out: out.join('\n'), err: err.join('\n') };
}

const repoFile = resolve(__dirname, '../../frontend/src/practice/achievements.json');
const repoProblems = resolve(__dirname, '../../frontend/src/practice/problems');
const repoCards = resolve(__dirname, '../../frontend/src/practice/cards');
const repoLock = resolve(__dirname, '../../frontend/src/practice/achievements.lock');

/**
 * A broken copy of the repository's achievements, outside the repository,
 * with an achievements.lock next to it: by default one listing every id of
 * the copy, else the given text, or none for null.
 */
function broken(edit: (list: Record<string, unknown>[]) => unknown, lock?: string | null): string {
  const file = join(mkdtempSync(join(tmpdir(), 'proschi-achievements-')), 'achievements.json');
  const list = JSON.parse(readFileSync(repoFile, 'utf8')) as Record<string, unknown>[];
  const edited = edit(list);
  writeFileSync(file, JSON.stringify(edited, null, 2));
  const ids = Array.isArray(edited) ? edited.map((a: { id?: string }) => a.id ?? '') : [];
  if (lock !== null) writeFileSync(join(dirname(file), 'achievements.lock'), lock ?? writeAchievementsLock([], ids));
  return file;
}

const lockOf = (file: string) => join(dirname(file), 'achievements.lock');
const dirOptions = ['--problems', repoProblems, '--cards', repoCards];

describe('proschi achievements check', () => {
  it("passes the repository's achievements and counts them", () => {
    const r = capture(['check', repoFile]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^\d+ achievements: no violations$/m);
  });

  it('finds the file from inside the repository', () => {
    expect(findAchievementsFile(resolve(__dirname, '..'))).toBe(repoFile);
    expect(capture(['check'], resolve(__dirname, '..')).code).toBe(0);
  });

  it('reports unknown tags, topics, stages and kinds and duplicate ids, with lines and GitHub annotations', () => {
    const file = broken((list) => [
      ...list,
      { id: 'blockchain', title: 'Chain', description: 'Solve all.', icon: 'star', rule: { kind: 'all-solved', tag: 'blockchain' } },
      { id: 'quantum', title: 'Quantum', description: 'Know it.', icon: 'target', rule: { kind: 'mastery', topic: 'quantum', min: 0.5 } },
      { id: 'moon', title: 'Moon', description: 'Finish it.', icon: 'map', rule: { kind: 'stage', stage: 'moon' } },
      { id: 'karma', title: 'Karma', description: 'Be nice.', icon: 'star', rule: { kind: 'karma', min: 1 } },
      { ...list[0], title: 'Again', rule: { kind: 'reviews', min: 2 } },
    ]);
    const args = ['check', '--problems', repoProblems, '--cards', repoCards, file];
    const r = capture(args);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/achievements\.json:\d+: "blockchain": "tag" names "blockchain", which no practice problem has/);
    expect(r.out).toContain('"quantum": "topic" names "quantum", which is not a topic in tags.json');
    expect(r.out).toContain('"moon": "stage" names "moon", which is not a roadmap stage');
    expect(r.out).toContain('"karma": Unknown rule kind "karma"');
    expect(r.out).toMatch(/achievements\.json:(\d{3}): "first-card": Duplicate id "first-card"/);
    expect(r.out).toMatch(/: 5 violation\(s\)$/m);
    const gh = capture(['check', '--format', 'github', ...args.slice(1)]);
    expect(gh.out).toMatch(/^::error file=.*achievements\.json,line=\d+,title=proschi achievements::"blockchain": /m);
    const json = JSON.parse(capture(['check', '--format', 'json', ...args.slice(1)]).out);
    expect(json.violations).toHaveLength(5);
    rmSync(file);
  });

  it('needs the problems and cards folders outside the repository, and valid JSON', () => {
    const file = broken((list) => list);
    expect(capture(['check', file]).err).toMatch(/No such directory: .*problems \(give --problems <dir>\)/);
    writeFileSync(file, '[{');
    const r = capture(['check', '--problems', repoProblems, '--cards', repoCards, file]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/not valid JSON/);
    rmSync(file);
  });

  it('reports an achievement missing from the lock and a locked id with no achievement, at the lock line', () => {
    const file = broken(
      (list) => [...list.filter((a) => a.id !== 'first-card'), { id: 'brand-new', title: 'New', description: 'Review 7 cards.', icon: 'star', rule: { kind: 'reviews', min: 7 } }],
      readFileSync(repoLock, 'utf8'),
    );
    const r = capture(['check', ...dirOptions, file]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/achievements\.json:\d+: "brand-new": New achievement: add its id to achievements\.lock with `proschi achievements lock`/);
    expect(r.out).toMatch(/achievements\.lock:(\d+): "first-card": achievements\.lock lists "first-card", which has no achievement: never delete one, set "retired": true on it instead/);
    const line = Number(/achievements\.lock:(\d+): "first-card"/.exec(r.out)![1]);
    expect(readFileSync(lockOf(file), 'utf8').split('\n')[line - 1]).toBe('first-card');
    expect(r.out).toMatch(/: 2 violation\(s\)$/m);
    const gh = capture(['check', '--format', 'github', ...dirOptions, file]);
    expect(gh.out).toMatch(/^::error file=.*achievements\.lock,line=\d+,title=proschi achievements::"first-card": /m);
    rmSync(dirname(file), { recursive: true });
  });

  it('accepts a retired achievement, which keeps its id in the lock', () => {
    const file = broken((list) => list.map((a) => (a.id === 'first-card' ? { ...a, retired: true } : a)));
    expect(capture(['check', ...dirOptions, file]).code).toBe(0);
    rmSync(dirname(file), { recursive: true });
  });

  it('reports a missing lock once', () => {
    const file = broken((list) => list, null);
    const r = capture(['check', ...dirOptions, file]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/achievements\.lock: Missing: run `proschi achievements lock` to create it/);
    expect(r.out).toMatch(/: 1 violation\(s\)$/m);
    rmSync(dirname(file), { recursive: true });
  });

  it('explains its usage', () => {
    expect(capture(['nope']).err).toMatch(/Unknown achievements command 'nope'/);
    expect(capture(['check', '--format', 'xml']).code).toBe(2);
    const help: string[] = [];
    run(['--help'], (s) => help.push(s));
    expect(help.join('\n')).toContain('proschi achievements check');
    expect(help.join('\n')).toContain('proschi achievements lock');
  });
});

describe('proschi achievements lock', () => {
  it('creates the lock, adds new ids sorted and leaves a complete lock alone', () => {
    const file = broken((list) => list, null);
    let r = capture(['lock', file]);
    expect(r.code).toBe(0);
    // The same file as the repository's.
    expect(readFileSync(lockOf(file), 'utf8')).toBe(readFileSync(repoLock, 'utf8'));
    expect(capture(['check', ...dirOptions, file]).code).toBe(0);

    const list = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>[];
    writeFileSync(file, JSON.stringify([...list, { ...list[0], id: 'aaa-first' }, { ...list[0], id: 'zzz-last' }]));
    r = capture(['lock', file]);
    expect(r.out).toMatch(/Added 2 ids to .*achievements\.lock:\n {2}aaa-first\n {2}zzz-last/);
    const ids = readFileSync(lockOf(file), 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
    expect(ids[0]).toBe('aaa-first');
    expect(ids.at(-1)).toBe('zzz-last');
    expect(ids).toEqual([...ids].sort());

    // A removed achievement keeps its id.
    writeFileSync(file, JSON.stringify(list));
    expect(capture(['lock', file]).out).toContain('already lists every achievement');
    expect(readFileSync(lockOf(file), 'utf8')).toContain('\naaa-first\n');
    rmSync(dirname(file), { recursive: true });
  });

  it("finds the repository's file and finds its lock complete", () => {
    const before = readFileSync(repoLock, 'utf8');
    expect(capture(['lock'], resolve(__dirname, '..')).out).toMatch(/achievements\.lock already lists every achievement/);
    expect(readFileSync(repoLock, 'utf8')).toBe(before);
  });

  it('needs a readable file', () => {
    expect(capture(['lock', '--force']).err).toMatch(/Unknown option --force/);
    expect(capture(['lock', 'a.json', 'b.json']).err).toMatch(/Give one achievements file/);
    expect(capture(['lock', '/no/such/achievements.json']).err).toMatch(/No such file/);
    const file = broken(() => ({ not: 'a list' }), null);
    expect(capture(['lock', file]).err).toMatch(/must be a JSON list/);
    expect(existsSync(lockOf(file))).toBe(false);
    rmSync(dirname(file), { recursive: true });
  });
});
