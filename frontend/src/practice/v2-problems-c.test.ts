import { describe, expect, it } from 'vitest';
import { defaultEngine } from '../hld/engine';
import { findProblem } from './problems';
import { parseSolution, runTests } from './workspace';
import type { Problem } from './types';

/**
 * Plausible wrong designs for the payments, ticket-booking and
 * video-streaming problems (docs/design/hld-and-practice.md §7): each is the
 * reference solution with one mistake, and must fail the named test or
 * requirement while the reference passes it.
 */

const problem = (id: string): Problem => {
  const p = findProblem(id);
  if (!p) throw new Error(`no problem ${id}`);
  return p;
};

/** The solution with each `[from, to]` replaced once; every `from` must be there. */
function variant(source: string, ...edits: [string, string][]): string {
  let out = source;
  for (const [from, to] of edits) {
    expect(out, `variant edit not found: ${from}`).toContain(from);
    out = out.replace(from, to);
  }
  return out;
}

/** Names of the failed tests and requirements of a design (which must parse and run). */
function failures(p: Problem, source: string): string[] {
  const run = runTests(parseSolution(p, source), defaultEngine);
  expect(run.blocked).toBeUndefined();
  return run.results.filter((r) => !r.passed).map((r) => r.name);
}

interface Case {
  name: string;
  edits: [string, string][];
  fails: string;
}

function check(id: string, cases: Case[]) {
  const p = problem(id);
  describe(id, () => {
    it('reference solution passes every check the variants rely on', () => {
      expect(failures(p, p.solution)).toEqual([]);
    });
    it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c: Case) => {
      expect(failures(p, variant(p.solution, ...c.edits))).toContain(c.fails);
    });
  });
}

check('payments', [
  {
    name: 'idempotency keys in Redis instead of a strong store',
    edits: [['intents "Payment Intents" [PostgreSQL]', 'intents "Payment Intents" [Redis]']],
    fails: 'The payment is recorded in a strong store before the card is charged',
  },
  {
    name: 'check-then-insert: a replay only reads, so it is not durable',
    edits: [['api     -> intents : INSERT intent ON CONFLICT (idempotencyKey) DO NOTHING RETURNING *', 'api     -> intents : SELECT intent WHERE idempotencyKey = chk_7f3a']],
    fails: 'Checkout is durable',
  },
  {
    name: 'marks the payment succeeded before booking the ledger',
    edits: [
      [
        `    api      -> ledger  : APPEND debit and credit entries for pay_81
    ledger  --> api     : ok
    api      -> intents : UPDATE status succeeded, store response
    intents --> api     : ok`,
        `    api      -> intents : UPDATE status succeeded, store response
    intents --> api     : ok
    api      -> ledger  : APPEND debit and credit entries for pay_81
    ledger  --> api     : ok`,
      ],
    ],
    fails: 'The payment is marked succeeded only once the money is booked',
  },
  {
    name: 'a replay asks the gateway for the charge instead of the stored result (slow)',
    edits: [
      [
        `    intents --> api     : conflict, stored response
`,
        `    intents --> api     : conflict, stored response
    api      -> gateway : GET /charges/chk_7f3a
    gateway --> api     : 200 succeeded
`,
      ],
    ],
    fails: 'p99 of Checkout scenario Replay < 100 ms',
  },
  {
    name: 'a scheduler polls for pending payments instead of a queue',
    edits: [
      [
        `  retries  -> worker  : RetryCharge {"idempotencyKey": "chk_7f3a"}
  worker   -> intents : SELECT intent FOR UPDATE`,
        `  worker   -> intents : SELECT pending intent FOR UPDATE SKIP LOCKED`,
      ],
      ['  worker  --> retries : ack\n', ''],
    ],
    fails: 'Pending charges are retried from a queue with the same key',
  },
]);

