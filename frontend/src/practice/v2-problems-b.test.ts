import { describe, expect, it } from 'vitest';
import { defaultEngine } from '../hld/engine';
import { findProblem } from './problems';
import { parseSolution, runTests } from './workspace';
import type { Problem } from './types';

/**
 * Regression tests for the v2 checks of file-storage, search-autocomplete and
 * ride-matching (docs/design/hld-and-practice.md §7): a plausible wrong
 * design, made from the reference solution with one change, must fail the
 * named test.
 */

function problem(id: string): Problem {
  const p = findProblem(id);
  if (!p) throw new Error(`no problem ${id}`);
  return p;
}

/** The reference solution with each `[from, to]` replaced; every `from` must occur. */
function variant(p: Problem, ...edits: [string, string][]): string {
  let source = p.solution;
  for (const [from, to] of edits) {
    expect(source, `the solution of ${p.id} contains the text to replace`).toContain(from);
    source = source.replace(from, to);
  }
  return source;
}

/** Runs the problem's tests on a source that must parse without errors; returns the failing test names. */
function failing(p: Problem, source: string): string[] {
  const parsed = parseSolution(p, source);
  expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  const run = runTests(parsed, defaultEngine);
  expect(run.blocked).toBeUndefined();
  return run.results.filter((r) => !r.passed).map((r) => r.name);
}

/** The analysis of a source, for checking costs and utilisation. */
function analysisOf(p: Problem, source: string) {
  const analysis = defaultEngine.analyze(parseSolution(p, source).diagram);
  if (!analysis) throw new Error('no analysis');
  return analysis;
}

describe('file-storage', () => {
  const p = problem('file-storage');
  const uploadBlock = p.solution.slice(p.solution.indexOf('usecase "Upload"'), p.solution.indexOf('usecase "Download"'));
  const downloadBlock = p.solution.slice(p.solution.indexOf('usecase "Download"'));

  it('fails an upload proxied through the API: the bytes pass a server, and the extra hops miss the latency', () => {
    const proxied = `usecase "Upload" "Stream the bytes through the API" {
  user     -> lb       : ~1MB PUT /files/9a1
  lb       -> api      : ~1MB PUT /files/9a1
  api      -> blobs    : ~1MB PUT /9a1
  blobs   --> api      : 200
  api     --> lb       : 200
  lb      --> user     : 200
  blobs   ->> events   : ObjectCreated 9a1
  events  ->> finisher : ObjectCreated 9a1
  finisher -> meta     : UPDATE File status=ready
  meta    --> finisher : ok
}

`;
    const failed = failing(p, variant(p, [uploadBlock, proxied], ['lb       -> api      : HTTPS', 'lb       -> api      : HTTPS\napi      -> blobs    : PUT']));
    expect(failed).toContain('File bytes never pass through your servers');
    expect(failed).toContain('p99 of Upload < 450 ms');
  });

  it('fails downloads straight from the bucket: the egress breaks the budget', () => {
    const direct = `usecase "Download" "Fetch a file from the bucket with a signed URL" {
  user -> blobs : ~1MB GET /9a1?sig=…

  alt "CDN hit" when "never: there is no CDN" {
    blobs --> user : 200 bytes
  } alt "CDN miss" when "always" {
    blobs --> user : 200 bytes
  }
}
`;
    const source = variant(p, [downloadBlock, direct]);
    const failed = failing(p, source);
    expect(failed).toContain('Downloads are served by the CDN');
    expect(failed).toContain('cost ≤ $45,000/month');
    expect(analysisOf(p, source).totalEgressUsd).toBeGreaterThan(100_000);
  });

  it('fails a client that marks its own upload complete', () => {
    const clientDriven = `usecase "Upload" "The client puts the bytes, then reports completion" {
  user  -> blobs : ~1MB PUT /9a1?sig=…
  blobs --> user : 200
  user  -> lb    : POST /files/9a1/complete
  lb    -> api   : POST /files/9a1/complete
  api   -> meta  : UPDATE File status=ready
  meta --> api   : ok
  api  --> lb    : 204
  lb   --> user  : 204
}

`;
    expect(failing(p, variant(p, [uploadBlock, clientDriven]))).toContain('Uploads are finished without the client');
  });

  it('fails downloads through a load balancer instead of a CDN', () => {
    const source = variant(p, ['cdn      "CDN"             [AWS CloudFront]', 'cdn      "CDN"             [AWS Load Balancer]']);
    expect(failing(p, source)).toContain('Downloads are served by the CDN');
  });
});

