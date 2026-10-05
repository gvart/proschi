import { describe, expect, it } from 'vitest';
import { parse } from '../dsl/parser';
import { defaultEngine } from '../hld/engine';
import { problems } from '../practice/catalog';
import { analyze, runTests } from '../sim';
import { reviewRequestProblem, type DesignReview, type DesignReviewRequest } from './contract';
import { practiceReviewInput } from './practice';
import { buildReviewRequest } from './request';
import { ruleReviewer } from './reviewer';
import { reviewDesign } from './rules';

/** The request the page builds for a design in the editor, checked against the contract the Worker validates with. */
function requestFor(source: string): DesignReviewRequest {
  const parsed = parse(source);
  const errors = parsed.diagnostics.some((d) => d.severity === 'error');
  const analysis = errors ? undefined : analyze(parsed.diagram);
  const results = analysis ? runTests(parsed.diagram, analysis) : [];
  const passed = results.filter((r) => r.passed).length;
  const run = errors ? { blocked: 'errors' as const, results: [], passed: 0, solved: false } : { results, passed, solved: results.length > 0 && passed === results.length };
  const request = buildReviewRequest({ source, parsed, analysis, run });
  expect(reviewRequestProblem(JSON.parse(JSON.stringify(request)))).toBeUndefined();
  return request;
}

const review = (source: string): DesignReview => reviewDesign(requestFor(source));
const titles = (r: DesignReview) => r.issues.map((i) => `${i.severity}: ${i.title}`);
const find = (r: DesignReview, title: RegExp) => r.issues.find((i) => title.test(i.title));

/** A client, an API and a database, with the API's replicas and the traffic as parameters. */
const api = ({ replicas = 'x2', rps = '500 rps', extra = '' } = {}) => `
user "User" [Actor]
api  "API"  [REST API] ${replicas}
db   "DB"   [PostgreSQL] x2
${extra}
traffic {\n  "Read" ${rps}\n}
usecase "Read" {
  user -> api : GET /items
  api  -> db  : SELECT items
  db  --> api : rows
  api --> user : 200
}
`;

describe('rule reviewer: diagnostics', () => {
  it('lists parse errors first and says nothing else can be checked', () => {
    const r = review(`${api()}\nx [Redis]\nx [Redis]\n`);
    expect(r.issues[0]).toMatchObject({ severity: 'critical', title: expect.stringMatching(/^Error on line \d+/) });
    expect(r.summary).toMatch(/1 error; fix it first/);
    expect(r.suggestions[0]).toMatch(/Fix the error/);
    expect(r.by).toBe('rules');
  });
});

describe('rule reviewer: capacity', () => {
  it('reports a saturated node with the use case that loads it and the replicas that fix it', () => {
    const r = review(api({ rps: '5k rps' }));
    const issue = find(r, /^api is saturated at 125%/)!;
    expect(issue).toMatchObject({ severity: 'critical', nodeId: 'api' });
    expect(issue.detail).toMatch(/All of it comes from "Read" 5k rps/);
    expect(r.suggestions[0]).toMatch(/Run api \(REST API\) as x4/);
    expect(r.summary).toMatch(/Most pressing: api is saturated/);
  });

  it('reports a node close to saturation as major', () => {
    const r = review(api({ rps: '3.4k rps' }));
    expect(find(r, /^api is close to saturation at 85%/)).toMatchObject({ severity: 'major', nodeId: 'api' });
  });

  it('praises headroom when every node is under 70%', () => {
    const r = review(api({ rps: '1k rps' }));
    expect(r.issues.filter((i) => /saturat/.test(i.title))).toEqual([]);
    expect(r.strengths.join(' ')).toMatch(/Every node has headroom under this traffic; the busiest, api, runs at 25%/);
  });
});

describe('rule reviewer: failures', () => {
  it('reports a single-instance node a use case needs as a single point of failure', () => {
    const r = review(api({ replicas: '' }));
    expect(find(r, /^api is a single point of failure$/)).toMatchObject({ severity: 'major', nodeId: 'api', detail: expect.stringContaining('"Read" cannot complete without it') });
    expect(r.suggestions).toContain('Run api with a second replica (x2).');
  });

  it('praises a design without one', () => {
    expect(review(api()).strengths).toContain('No single point of failure: every node a use case needs has a replica or a fallback.');
  });

  it('names the weakest node when availability is under the requirement', () => {
    const r = review(api({ replicas: '', extra: 'requirements {\n  availability "Read" >= 99.9%\n}' }));
    const issue = find(r, /^Availability of "Read" is 99\.\d+%, under the required 99\.9%/)!;
    expect(issue).toMatchObject({ severity: 'critical', nodeId: 'api' });
    expect(issue.detail).toMatch(/The weakest is api \(REST API\) at 99\.5% with 1 replica/);
    // The finding explains the failing requirement, so it is not listed again.
    expect(titles(r).some((t) => t.includes('Fails: availability'))).toBe(false);
  });
});

