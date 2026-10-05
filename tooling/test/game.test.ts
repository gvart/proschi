import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../src/cli';
import { runGame } from '../src/game';

const repo = resolve(__dirname, '../..');
const content = resolve(repo, 'frontend/src/game/content');

function capture(args: string[], cwd = repo) {
  const out: string[] = [];
  const err: string[] = [];
  const code = runGame(args, (s) => out.push(s), (s) => err.push(s), cwd);
  return { code, out: out.join('\n'), err: err.join('\n') };
}

/** A copy of the content outside the repository, edited by `edit`. */
function copy(edit: (dir: string) => void): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'proschi-game-')), 'content');
  cpSync(content, dir, { recursive: true });
  edit(dir);
  return dir;
}

describe('proschi game check', () => {
  it("passes the repository's content and plays its scripted runs", () => {
    const { code, out } = capture(['check']);
    expect(code).toBe(0);
    expect(out).toMatch(/6 scenario\(s\), \d+ components, \d+ cards, \d+ events, \d+ perks: no violations/);
    expect(out).toMatch(/shortly\/reference\.json: retired after 12 wave\(s\)/);
    expect(out).toMatch(/drop\/wrong\/nosql-seats\.json: churned after \d wave\(s\)/);
  });

  it('reports a reference run that no longer clears, in GitHub format', () => {
    const dir = copy((d) => {
      const path = join(d, 'scenarios/shortly/reference.json');
      const r = JSON.parse(readFileSync(path, 'utf8'));
      r.plays = r.plays.slice(0, 3);
      writeFileSync(path, JSON.stringify(r));
    });
    const { code, out } = capture(['check', '--format', 'github', dir]);
    expect(code).toBe(1);
    expect(out).toMatch(/::error file=.*scenarios\/shortly\/reference\.json,line=1,title=proschi game::Must clear all 12 waves, but ended in wave \d+/);
  });

  it('reports an id missing from ids.lock, and lock adds it', () => {
    const dir = copy((d) => writeFileSync(join(d, 'cards/new-card.md'), readFileSync(join(d, 'cards/gzip.md'), 'utf8').replace('name: Compression', 'name: New card').replace('icon: file-archive', 'icon: lightbulb')));
    expect(capture(['check', dir]).out).toContain("'card:new-card' is not in ids.lock");
    const lock = capture(['lock', dir]);
    expect(lock.code).toBe(0);
    expect(lock.out).toContain('card:new-card');
    expect(capture(['lock', dir]).out).toContain('already lists every id');
    expect(capture(['check', dir]).code).toBe(0);
  });

  it('reports an icon used twice within a category, and an unknown icon', () => {
    const dir = copy((d) => {
      const edit = (file: string, from: string, to: string) => writeFileSync(join(d, file), readFileSync(join(d, file), 'utf8').replace(from, to));
      edit('cards/gzip.md', 'icon: file-archive', 'icon: cable');
      edit('events/ddos.md', 'icon: bot', 'icon: not-an-icon');
    });
    const { code, out } = capture(['check', dir]);
    expect(code).toBe(1);
    expect(out).toContain("'gzip': icon 'cable' is already used by the card 'connection-pooling'");
    expect(out).toContain("'ddos': unknown icon 'not-an-icon'");
  });

  it('allows the same icon in two categories', () => {
    const dir = copy((d) => writeFileSync(join(d, 'cards/gzip.md'), readFileSync(join(d, 'cards/gzip.md'), 'utf8').replace('icon: file-archive', 'icon: piggy-bank')));
    expect(capture(['check', dir]).code).toBe(0);
  });
});

describe('proschi game sim', () => {
  it("prints every wave of a scenario's reference run", () => {
    const { code, out } = capture(['sim', 'ping']);
    expect(code).toBe(0);
    expect(out.split('\n').filter((l) => /^\d+ /.test(l))).toHaveLength(12);
    expect(out).toMatch(/retired: score \d+/);
  });

  it('takes another seed and an unknown scenario is an error', () => {
    expect(capture(['sim', 'shortly', '--seed', 'other']).code).toBe(0);
    const { code, err } = capture(['sim', 'nope']);
    expect(code).toBe(2);
    expect(err).toContain("No scenario 'nope'");
  });

  it('is listed in the CLI usage', () => {
    const out: string[] = [];
    run(['--help'], (s) => out.push(s), () => {});
    expect(out.join('\n')).toContain('proschi game check');
  });
});