describe('search-autocomplete', () => {
  const p = problem('search-autocomplete');

  it('fails a search that waits for the query log', () => {
    const source = variant(p, ['  api    ->> querylog : Query "iphone case"\n', '  api     -> querylog : Query "iphone case"\n  querylog --> api    : ack\n']);
    expect(failing(p, source)).toEqual(['Searches feed the query log without waiting for it']);
  });

  it('fails suggestions without a CDN: every keystroke reaches the servers', () => {
    const suggest = p.solution.slice(p.solution.indexOf('usecase "Suggest"'), p.solution.indexOf('usecase "Search"'));
    const noCdn = `usecase "Suggest" "Top ten completions from the index" {
  user -> lb : GET /suggest?q=ipho

  alt "Edge hit" when "the prefix is popular" {
    lb       -> suggest : GET /suggest?q=ipho
    suggest  -> topk    : GET top10:ipho
    topk    --> suggest : ["iphone 15"]
    suggest --> lb      : 200
    lb      --> user    : 200 ["iphone 15"]
  } alt "Edge miss" when "the prefix is rare" {
    lb       -> suggest : GET /suggest?q=ipho
    suggest  -> topk    : GET top10:ipho
    topk    --> suggest : ["iphone 15"]
    suggest --> lb      : 200
    lb      --> user    : 200 ["iphone 15"]
  }
}

`;
    const source = variant(p, [suggest, noCdn], ['suggest  "Suggest Service"  [REST API]          x20', 'suggest  "Suggest Service"  [REST API]          x100']);
    const failed = failing(p, source);
    expect(failed).toContain('Suggestions are served by the CDN, then the cache');
    expect(failed).toContain('cost ≤ $5,500/month');
  });

  it('fails a rebuild triggered by the search API instead of the scheduler', () => {
    const source = variant(p, ['  scheduler ->> builder  : RebuildIndex\n', '  api       ->> builder  : RebuildIndex\n']);
    expect(failing(p, source)).toContain('The index is rebuilt offline from the query log');
  });
});

describe('ride-matching', () => {
  const p = problem('ride-matching');
  const toDatabase: [string, string] = ['  gateway  -> geo     : GEOADD drivers 13.40 52.52 d7\n  geo     --> gateway : 1\n', '  gateway  -> trips   : UPDATE drivers SET lat, lng\n  trips   --> gateway : ok\n'];

  it('fails location updates written to the relational database: one primary cannot take them', () => {
    const source = variant(p, toDatabase);
    const failed = failing(p, source);
    expect(failed).toContain('Location updates are writes to the live map, never the database');
    expect(failed).toContain('p99 of Update location < 150 ms');
    const trips = analysisOf(p, source).nodes.find((n) => n.id === 'trips')!;
    expect(trips.writeLoadRps).toBeGreaterThan(100_000);
    expect(trips.saturated).toBe(true);
  });

  it('fails the same design sharded enough for the writes: it costs too much', () => {
    const source = `${variant(p, toDatabase)}\ncapacity {\n  trips shards 22\n}\n`;
    const failed = failing(p, source);
    expect(failed).toContain('Location updates are writes to the live map, never the database');
    expect(failed).toContain('cost ≤ $10,000/month');
    expect(analysisOf(p, source).nodes.find((n) => n.id === 'trips')!.saturated).toBe(false);
  });

  it('fails trips kept in an eventually consistent NoSQL table', () => {
    const source = variant(p, ['trips   "Trips DB"         [PostgreSQL]        x2', 'trips   "Trips DB"         [AWS DynamoDB]      x2']);
    expect(failing(p, source)).toEqual(['Trips are stored strongly before the rider hears back']);
  });

  it('fails a ride request that waits for the offer queue', () => {
    const source = variant(p, ['    match   ->> offers  : RideOffered d7\n', '    match    -> offers  : RideOffered d7\n    offers  --> match   : ack\n']);
    expect(failing(p, source)).toEqual(["The driver's offer never holds up the rider"]);
  });
});
