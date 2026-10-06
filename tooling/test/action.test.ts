import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The GitHub Action's script (action/run.mjs) is plain JavaScript; a computed
// specifier keeps TypeScript from looking for its types.
const script = '../../action/run.mjs';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const action: any = await import(script);

const row = (over: object = {}) => ({
  file: 'docs/shop.proschi',
  errors: 0,
  nodes: 4,
  tests: [{ id: 'test:Cached', name: 'Cached', passed: true, message: 'ok' }],
  requirements: [
    { id: 'req:1', name: 'p99 < 100 ms', passed: true, message: 'ok' },
    { id: 'req:2', name: 'cost <= 10 usd/month', passed: false, message: 'Total cost is $500/month', hint: 'Drop replicas', loc: { line: 7, col: 3 } },
  ],
  cost: 500,
  p99: 24.3,
  link: 'https://proschi.app/app/#code=abc',
  mermaid: '```mermaid\nflowchart LR\n  a --> b\n```',
  ...over,
});

const state = (rows: object[]) => ({ rows, totals: { files: 2, passed: 2, failed: 1 }, checkFailed: false, testFailed: true, testsRun: true, more: 0, sha: '1234567890' });

describe('the GitHub Action', () => {
  it('matches files by glob, skipping node_modules and dot directories', () => {
    const dir = mkdtempSync(join(tmpdir(), 'proschi-action-'));
    for (const d of ['docs/a', 'node_modules/x', '.cache', 'other']) mkdirSync(join(dir, d), { recursive: true });
    for (const f of ['top.proschi', 'docs/a/deep.proschi', 'docs/skip.proschi', 'node_modules/x/n.proschi', '.cache/c.proschi', 'other/o.txt']) writeFileSync(join(dir, f), '');
    expect(action.matchFiles(['**/*.proschi'], dir)).toEqual(['docs/a/deep.proschi', 'docs/skip.proschi', 'top.proschi']);
    expect(action.matchFiles(['docs/**/*.proschi', '!docs/skip.proschi'], dir)).toEqual(['docs/a/deep.proschi']);
    expect(action.matchFiles(['./*.{proschi,txt}'], dir)).toEqual(['top.proschi']);
  });

  it('writes one table row per file, the failures and the diagrams, behind the marker', () => {
    const body: string = action.renderBody(state([row(), row({ file: 'docs/broken.proschi', errors: 2, link: undefined })]));
    expect(body.startsWith(action.MARKER)).toBe(true);
    expect(body).toContain('### ❌ Proschi');
    expect(body).toContain('| `docs/shop.proschi` | 4 | ✅ 1/1 passed | ❌ 1/2 met | $500 | 24.3 ms | [Open in Proschi](https://proschi.app/app/#code=abc) |');
    expect(body).toContain('| `docs/broken.proschi` | 4 | ❌ 2 errors |');
    expect(body).toContain('- `docs/shop.proschi:7` **cost <= 10 usd/month**: Total cost is $500/month _Drop replicas_');
    expect(body).toContain('```mermaid\nflowchart LR');
    expect(body).toContain(action.ARTIFACT_PLACEHOLDER);
  });

  it('says so when the pull request changes no diagram', () => {
    expect(action.renderBody({ ...state([]), testFailed: false })).toContain('No changed `.proschi` files');
  });

  it('drops diagrams, then links, to stay within a comment', () => {
    const big = Array.from({ length: 12 }, (_, i) => row({ file: `f${i}.proschi`, link: `https://proschi.app/app/#code=${'x'.repeat(5000)}`, mermaid: '```mermaid\n' + 'y'.repeat(5000) + '\n```' }));
    const body: string = action.fit(state(big));
    expect(body.length).toBeLessThanOrEqual(60_000);
    expect(body).toContain('[Open in Proschi]');
    expect(body).toContain('diagram too large for a link');
  });
});
