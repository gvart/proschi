import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectFiles, run } from '../src/cli';

function capture(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = run(argv, (s) => out.push(s), (s) => err.push(s));
  return { code, out: out.join('\n'), err: err.join('\n') };
}

const dir = mkdtempSync(join(tmpdir(), 'proschi-cli-'));
mkdirSync(join(dir, 'nested'));
mkdirSync(join(dir, 'node_modules'));
writeFileSync(join(dir, 'ok.proschi'), 'api [REST API]\napi -> db\n');
writeFileSync(join(dir, 'nested', 'warn.proschi'), 'usecase "U" {\n  b --> a : 200\n}\n');
writeFileSync(join(dir, 'node_modules', 'skip.proschi'), '%%%');
writeFileSync(join(dir, 'notes.txt'), '%%%');
const bad = join(dir, 'bad.proschi');
writeFileSync(bad, 'a [REST API]\na [Redis]\n');

describe('proschi check', () => {
  it('finds .proschi files below directories, skipping node_modules', () => {
    expect(collectFiles([dir]).map((f) => f.slice(dir.length + 1))).toEqual(['bad.proschi', 'nested/warn.proschi', 'ok.proschi']);
  });

  it('fails on errors and reports file:line:col', () => {
    const r = capture(['check', bad]);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`${bad}:2:1: error: Duplicate id 'a'`);
    expect(r.out).toContain('1 file: 1 error(s), 0 warning(s)');
  });

  it('passes warnings unless --strict', () => {
    const warn = join(dir, 'nested', 'warn.proschi');
    expect(capture(['check', warn]).code).toBe(0);
    expect(capture(['check', '--strict', warn]).code).toBe(1);
    expect(capture(['check', join(dir, 'ok.proschi')]).out).toBe('1 file: no problems');
  });

  it('writes GitHub annotations and JSON', () => {
    expect(capture(['check', '--format', 'github', bad]).out).toBe(
      `::error file=${bad},line=2,col=1,title=proschi::Duplicate id 'a' (first declared on line 1)`,
    );
    const json = JSON.parse(capture(['check', '--format', 'json', bad]).out);
    expect(json[0].diagnostics[0]).toMatchObject({ severity: 'error', line: 2, col: 1 });
  });

  it('rejects bad usage with exit code 2', () => {
    expect(capture([]).code).toBe(2);
    expect(capture(['check']).code).toBe(2);
    expect(capture(['check', '--format', 'xml', bad]).code).toBe(2);
    expect(capture(['check', '--nope', bad]).code).toBe(2);
    expect(capture(['check', join(dir, 'missing.proschi')]).code).toBe(2);
    expect(capture(['frobnicate']).code).toBe(2);
    expect(capture(['--help']).code).toBe(0);
  });
});

describe('proschi parse', () => {
  it('prints the diagram and diagnostics as JSON', () => {
    const r = capture(['parse', join(dir, 'ok.proschi')]);
    const result = JSON.parse(r.out);
    expect(result.diagram.nodes.map((n: { id: string }) => n.id)).toEqual(['api', 'db']);
    expect(result.diagnostics).toEqual([]);
  });
});
