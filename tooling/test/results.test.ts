import { describe, expect, it } from 'vitest';
import { analyze, codeLenses, inlayHints } from '../src/analysis';

// Simulation results in the editor: inlay hints after nodes, code lenses above use cases, what-ifs and requirements.

const ITEMS = `client [Actor]
api [REST API]
db [PostgreSQL]
client -> api
api -> db
usecase "Read" {
  client -> api : GET /items
  api -> db : SELECT item
  db --> api : row
  api --> client : 200
}
`;

const loaded = `${ITEMS}traffic {
  "Read" 1k rps
}
requirements {
  p99 "Read" < 100ms
  cost <= 3000 usd/month
}
whatif "Peak" {
  traffic "Read" x3
}
`;

const titles = (text: string) =>
  codeLenses(analyze(text))
    .map((l) => [l.range.start.line, l.title] as const)
    .sort((x, y) => x[0] - y[0]);
const lineOf = (text: string, line: string) => text.split('\n').indexOf(line);

describe('inlay hints', () => {
  it('shows utilisation and monthly cost after each node, but not for clients', () => {
    expect(inlayHints(analyze(loaded)).map((h) => [h.position, h.label, h.saturated])).toEqual([
      [{ line: 1, character: 14 }, '50% · $100/mo', false],
      [{ line: 2, character: 15 }, '5% · $400/mo', false],
    ]);
    expect(inlayHints(analyze(loaded))[0].tooltip).toContain('Load 1k rps of 2k rps');
  });

  it('labels a saturated node', () => {
    const [api] = inlayHints(analyze(loaded.replace('1k rps', '3k rps')));
    expect(api).toMatchObject({ label: '150% saturated · $100/mo', saturated: true });
  });

  it('shows nothing without traffic', () => {
    expect(inlayHints(analyze(ITEMS))).toEqual([]);
  });

  it('keeps to the requested range', () => {
    const range = { start: { line: 2, character: 0 }, end: { line: 2, character: 0 } };
    expect(inlayHints(analyze(loaded), range).map((h) => h.label)).toEqual(['5% · $400/mo']);
  });
});

describe('code lenses', () => {
  it('shows p99 above each use case, what-if results and the requirements that pass', () => {
    expect(titles(loaded)).toEqual([
      [lineOf(loaded, 'usecase "Read" {'), 'p99 89.3 ms ✓'],
      [lineOf(loaded, 'requirements {'), '✓ 2/2 requirements pass'],
      [lineOf(loaded, 'whatif "Peak" {'), '✗ 1 of 2 fail · worst p99 921 ms · 99.45% · $500/mo'],
    ]);
  });

  it('names the limit a use case breaks', () => {
    const strict = loaded.replace('p99 "Read" < 100ms', 'p95 "Read" < 10ms');
    expect(titles(strict)[0][1]).toBe('p99 89.3 ms ✗ (req p95 < 10 ms)');
    expect(titles(strict)[1][1]).toBe('✗ 1/2 requirements pass');
  });

  it('applies a requirement without a use case to every use case with traffic', () => {
    const global = loaded.replace('p99 "Read" < 100ms', 'p99 < 50ms');
    expect(titles(global)[0][1]).toBe('p99 89.3 ms ✗ (req < 50 ms)');
  });

  it('shows p99 alone without requirements, and no what-if or requirements lens without the blocks', () => {
    expect(titles(ITEMS)).toEqual([[5, expect.stringMatching(/^p99 [\d.]+ ms$/)]]);
  });
});
