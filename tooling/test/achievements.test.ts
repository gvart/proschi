import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../src/cli';
import { findAchievementsFile, runAchievements } from '../src/achievements';

function capture(args: string[], cwd?: string) {
  const out: string[] = [];
  const err: string[] = [];
  const code = cwd ? runAchievements(args, (s) => out.push(s), (s) => err.push(s), cwd) : run(['achievements', ...args], (s) => out.push(s), (s) => err.push(s));
  return { code, out: out.join('\n'), err: err.join('\n') };
}

const repoFile = resolve(__dirname, '../../frontend/src/practice/achievements.json');
const repoProblems = resolve(__dirname, '../../frontend/src/practice/problems');
const repoCards = resolve(__dirname, '../../frontend/src/practice/cards');

/** A broken copy of the repository's achievements, outside the repository. */
function broken(edit: (list: Record<string, unknown>[]) => unknown): string {
  const file = join(mkdtempSync(join(tmpdir(), 'proschi-achievements-')), 'achievements.json');
  const list = JSON.parse(readFileSync(repoFile, 'utf8')) as Record<string, unknown>[];
  writeFileSync(file, JSON.stringify(edit(list), null, 2));
  return file;
}

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

  it('explains its usage', () => {
    expect(capture(['nope']).err).toMatch(/Unknown achievements command 'nope'/);
    expect(capture(['check', '--format', 'xml']).code).toBe(2);
    const help: string[] = [];
    run(['--help'], (s) => help.push(s));
    expect(help.join('\n')).toContain('proschi achievements check');
  });
});
