import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../src/cli';
import { parse } from '../src/proschi';

const SPECS = join(__dirname, 'fixtures', 'openapi', 'specs');

async function capture(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, (s) => out.push(s), (s) => err.push(s));
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('proschi import', () => {
  it('turns an OpenAPI spec into a design that proschi check finds consistent with the spec', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'proschi-import-'));
    const file = join(dir, 'orders.proschi');
    const spec = join(SPECS, 'orders-api.yaml');
    const imported = await capture(['import', 'openapi', spec, '-o', file]);
    expect(imported.code).toBe(0);
    const source = readFileSync(file, 'utf8');
    expect(source).toMatch(/client -> api +: POST \/v1\/orders\n/);
    expect(parse(source).diagnostics).toEqual([]);

    const checked = await capture(['check', '--openapi', `api=${spec}`, file]);
    expect(checked.out).toContain('no problems');
    expect(checked.code).toBe(0);
  });

  it('reads JSON specs and prints to stdout', async () => {
    const { code, out } = await capture(['import', 'openapi', join(SPECS, 'payments-api.json')]);
    expect(code).toBe(0);
    expect(out).toMatch(/client -> api +: POST \/payments-api\/payments\n/);
    expect(out).toMatch(/api +--> client : 200/);
  });

  it('converts a Mermaid flowchart and reports warnings on stderr', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'proschi-import-'));
    const file = join(dir, 'arch.mmd');
    writeFileSync(file, 'flowchart LR\n  web[Web] --> db[(Orders DB)]\n  style web fill:#fff\n');
    const { code, out, err } = await capture(['import', 'mermaid', file]);
    expect(code).toBe(0);
    expect(out).toContain('db  "Orders DB" [Database]');
    expect(out).toContain('web -> db');
    expect(err).toContain('warning: Ignored 1 styling line(s)');
  });

  it('rejects an unknown format or a missing file', async () => {
    expect((await capture(['import', 'plantuml', 'x.puml'])).code).toBe(2);
    expect((await capture(['import', 'mermaid'])).code).toBe(2);
    expect((await capture(['import', 'mermaid', join(SPECS, 'nope.mmd')])).code).toBe(2);
  });
});
