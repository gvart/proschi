import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../src/cli';

function capture(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = run(argv, (s) => out.push(s), (s) => err.push(s));
  return { code, out, err: err.join('\n') };
}

const messy = 'api "API" [REST API]\ndatabase [Redis]\n\n\napi->database:SQL\n';
const tidy = 'api      "API" [REST API]\ndatabase       [Redis]\n\napi -> database : SQL\n';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'proschi-fmt-'));
  mkdirSync(join(dir, 'nested'));
  mkdirSync(join(dir, 'node_modules'));
  writeFileSync(join(dir, 'messy.proschi'), messy);
  writeFileSync(join(dir, 'nested', 'tidy.proschi'), tidy);
  writeFileSync(join(dir, 'nested', 'broken.proschi'), '  a "unterminated\n\n\n');
  writeFileSync(join(dir, 'node_modules', 'skip.proschi'), messy);
  return dir;
}

describe('proschi fmt', () => {
  it('rewrites the files that change, lists them and leaves the rest alone', () => {
    const dir = setup();
    const r = capture(['fmt', dir]);
    expect(r.code).toBe(0);
    expect(r.out).toEqual([join(dir, 'messy.proschi'), join(dir, 'nested', 'broken.proschi')]);
    expect(readFileSync(join(dir, 'messy.proschi'), 'utf8')).toBe(tidy);
    // Lines the parser cannot read are kept, only re-indented.
    expect(readFileSync(join(dir, 'nested', 'broken.proschi'), 'utf8')).toBe('a "unterminated\n');
    expect(readFileSync(join(dir, 'node_modules', 'skip.proschi'), 'utf8')).toBe(messy);
    expect(capture(['fmt', dir]).out).toEqual([]);
  });

  it('with --check, writes nothing and fails when a file would change', () => {
    const dir = setup();
    const r = capture(['fmt', '--check', join(dir, 'messy.proschi'), join(dir, 'nested')]);
    expect(r.code).toBe(1);
    expect(r.out).toEqual([join(dir, 'messy.proschi'), join(dir, 'nested', 'broken.proschi')]);
    expect(readFileSync(join(dir, 'messy.proschi'), 'utf8')).toBe(messy);
    expect(capture(['fmt', '--check', join(dir, 'nested', 'tidy.proschi')])).toMatchObject({ code: 0, out: [] });
  });

  it('rejects bad usage with exit code 2', () => {
    expect(capture(['fmt']).code).toBe(2);
    expect(capture(['fmt', '--nope', 'x.proschi']).code).toBe(2);
    expect(capture(['fmt', join(tmpdir(), 'missing-proschi-dir', 'x.proschi')]).code).toBe(2);
    expect(capture(['--help']).out.join('\n')).toContain('proschi fmt [--check]');
  });
});
