import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diagramOf, type Extras } from '../../frontend/src/sim/testDiagram';
import { collectFiles, run } from '../src/cli';
import { analyze, hover } from '../src/analysis';
import { parse } from '../src/proschi';
import { formatTestReports, nodeSimulation, runAnalyze, runTest, testDiagnostics, testFiles, type Loader } from '../src/simulation';

// Most tests attach traffic, requirements and tests by hand through a loader,
// to pin exact numbers; the tests at the end use the real syntax.

const dir = mkdtempSync(join(tmpdir(), 'proschi-sim-'));

const SOURCE = `title "Items"
client [Actor]
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
const file = join(dir, 'items.proschi');
writeFileSync(file, SOURCE);
const broken = join(dir, 'broken.proschi');
writeFileSync(broken, 'a [REST API]\na [Redis]\n');

const EXTRAS: Extras = {
  traffic: [{ useCase: 'Read', rps: 1000 }],
  requirements: [
    { kind: 'latency', percentile: 99, useCase: 'Read', maxMs: 100, loc: { line: 14, col: 3, length: 3 } },
    { kind: 'survive', target: 'any', loc: { line: 15, col: 3, length: 6 } },
  ],
  tests: [
    {
      name: 'Reads go to the db',
      loc: { line: 17, col: 1, length: 4 },
      assertions: [
        { kind: 'calls', useCase: 'Read', target: { node: 'db' }, quantifier: 'some', loc: { line: 18, col: 3, length: 6 } },
        { kind: 'responds', useCase: 'Read', status: '404', loc: { line: 19, col: 3, length: 6 } },
      ],
    },
  ],
};

/** Parses from disk and attaches `extras` to the diagram by hand. */
const withExtras =
  (extras: Extras): Loader =>
  (path) => {
    const result = parse(readFileSync(path, 'utf8'));
    return { ...result, diagram: diagramOf(readFileSync(path, 'utf8'), extras) };
  };

function capture(fn: (out: (s: string) => void, err: (s: string) => void) => number | Promise<number>) {
  const out: string[] = [];
  const err: string[] = [];
  const code = fn((s) => out.push(s), (s) => err.push(s));
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('proschi test', () => {
  it('runs requirements and tests and reports them as text', () => {
    const r = capture((out, err) => runTest([file], collectFiles, out, err, withExtras(EXTRAS)));
    expect(r.code).toBe(1);
    const shown = r.out.replace(dir, '<dir>');
    expect(shown).toBe(
      [
        '<dir>/items.proschi',
        '  ✓ p99 of Read < 100 ms: p99 of Read is 75.8 ms (limit 100 ms)',
        '  ✗ survive any node failure (line 15): Losing api (REST API) breaks "Read" (and 1 more)',
        '      → Add a replica (x2 on api) or a fallback scenario in "Read" that calls api with -x and still completes',
        '  ✗ Reads go to the db (line 17): "Read" never responds 404; it answers 200',
        '      ✗ line 19: "Read" never responds 404; it answers 200',
        '      → Add a scenario (alt) whose entry request is answered with 404',
        '1 file: 1 passed, 2 failed',
      ].join('\n'),
    );
  });

  it('exits with 0 when everything passes', () => {
    const passing: Extras = { ...EXTRAS, requirements: EXTRAS.requirements!.slice(0, 1), tests: [] };
    const r = capture((out, err) => runTest([file], collectFiles, out, err, withExtras(passing)));
    expect(r.code).toBe(0);
    expect(r.out).toContain('1 file: 1 passed, 0 failed');
  });

  it('writes GitHub annotations for failures only', () => {
    const r = capture((out, err) => runTest(['--format', 'github', file], collectFiles, out, err, withExtras(EXTRAS)));
    expect(r.out.split('\n')).toEqual([
      `::error file=${file},line=15,col=3,title=proschi test: survive any node failure::Losing api (REST API) breaks "Read" (and 1 more). Add a replica (x2 on api) or a fallback scenario in "Read" that calls api with -x and still completes`,
      `::error file=${file},line=17,col=1,title=proschi test: Reads go to the db::"Read" never responds 404; it answers 200. Add a scenario (alt) whose entry request is answered with 404`,
    ]);
  });

  it('writes JSON with every result', () => {
    const r = capture((out, err) => runTest(['--format', 'json', file], collectFiles, out, err, withExtras(EXTRAS)));
    const [report] = JSON.parse(r.out);
    expect(report.file).toBe(file);
    expect(report.errors).toEqual([]);
    expect(report.results.map((t: { id: string; passed: boolean }) => [t.id, t.passed])).toEqual([
      ['req:1', true],
      ['req:2', false],
      ['test:Reads go to the db', false],
    ]);
  });

  it('fails on parse errors, and passes files without requirements', () => {
    const bad = capture((out, err) => run(['test', broken], out, err) as number);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain("error 2:1: Duplicate id 'a'");
    expect(bad.out).toContain('1 file: 0 passed, 0 failed, 1 error(s)');
    const none = capture((out, err) => run(['test', file], out, err) as number);
    expect(none.code).toBe(0);
    expect(none.out).toContain('  no requirements or tests');
  });

  it('searches directories and reports each file', () => {
    expect(testFiles(collectFiles([dir])).map((r) => r.file.slice(dir.length + 1))).toEqual(['broken.proschi', 'items.proschi']);
    expect(formatTestReports(testFiles([file, broken]), 'text')).toContain('2 files: 0 passed, 0 failed, 1 error(s)');
  });

  it('rejects bad usage with exit code 2', () => {
    expect(capture((out, err) => run(['test'], out, err) as number).code).toBe(2);
    expect(capture((out, err) => run(['test', '--format', 'xml', file], out, err) as number).code).toBe(2);
    expect(capture((out, err) => run(['test', '--nope', file], out, err) as number).code).toBe(2);
    expect(capture((out, err) => run(['test', join(dir, 'missing.proschi')], out, err) as number).code).toBe(2);
  });
});

describe('proschi analyze', () => {
  it('prints the capacity table', () => {
    const r = capture((out, err) => runAnalyze([file], out, err, withExtras({ ...EXTRAS, replicas: { api: 2 } })));
    expect(r.code).toBe(0);
    expect(r.out.replace(dir, '<dir>')).toBe(
      [
        'Items (<dir>/items.proschi)',
        '',
        'Node  Kind      Replicas    Load  Capacity  Util  Latency  Availability  Cost/month',
        'api   service          2  1k rps    4k rps   25%  13.3 ms      99.9975%        $200',
        'db    database         1  1k rps   20k rps    5%   5.3 ms        99.95%        $400',
        '',
        'Total cost: $600/month',
        '',
        'Use case  Traffic      p50      p95      p99  p99.9  Availability',
        'Read       1k rps  18.6 ms  37.2 ms  55.8 ms  93 ms       99.947%',
        '',
        'Single points of failure: db',
      ].join('\n'),
    );
  });

  it('marks saturated nodes and lists warnings', () => {
    const r = capture((out, err) => runAnalyze([file], out, err, withExtras({ traffic: [{ useCase: 'Read', rps: 3000 }] })));
    expect(r.out).toContain('150% SATURATED');
    expect(r.out).toContain("Warnings:\n  'api' is saturated: 3k rps of 2k rps, 150%. Add replicas or take load off it.");
  });

  it('works without traffic and writes JSON', () => {
    const text = capture((out, err) => run(['analyze', file], out, err) as number);
    expect(text.code).toBe(0);
    expect(text.out).toContain('No traffic { … } block');
    const json = capture((out, err) => run(['analyze', '--format', 'json', file], out, err) as number);
    const { analysis } = JSON.parse(json.out);
    expect(analysis.nodes.map((n: { id: string }) => n.id)).toEqual(['client', 'api', 'db']);
    // Infinity is not JSON; client capacity comes out as null.
    expect(analysis.nodes[0].capacityRps).toBeNull();
  });

  it('rejects bad usage', () => {
    expect(capture((out, err) => run(['analyze'], out, err) as number).code).toBe(2);
    expect(capture((out, err) => run(['analyze', file, file], out, err) as number).code).toBe(2);
    expect(capture((out, err) => run(['analyze', '--format', 'github', file], out, err) as number).code).toBe(2);
  });
});

describe('language server helpers', () => {
  const diagram = diagramOf(SOURCE, EXTRAS);

  it('turns failing requirements and assertions into warnings at their lines', () => {
    expect(testDiagnostics(diagram).map((d) => [d.line, d.col, d.severity, d.message])).toEqual([
      [15, 3, 'warning', 'survive any node failure: Losing api (REST API) breaks "Read" (and 1 more). Add a replica (x2 on api) or a fallback scenario in "Read" that calls api with -x and still completes'],
      [17, 1, 'warning', 'Reads go to the db: "Read" never responds 404; it answers 200. Add a scenario (alt) whose entry request is answered with 404'],
      [19, 3, 'warning', '"Read" never responds 404; it answers 200. Add a scenario (alt) whose entry request is answered with 404'],
    ]);
  });

  it('leaves out results located in imported files', () => {
    const imported = diagramOf(SOURCE, { ...EXTRAS, requirements: [{ kind: 'survive', target: 'any', loc: { line: 3, col: 1, length: 1, file: 'other.proschi' } }], tests: [] });
    expect(testDiagnostics(imported)).toEqual([]);
  });

  it('adds load and latency to node hovers when there is traffic', () => {
    expect(nodeSimulation(diagram, 'api')).toBe('Load 1k rps of 2k rps (50% utilised)  \nLatency 20 ms per call · availability 99.5% · $100/month');
    expect(nodeSimulation(diagram, 'client')).toBeUndefined();
    expect(nodeSimulation(diagramOf(SOURCE), 'api')).toBeUndefined();

    const doc = analyze(SOURCE);
    const plain = hover(doc, { line: 2, character: 1 })!;
    expect(plain.markdown).not.toContain('Load');
    const withTraffic = hover({ ...doc, diagram }, { line: 2, character: 1 })!;
    expect(withTraffic.markdown).toContain('Load 1k rps of 2k rps (50% utilised)');
  });
});

describe('with the language syntax', () => {
  it('runs the requirements and tests written in the file', () => {
    writeFileSync(
      join(dir, 'real.proschi'),
      `${SOURCE}
traffic {
  "Read" 1k rps
}
requirements {
  p99 "Read" < 100ms
  survive any node failure
}
test "Reads go to the db" {
  "Read" calls db
}
`,
    );
    const r = capture((out, err) => run(['test', join(dir, 'real.proschi')], out, err) as number);
    expect(r.code).toBe(1);
    expect(r.out).toContain('✓ p99 of Read < 100 ms');
    expect(r.out).toContain('✗ survive any node failure');
    expect(r.out).toContain('✓ Reads go to the db');
  });
});