describe('rule reviewer: latency', () => {
  const cached = (limit: string) =>
    api({ extra: `requirements {\n  p99 "Read" < ${limit}\n}` });

  it('reports a p99 over its limit with the slowest hop', () => {
    const r = review(cached('20ms'));
    const issue = find(r, /^p99 of "Read" is [\d.]+ ms, over its 20 ms limit$/)!;
    expect(issue).toMatchObject({ severity: 'critical', nodeId: 'api' });
    expect(issue.detail).toMatch(/Its slowest hop is user -> api \(REST API\), [\d.]+ ms on average, on a path of 2 hops/);
    expect(r.suggestions.join(' ')).toMatch(/Shorten the "Read" path/);
    expect(titles(r).some((t) => t.startsWith('critical: Fails: p99'))).toBe(false);
  });

  it('reports a p99 close to its limit as minor, without a next step', () => {
    const p99 = requestFor(cached('1s')).metrics!.useCases[0].p99Ms;
    const r = review(cached(`${Math.ceil(p99 / 0.9)}ms`));
    expect(find(r, /close to its \d+ ms limit$/)).toMatchObject({ severity: 'minor' });
    expect(r.suggestions).toEqual([]);
  });

  it('praises a p99 well under its limit', () => {
    expect(review(cached('1s')).strengths.join(' ')).toMatch(/Latency has room to spare: p99 of "Read" is [\d.]+ ms \(limit 1000 ms\)/);
  });
});

describe('rule reviewer: cost', () => {
  it('reports a design over budget with its largest items', () => {
    const r = review(api({ extra: 'requirements {\n  cost <= 100 usd/month\n}' }));
    const issue = find(r, /^Costs \$\d[\d,]*\/month, over the \$100\/month budget$/)!;
    expect(issue.severity).toBe('critical');
    expect(issue.detail).toMatch(/The largest items: db \$\d+ .*api \$200 \(\d+%, x2\)/);
  });

  it('points out replicas the load does not need, with the saving', () => {
    const r = review(api({ replicas: 'x10', rps: '1k rps' }));
    const issue = find(r, /^api has more replicas than its load needs$/)!;
    expect(issue).toMatchObject({ severity: 'info', nodeId: 'api' });
    expect(issue.detail).toMatch(/runs x10 at 5%\. x2 would stay under 70% even with one replica lost/);
    expect(issue.detail).toMatch(/saving about \$800 a month/);
  });

  it('praises a cost well under budget', () => {
    expect(review(api({ extra: 'requirements {\n  cost <= 10000 usd/month\n}' })).strengths.join(' ')).toMatch(/Cost is \$\d[\d,]*\/month, \d+% of the \$10,000\/month budget/);
  });
});

describe('rule reviewer: flows', () => {
  const cache = (fallback: boolean) => `
user  "User"  [Actor]
api   "API"   [REST API] x2
cache "Cache" [Redis] x2
db    "DB"    [PostgreSQL] x2
traffic {\n  "Read" 1k rps mix "Hit" 90%, "Miss" 10%\n}
usecase "Read" {
  user -> api : GET /items
  ${
    fallback
      ? `alt "Hit" {
    api -> cache : GET items
    cache --> api : rows
  } alt "Miss" {
    api -> cache : GET items
    cache --> api : nil
    api -> db : SELECT items
    db --> api : rows
  } alt "Cache down" {
    api -x cache : GET items
    api -> db : SELECT items
    db --> api : rows
  }`
      : `api -> cache : GET items
  alt "Hit" {
    cache --> api : rows
  } alt "Miss" {
    cache --> api : nil
    api -> db : SELECT items
    db --> api : rows
  }`
  }
  api --> user : 200
}
`;

  it('reports a cache whose outage is an outage of the use case', () => {
    const r = review(cache(false));
    const issue = find(r, /^No fallback when cache is down$/)!;
    expect(issue).toMatchObject({ severity: 'minor', nodeId: 'cache' });
    expect(issue.detail).toMatch(/no scenario of "Read" calls it with -x/);
  });

  it('praises a fallback scenario instead', () => {
    const r = review(cache(true));
    expect(find(r, /No fallback/)).toBeUndefined();
    expect(r.strengths.join(' ')).toMatch(/Fallback scenarios keep requests working through a failure: "Read" without cache/);
  });

  const notify = (arrow: string) => `
user  "User"  [Actor]
api   "API"   [REST API] x2
db    "DB"    [PostgreSQL] x2
email "Mailer" [Email Service]
traffic {\n  "Sign up" 100 rps\n}
requirements {\n  durable "Sign up"\n}
usecase "Sign up" {
  user -> api : POST /users
  api  -> db  : INSERT user
  db  --> api : ok
  api ${arrow} email : send welcome
  api --> user : 201
}
`;

  it('reports a response that waits for a notification provider', () => {
    const r = review(notify('->'));
    const issue = find(r, /^"Sign up" waits for email on the request path$/)!;
    expect(issue).toMatchObject({ severity: 'minor', nodeId: 'email' });
    expect(issue.detail).toMatch(/api -> email \(Email Service\) takes [\d.]+ ms on average/);
  });

  it('praises the same call sent with ->>', () => {
    const r = review(notify('->>'));
    expect(find(r, /waits for email/)).toBeUndefined();
    expect(r.strengths.join(' ')).toMatch(/Work is kept off the request path with ->> \(api ->> email in "Sign up"\)/);
    expect(r.strengths.join(' ')).toMatch(/"Sign up" stores its write durably before answering/);
  });

  it('reports a write acknowledged before it reaches durable storage', () => {
    const r = review(`
user "User" [Actor]
api  "API"  [REST API] x2
db   "DB"   [PostgreSQL] x2
traffic {\n  "Save" 100 rps\n}
requirements {\n  durable "Save"\n}
usecase "Save" {
  user -> api : POST /notes
  api ->> db  : INSERT note
  api --> user : 201
}
`);
    const issue = find(r, /^"Save" answers before its write is stored$/)!;
    expect(issue).toMatchObject({ severity: 'major', nodeId: 'db' });
    expect(issue.detail).toMatch(/its write to db \(PostgreSQL\) is sent with ->>/);
    // It explains the durability requirement's failure, which is not listed again.
    expect(titles(r).some((t) => t.includes('Fails: Save is durable'))).toBe(false);
  });

  it('reports a node no use case uses', () => {
    const r = review(api({ extra: 'search "Search" [Elasticsearch] x2' }));
    const issue = find(r, /^search is not used by any use case$/)!;
    expect(issue).toMatchObject({ severity: 'minor', nodeId: 'search' });
    expect(issue.detail).toMatch(/yet it costs \$\d[\d,]*\/month/);
  });
});