check('ticket-booking', [
  {
    name: 'the hold checks the seat map cache before writing',
    edits: [
      [
        '  lb  -> api : POST /events/e1/holds\n',
        `  lb  -> api : POST /events/e1/holds
  api -> cache : GET seatmap:e1
  cache --> api : A-12 free
`,
      ],
    ],
    fails: 'A strong store, not the cache, decides who holds a seat',
  },
  {
    name: 'holds in DynamoDB (eventually consistent)',
    edits: [['db    "Seats DB"      [PostgreSQL]', 'db    "Seats DB"      [DynamoDB]']],
    fails: 'A strong store, not the cache, decides who holds a seat',
  },
  {
    name: 'books the seat first, then charges',
    edits: [
      [
        `    db       --> api      : valid
    api       -> payments : POST /charges Idempotency-Key h-77
    payments --> api      : 201 approved
    api       -> db       : UPDATE seat SET booked WHERE holdId = h-77; INSERT booking
    db       --> api      : 1 row
`,
        `    db       --> api      : valid
    api       -> db       : UPDATE seat SET booked WHERE holdId = h-77; INSERT booking
    db       --> api      : 1 row
    api       -> payments : POST /charges Idempotency-Key h-77
    payments --> api      : 201 approved
`,
      ],
    ],
    fails: 'A seat is booked only once it is paid',
  },
  {
    name: 'scales the relational database with read replicas instead of shards',
    edits: [
      ['db    "Seats DB"      [PostgreSQL]        x2', 'db    "Seats DB"      [PostgreSQL]        x4'],
      ['capacity {\n  db shards 2\n}\n', ''],
    ],
    fails: 'p99 of Hold seat < 200 ms',
  },
]);

check('video-streaming', [
  {
    name: 'uploads the file through the API',
    edits: [
      ['  creator -> lb      : POST /videos json {"title": "My trip", "size": 2000000000}', '  creator -> lb      : ~2GB POST /videos json {"title": "My trip"}'],
      ['  lb      -> api     : POST /videos\n', '  lb      -> api     : ~2GB POST /videos\n  api     -> bucket  : ~2GB PUT /originals/v-9.mp4\n  bucket --> api     : 200\n'],
      ['  creator -> bucket  : ~2GB PUT /originals/v-9.mp4\n', ''],
      ['  bucket ->> jobs    : ObjectCreated {"key": "originals/v-9.mp4"}\n  bucket --> creator : 200\n', '  api ->> jobs : ObjectCreated {"key": "originals/v-9.mp4"}\n'],
    ],
    fails: 'The file goes straight to object storage, never through a server',
  },
  {
    name: 'uploads through the API: the upload request carries 2 GB',
    edits: [['  creator -> lb      : POST /videos json {"title": "My trip", "size": 2000000000}', '  creator -> lb      : ~2GB POST /videos json {"title": "My trip"}']],
    fails: 'p99 of Upload video < 1000 ms',
  },
  {
    name: 'transcodes while the creator waits',
    edits: [['  db     --> api     : ok\n', '  db     --> api     : ok\n  api     -> transcoder : transcode v-9\n  transcoder --> api : renditions\n']],
    fails: 'Transcoding is queued, never in the request path',
  },
  {
    name: 'the API hands jobs to the transcoder directly, without a queue',
    edits: [
      ['  jobs        -> transcoder : ObjectCreated {"key": "originals/v-9.mp4"}', '  api         -> transcoder : POST /jobs {"key": "originals/v-9.mp4"}'],
      ['  transcoder --> jobs       : ack', '  transcoder --> api        : 202'],
    ],
    fails: 'Transcoding is queued, never in the request path',
  },
  {
    name: 'viewers read segments straight from storage: egress blows the budget',
    edits: [
      ['bucket "Video Storage"  [AWS S3]            x2', 'bucket "Video Storage"  [AWS S3]            x4'],
      [
        `  viewer -> cdn : ~4MB GET /hls/v-9/1080p/00042.ts

  alt "Edge hit" when "the segment is cached at the edge" {
    cdn --> viewer : 200 video/MP2T
  } alt "Edge miss" when "first request for the segment at this edge" {
    cdn     -> bucket : ~4MB GET /hls/v-9/1080p/00042.ts
    bucket --> cdn    : 200
    cdn    --> viewer : 200 video/MP2T
  }`,
        `  viewer  -> bucket : ~4MB GET /hls/v-9/1080p/00042.ts
  bucket --> viewer : 200 video/MP2T`,
      ],
    ],
    fails: 'cost ≤ $2,500,000/month',
  },
  {
    name: 'a load balancer, not a CDN, in front of storage',
    edits: [
      [
        `  viewer -> cdn : ~4MB GET /hls/v-9/1080p/00042.ts

  alt "Edge hit" when "the segment is cached at the edge" {
    cdn --> viewer : 200 video/MP2T
  } alt "Edge miss" when "first request for the segment at this edge" {
    cdn     -> bucket : ~4MB GET /hls/v-9/1080p/00042.ts
    bucket --> cdn    : 200
    cdn    --> viewer : 200 video/MP2T
  }`,
        `  viewer  -> lb     : ~4MB GET /hls/v-9/1080p/00042.ts
  lb      -> bucket : ~4MB GET /hls/v-9/1080p/00042.ts
  bucket --> lb     : 200
  lb     --> viewer : 200 video/MP2T`,
      ],
    ],
    fails: 'Segments are served by a CDN, with storage as its origin',
  },
]);