describe('rule reviewer: tests', () => {
  it('explains each failing test with its own message and hint', () => {
    const r = review(api({ extra: 'test "Reads answer 204" {\n  "Read" responds 204\n}' }));
    const issue = find(r, /^Fails: Reads answer 204$/)!;
    expect(issue.severity).toBe('critical');
    expect(issue.detail).toMatch(/^A flow test fails: .*200/);
    expect(r.summary).toMatch(/^0 of 1 tests pass\. Most pressing: Fails: Reads answer 204\./);
  });

  it('reports a use case the traffic and the tests need but the design lacks, once', () => {
    const r = review(api({ extra: 'traffic {\n  "Write" 10 rps\n}\nrequirements {\n  p99 "Write" < 100ms\n}\ntest "Writes" {\n  "Write" responds 201\n}' }));
    const missing = r.issues.filter((i) => /Write/.test(i.title) || /Write/.test(i.detail));
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ severity: 'critical', title: 'The use case "Write" is missing' });
    expect(missing[0].detail).toMatch(/Its traffic is ignored, and 2 tests fail because of it/);
    expect(r.suggestions[0]).toBe('Add usecase "Write" { … } with the steps it takes through your nodes.');
  });

  it('sums up a design that passes everything', () => {
    const r = review(api({ extra: 'requirements {\n  p99 "Read" < 1s\n}' }));
    expect(r.summary).toBe('All 1 tests pass, and the simulation shows no critical or major issue.');
    expect(r.strengths[0]).toBe('All 1 tests pass.');
  });
});

describe('rule reviewer on the practice catalog', () => {
  it('reviews every starter, solution and wrong design without throwing, the same way twice, and never fails a solution', async () => {
    let reviewed = 0;
    for (const problem of problems) {
      const designs = [problem.starter, problem.solution, ...(problem.wrong ?? []).map((w) => w.source)];
      for (const source of designs) {
        const request = buildReviewRequest(practiceReviewInput(problem, source, defaultEngine));
        expect(reviewRequestProblem(JSON.parse(JSON.stringify(request)))).toBeUndefined();
        const result = await ruleReviewer.review(request);
        expect(result.summary.length).toBeGreaterThan(0);
        expect(result.suggestions.length).toBeLessThanOrEqual(3);
        expect(reviewDesign(request)).toEqual(result);
        expect(JSON.stringify(result)).not.toMatch(/undefined|NaN|Infinity/);
        reviewed++;
      }
      // The reference solution passes every test: nothing critical or major to say about it.
      const solution = reviewDesign(buildReviewRequest(practiceReviewInput(problem, problem.solution, defaultEngine)));
      expect(solution.issues.filter((i) => i.severity === 'critical' || i.severity === 'major'), problem.id).toEqual([]);
      expect(solution.summary, problem.id).toMatch(/^All \d+ tests pass/);
    }
    expect(reviewed).toBeGreaterThan(problems.length * 2);
  });

  it('finds what is missing in the url-shortener starter', async () => {
    const shortener = problems.find((p) => p.id === 'url-shortener')!;
    const r = await ruleReviewer.review(buildReviewRequest(practiceReviewInput(shortener, shortener.starter, defaultEngine)));
    expect(titles(r)).toEqual(
      expect.arrayContaining(['critical: The use case "Redirect" is missing', 'critical: Fails: Shorten is durable', 'major: api is a single point of failure']),
    );
  });
});
