# Design: useful HLDs and a system design practice platform

Status: accepted · Owner: gvart · Applies to: language, tooling, web editor

## Goals

1. **Useful high-level designs (HLDs).** A Proschi document can say not only
   what talks to what, but how much traffic flows, how fast and reliable it must
   be, what data lives where, and why the design looks the way it does. From
   that, Proschi produces a complete HLD document and checks the design against
   its own requirements.
2. **A practice platform for system design**, like LeetCode: a problem gives
   use cases, traffic and requirements; you design the system; tests run in the
   browser and tell you, with explanations, whether it holds up.

Both rest on the same three additions: language for scale and requirements, a
deterministic simulation, and executable tests. Everything runs in the browser
and in the CLI; there is no backend in this phase.

Non-goals for this phase: accounts, leaderboards, server-side hidden tests,
benchmark-accurate performance numbers (the simulation teaches orders of
magnitude, not exact figures).

---

## 1. Language additions

All new statements are line-oriented like the rest of the language. New block
statements are top level only, except `test` assertions, which live inside a
`test` block. The parser keeps its rule of never throwing: every problem is a
diagnostic with a position.

### 1.1 Quantities

Several statements take quantities: a number, an optional magnitude, and a unit.

```
quantity  = number [ magnitude ] [ unit ] ;
number    = digit { digit } [ "." digit { digit } ] ;
magnitude = "k" | "m" | "b" ;                     (* ×1e3, ×1e6, ×1e9 *)
unit      = "rps" | "rpm" | "rpd"                 (* requests per second / minute / day *)
          | "ms" | "s" | "%" | "usd/month" ;
```

The unit may be attached (`50ms`, `99.9%`, `100krps`) or separated by one
space (`50 ms`, `100k rps`). Rates are normalised to requests per second
(`rpm` ÷ 60, `rpd` ÷ 86 400), durations to milliseconds. The lexer gains a
`quantity` token for a number directly followed by letters or `%`; plain
integers stay `number` (so `pos 10,-20` is unchanged).

### 1.2 Title with a summary

```
title "URL Shortener" "Turns long URLs into short codes and redirects visitors"
```

The optional second string is the system summary used at the top of the HLD.

### 1.3 Replicas

```
api "Shortener API" [REST API] x3 @links "Creates codes and serves redirects"
```

`x<n>` (n ≥ 1) on a node declaration sets its replica count. Default 1.
Replicas multiply capacity and improve availability (§2), and let the design
survive losing one instance.

### 1.4 `traffic`

```
traffic {
  "Redirect" 100k rps  mix "Cache hit" 90%, "Cache miss" 10%
  "Shorten"  1k rps
}
```

- One line per use case: `"<use case name>" <rate>`.
- Optional `mix` assigns traffic shares to that use case's scenarios by name
  (the full scenario name, as in `A › B` for nested branches). Shares must sum
  to 100% (warning otherwise; they are then normalised). Without `mix`, all
  traffic goes to the first scenario.
- Errors: unknown use case or scenario name (warning), duplicate use case
  line, rate without a rate unit.

### 1.5 `requirements`

```
requirements {
  p99 "Redirect" < 50ms
  p95 < 300ms                       # every use case
  availability "Redirect" >= 99.95%
  availability >= 99.9%             # every use case
  durable "Shorten"
  survive any node failure
  survive failure of cache          # a node id, [Tech], or `any <kind>`
  cost <= 3000 usd/month
}
```

| Requirement | Meaning (evaluated by §2) |
|---|---|
| `p50|p90|p95|p99|p999 ["<use case>"] < <duration>` | Latency percentile of the use case (or every use case with traffic) under its traffic |
| `availability ["<use case>"] >= <percent>` | Computed availability of the use case |
| `durable "<use case>"` | Every success scenario writes to a durable node, synchronously, before the entry request is answered |
| `survive any node failure` | Losing any single node instance keeps every use case working (see §2.5) |
| `survive failure of <selector>` | Same, for the selected nodes only |
| `cost <= <usd/month>` | Sum of replica costs |

Each requirement becomes a test (§3) named after its line, e.g. *p99 of
Redirect < 50 ms*.

### 1.6 `capacity` (overrides)

```
capacity {
  db    20k rps  latency 4ms  availability 99.95%  cost 400 usd/month
  cache 150k rps
}
```

Per-replica overrides of the defaults from §2.1, one line per node id, parts in
any order: a rate, `latency <duration>`, `availability <percent>`,
`cost <usd/month>`, `durable` / `volatile`.

### 1.7 `entity` (data model)

```
entity Url in db "One short code and where it points" {
  code      string  key
  target    string
  createdAt time    index
}
```

- `entity <Name> [in <node id>] ["description"] {` then one field per line:
  `<name> <type> {flag}` with flags `key`, `index`, `unique`, `optional`.
  Types are free identifiers (`string`, `int`, `time`, `uuid`, `json`, …).
- `in <node>` places the entity in a store; a warning if that node is not a
  data store (database, cache, storage, search, queue).

### 1.8 `decision` (trade-offs)

```
decision "Cache redirects in Redis" {
  because "Reads outnumber writes 100:1 and p99 must stay under 50 ms"
  rejected "Read replicas only" "~5 ms per read and 10 replicas at 100k rps"
  rejected "Memcached" "no replication; a node loss empties the cache"
}
decision "Base62 codes from a counter" because "Short, unique, no collisions to retry"
```

`because` (once) and `rejected "<option>" "<reason>"` (any number). Rendered in
the HLD as decision records.

### 1.9 `test` (flow assertions)

Tests check how the design works, in addition to the requirement checks.

```
test "Redirect is served from the cache" {
  "Redirect" calls any cache before any database
  "Redirect" scenario "Cache hit" never calls any database
}
test "Shortening is idempotent-safe" {
  "Shorten" writes db before responding
}
test "Clients only enter through the gateway" {
  no path from client to any database
}
```

Every assertion line in a test must hold. Assertions:

| Assertion | Holds when |
|---|---|
| `U [scenario S] calls X` | some scenario of U (or S) has a step to a node matching X |
| `U [scenario S] every scenario calls X` | every scenario of U calls X |
| `U [scenario S] never calls X` | no scenario of U (or S) calls X |
| `U [scenario S] calls X before Y` | in every scenario that calls Y, X is called earlier; and some scenario calls Y |
| `U [scenario S] writes X before responding` | every success scenario has a synchronous, non-failed step to X before the entry response |
| `U [scenario S] responds <status>` | some scenario's entry response has that status (`201`, or a class `2xx`/`4xx`/`5xx`) |
| `U has scenario S` | the scenario exists |
| `U handles failure of X` | some success scenario of U contains a failed call (`-x`) to X |
| `no path from X to Y` | no connection or step goes directly from a node matching X to a node matching Y |
| `X has replicas >= <n>` | every node matching X has at least n replicas |

`U` is a use case name in quotes. Selectors `X`, `Y`: a node id, `[Tech]`, or
`any <kind>` with kinds from §2.1 (`any cache`, `any database`, `any queue`, …).
Order in a scenario is the sequence order (requests and responses interleaved,
as `frontend/src/dsl/sequence.ts` builds it).

### 1.10 Grammar summary (additions)

```ebnf
title        = "title" , ( string | id ) , [ string ] ;
node         = id , { string | tech | team | position | replicas } ;
replicas     = "x" , integer ;                       (* one token, e.g. x3 *)
traffic      = "traffic" , "{" , { string , quantity , [ "mix" , share , { "," , share } ] } , "}" ;
share        = string , quantity ;                   (* "Cache hit" 90% *)
requirements = "requirements" , "{" , { requirement } , "}" ;
capacity     = "capacity" , "{" , { id , { quantity | "latency" quantity | "availability" quantity | "cost" quantity | "durable" | "volatile" } } , "}" ;
entity       = "entity" , id , [ "in" , id ] , [ string ] , "{" , { id , id , { flag } } , "}" ;
decision     = "decision" , string , ( "because" , string | "{" , { "because" string | "rejected" string string } , "}" ) ;
test         = "test" , string , "{" , { assertion } , "}" ;
```

Highlighting (CodeMirror, landing page, TextMate grammar), completion, the
formatter and the JSON Schema are updated for all of the above.

### 1.11 Parser output

Added to `frontend/src/dsl/types.ts` (names are binding; implementations may
add fields):

```ts
export type Kind =
  | 'client' | 'edge' | 'service' | 'function' | 'cache' | 'database'
  | 'search' | 'analytics' | 'queue' | 'storage' | 'external' | 'other';

export interface Quantity { value: number; unit: 'rps' | 'ms' | '%' | 'usd/month' }

export interface TrafficEntry { useCase: string; rps: number; mix?: { scenario: string; share: number }[]; loc: SourceLoc }

export type Requirement =
  | { kind: 'latency'; percentile: 50 | 90 | 95 | 99 | 99.9; useCase?: string; maxMs: number; loc: SourceLoc }
  | { kind: 'availability'; useCase?: string; minPercent: number; loc: SourceLoc }
  | { kind: 'durable'; useCase: string; loc: SourceLoc }
  | { kind: 'survive'; target: Selector | 'any'; loc: SourceLoc }
  | { kind: 'cost'; maxUsdPerMonth: number; loc: SourceLoc };

export type Selector = { node: string } | { tech: string } | { kind: Kind };

export interface CapacityOverride { node: string; rps?: number; latencyMs?: number; availability?: number; costUsd?: number; durable?: boolean; loc: SourceLoc }

export interface Entity { name: string; store?: string; description?: string; fields: { name: string; type: string; flags: string[] }[]; loc: SourceLoc }

export interface Decision { title: string; because?: string; rejected: { option: string; reason: string }[]; loc: SourceLoc }

export type Assertion =
  | { kind: 'calls'; useCase: string; scenario?: string; target: Selector; quantifier: 'some' | 'every' | 'never'; loc: SourceLoc }
  | { kind: 'before'; useCase: string; scenario?: string; first: Selector; then: Selector; loc: SourceLoc }
  | { kind: 'writesBeforeResponding'; useCase: string; scenario?: string; target: Selector; loc: SourceLoc }
  | { kind: 'responds'; useCase: string; scenario?: string; status: string; loc: SourceLoc }
  | { kind: 'hasScenario'; useCase: string; scenario: string; loc: SourceLoc }
  | { kind: 'handlesFailure'; useCase: string; target: Selector; loc: SourceLoc }
  | { kind: 'noPath'; from: Selector; to: Selector; loc: SourceLoc }
  | { kind: 'replicas'; target: Selector; min: number; loc: SourceLoc };

export interface FlowTest { name: string; assertions: Assertion[]; loc: SourceLoc }

// Diagram gains:
//   summary?: string; traffic: TrafficEntry[]; requirements: Requirement[];
//   capacity: CapacityOverride[]; entities: Entity[]; decisions: Decision[]; tests: FlowTest[]
// DiagramNode gains: replicas: number (default 1)
```

Imported files contribute all of these, like nodes and use cases.

---

## 2. Simulation

A deterministic, analytical model in `frontend/src/sim/` (pure TypeScript, no
DOM): `analyze(diagram, options?) → Analysis`. It runs in milliseconds, so the
editor re-runs it on every change.

This section describes the model as the code implements it today, §7's
refinements included. [How the simulation works](https://gvart.github.io/proschi/model/)
(`frontend/model/index.html`) states every rule with its default numbers,
worked examples and limits; a test recomputes each number on that page from
the code.

### 2.1 Profiles

Every node gets a per-replica profile: kind, read and write capacity, base
latency, availability, monthly cost, durability, consistency, bandwidth and
internet egress price. The tech catalog (`frontend/src/catalog/componentCatalog.ts`,
about 205 techs with aliases) gives each tech its kind and, where it differs
from the kind's, its profile row; `capacity` overrides win. A tech the catalog
does not know is simulated as the kind its name suggests, else the kind of the
closest catalog tech, else a service, never as a client. Defaults (teaching
values):

| Kind | Techs (examples) | reads / replica | writes | latency | availability | cost / month | bandwidth | egress | durable |
|---|---|---|---|---|---|---|---|---|---|
| client | Actor, Browser, Mobile App, shapes with no tech | ∞ | ∞ | 0 | 100% | 0 | 10 MB/s | — | — |
| edge | WAF, AWS WAF, Global Accelerator | 100k | 100k | 2 ms | 99.99% | 50 | 1,000 MB/s | $0.09/GB | no |
| cdn | CloudFront, Fastly, Akamai, Cloudflare, Azure CDN, Cloud CDN | 200k | 200k | 5 ms | 99.99% | 100 | 1,000 MB/s | $0.02/GB | no |
| loadbalancer | AWS Load Balancer (ALB, NLB), nginx, Envoy, HAProxy | 100k | 100k | 2 ms | 99.99% | 50 | 1,000 MB/s | $0.09/GB | no |
| gateway | AWS API Gateway, Azure API Management, Kong, Apigee | 10k | 10k | 10 ms | 99.95% | 100 | 1,000 MB/s | $0.09/GB | no |
| dns | Route53, Azure DNS, Cloud DNS | ∞ | ∞ | 0 | 100% | 0 | 1,000 MB/s | — | no |
| service | Service, REST API, gRPC, Spring Boot, Go, Node.js, ECS, EKS, Kubernetes | 2k | 2k | 10 ms | 99.5% | 100 | 200 MB/s | $0.09/GB | no |
| function | Lambda, Cloud Functions, Azure Functions, Cloud Run | 10k | 10k | 25 ms | 99.95% | 200 | 100 MB/s | $0.09/GB | no |
| cache | Redis, Valkey, ElastiCache, Memcached | 100k | 100k | 1 ms | 99.9% | 150 | 100 MB/s | $0.09/GB | no |
| database (relational) | PostgreSQL, MySQL, Aurora, RDS, SQL Server, Oracle | 20k | 5k per shard | 5 ms | 99.95% | 400 | 100 MB/s | $0.09/GB | yes |
| database (NoSQL) | DynamoDB, Cassandra, ScyllaDB, MongoDB, CockroachDB, Spanner | 20k | 20k | 5 ms | 99.99% | 500 | 100 MB/s | $0.09/GB | yes |
| search | Elasticsearch, OpenSearch, Solr | 3k | 3k | 15 ms | 99.9% | 400 | 100 MB/s | $0.09/GB | yes |
| analytics | BigQuery, Snowflake, Redshift, ClickHouse | 200 | 200 | 500 ms | 99.9% | 300 | 100 MB/s | $0.09/GB | yes |
| queue | Kafka, Kinesis, SQS, SNS, Pub/Sub, RabbitMQ | 50k | 50k | 5 ms | 99.99% | 200 | 100 MB/s | $0.09/GB | yes |
| storage | S3, GCS, Azure Blob, MinIO | 5k | 5k | 30 ms | 99.99% | 50 | 100 MB/s | $0.09/GB | yes |
| external | Stripe, Twilio, SendGrid, third-party APIs | 1k | 1k | 200 ms | 99.9% | 0 | 100 MB/s | — | — |

Annotations, groups and text nodes are ignored.

### 2.2 Load

For each use case U with traffic R and scenario shares m(s): every request
step that gets through (`->`, `->>`) in scenario s adds `R · m(s) · N` to the
target node's reads or writes (§7.2), N being the `x<N>` fan-out. Responses
add nothing, and a failed call (`-x`) adds nothing either: its target is down
in that scenario.

Request utilisation is reads ÷ read capacity plus writes ÷ write capacity, or
the busier of the two for a single-primary store (§7.2). Nodes you run (not
clients, third parties, DNS, object storage or CDNs) also have a bandwidth
utilisation: payload bytes in and out per second over their replicas'
bandwidth. A node's utilisation is the larger of the two; at 100% or more it
is **saturated** and every latency requirement touching it fails.

### 2.3 Latency

- Queueing is M/M/c: each replica of a shard is a server whose service time
  is the base latency (writes that bind a single-primary store queue for its
  one primary). A request waits with the Erlang C probability C, on average
  `base / (c (1 − ρ))`; ρ is capped at 0.95. Mean hop latency:
  `base + C · base / (c (1 − ρ))`, which is `base / (1 − ρ)` for one server.
- A hop's time is a fixed part, half its base latency, plus an exponential
  tail carrying the rest of its mean. Its q-quantile is
  `fixed + tail · ln(1 / (1 − q))`: an idle hop's p99 is 2.8× its mean, and
  the ratio grows with queueing.
- A scenario's critical path is the synchronous requests sent before the
  entry response; a `par` group counts its slowest member; async sends count
  only their own hop; a failed call (`-x`) costs a fixed timeout (1 000 ms,
  or `capacity { n timeout … }`). Transfer time is `N × size / min(bandwidth)`
  and, like a timeout, adds once to every percentile. A path's quantile takes
  every hop at the same quantile (pessimistic for long paths).
- A use case's percentile is the percentile of the mixture of its scenarios:
  the t with `Σ m(s) · P(s ≤ t) = q`, solved by bisection. With 10% cache
  misses, p99 is near the miss path's p90.

### 2.4 Availability

- Node: `A(n) = 1 − (1 − a(n))^replicas(n)`.
- A write to a single-primary store needs its primary: `1 − (1 − a) · 0.1`
  with a replica to fail over to (a tenth of each outage is lost to the
  failover), `a` without one.
- Use case: the product over the distinct nodes on the synchronous path of
  its main scenario (largest share), using the write availability for
  single-primary stores the main path writes to; a node n with a fallback, a
  success scenario that calls n with `-x` and completes without n,
  contributes `1 − (1 − A(n)) · (1 − A(fallback path))`.

### 2.5 Failure injection

For `survive any node failure` (or the selected nodes), for each node n you
run:
- `replicas(n) ≥ 2`: analyse the design again with one replica fewer. It
  passes if n does not saturate and every latency requirement that held still
  holds. Load is spread evenly over shards and keys cannot move between them,
  so on a sharded store this is the shard that lost the replica. A
  single-primary store that loses its primary promotes a replica: write
  capacity stays, reads lose one replica.
- `replicas(n) = 1`: every use case whose success scenarios need n must have a
  success scenario that handles n failing (`-x n`, then completes without n).
  Otherwise it fails: *Losing db (PostgreSQL) breaks "Shorten": add a replica
  or a fallback scenario*.

### 2.6 Durability and cost

- `durable U`: every success scenario has a synchronous, non-failed write to
  a durable node before the entry response (sequence order).
- Cost: `Σ replicas(n) × shards(n) × cost(n)` plus egress: payloads a node you
  run sends to a client or a third party, `GB/month × its egress price`.
  Traffic between your own nodes is free.

### 2.7 Output

`NodeAnalysis` (per node: replicas, shards, read and write load, capacity and
utilisation, bandwidth load, capacity and utilisation, servers and wait
probability, mean latency, availability and write availability, cost and
egress), `ScenarioAnalysis` (share, mean, percentiles), `UseCaseAnalysis`
(rps, scenarios, mixture percentiles, the scenario that dominates each
percentile's tail, availability) and `Analysis` (nodes, use cases, total cost
and egress, single points of failure, warnings); see `frontend/src/sim/analyze.ts`.

---

## 3. Tests

`runTests(diagram, analysis?) → TestResult[]` in `frontend/src/sim/tests.ts`.
Each requirement (§1.5) and each `test` block (§1.9) yields one result:

```ts
export interface TestResult {
  id: string;                      // stable, e.g. "req:3" or "test:Redirect is served from the cache"
  name: string;
  category: 'latency' | 'availability' | 'durability' | 'resilience' | 'cost' | 'flow';
  passed: boolean;
  message: string;                 // what was measured: "p99 of Redirect is 41 ms (limit 50 ms)"
  hint?: string;                   // how to fix it, when failed
  loc?: SourceLoc;                 // the requirement or test line
}
```

Messages always state the measured value and the limit; hints point at the
lever (add replicas, add a cache, add a fallback scenario, move work async).

---

## 4. HLD document

`hld(diagram, analysis?, testResults?) → HldDocument` produces sections, then
renderers write Markdown (with Mermaid) or HTML (with the SVGs from
`proschi render`):

1. **Overview**: title, summary, the architecture diagram.
2. **Requirements**: functional (use cases with descriptions and scenarios),
   non-functional (each requirement with ✅/❌ and the measured value).
3. **Capacity estimates**: traffic table; per node: load, capacity,
   utilisation, replicas, cost; total cost.
4. **Components**: name, tech, kind, team, replicas, responsibility (the node
   description), entities stored.
5. **Data model**: entities with fields and the store they live in.
6. **APIs**: endpoints grouped by `endpointGroup`: method, path, request,
   responses by scenario.
7. **Scenarios**: per use case and scenario: condition, sequence diagram,
   latency, share of traffic.
8. **Decisions**: each decision with rationale and rejected options.
9. **Risks**: failing requirements, saturated or hot nodes (ρ > 0.7), single
   points of failure, scenarios without error handling.

Sections without content are omitted.

---

## 5. Product surfaces

### 5.1 Web editor
- **Analysis panel** (toggle next to Diagram): per-node utilisation bars,
  latency per use case and scenario, availability, cost; nodes on the canvas
  get a small utilisation badge, red when saturated.
- **Tests panel**: requirement and flow test results, click to jump to the line.
- **HLD tab**: the generated HLD document, with "Download Markdown / HTML".

### 5.2 CLI and language server
- `proschi test <file|dir>`: runs requirements and tests; exit 1 on failure;
  `--format text|github|json`.
- `proschi analyze <file>`: prints the capacity table.
- `proschi render --format hld-md|hld-html`.
- The language server reports failing requirements and tests as warnings on
  their lines, and shows load/utilisation in node hovers.

### 5.3 Practice platform (`/practice/`)

A third page next to the landing page and the editor (Vite multi-page, like
`app/`).

- **Problem list**: title, difficulty, tags, status (todo / attempted /
  solved), filters.
- **Problem page**, LeetCode layout: statement on the left (Markdown: context,
  functional requirements, scale, constraints, hints behind a click);
  the editor in the middle with Diagram / Analysis tabs; a test panel at the
  bottom with **Run tests** (all results with messages and hints) and a solved
  state when everything passes. "Show reference solution" after solving, or
  on request with a confirmation.
- **Progress** in localStorage: status and the last source per problem.

Problem format: a folder per problem, `frontend/src/practice/problems/<id>/`,
with `problem.md` (front matter: title, summary, difficulty, tags, order,
hints; body: the Markdown statement), `given.proschi` (traffic, requirements,
tests, fixed nodes such as the client), `starter.proschi` and
`solution.proschi` (both start with `import "problem.proschi"`), and optional
`wrong/<name>.proschi` designs that must fail the tests named in their
`# expect-fail:` lines. CI checks the solution passes every test
(`proschi problem check`; details in [PRACTICE.md](../PRACTICE.md)).

The editor resolves `import "problem.proschi"` to `given`, so the problem's
traffic, requirements and tests apply to the solution without being editable.
All tests are visible (browser-only; hidden tests need the later backend).

Starter set (12): URL shortener, Pastebin, Rate limiter (easy); News feed,
Chat, Notification fan-out, File storage, Search autocomplete, Ride matching
(medium); Payments with idempotency, Ticket booking without double-booking,
Video upload and streaming (hard). Each problem's tests encode its key
insight (for example: the payment is charged only after the idempotency key
is written; the cache is read before the database).

---

## 6. Delivery plan

| Wave | Work | Depends on |
|---|---|---|
| 1 | Language (§1): lexer, parser, types, highlighting, formatter, schema, docs | — |
| 2a | Simulation and tests (§2, §3): `frontend/src/sim/`, Analysis and Tests panels, `proschi test`/`analyze`, LSP diagnostics | wave 1 |
| 2b | HLD (§4) and the practice platform shell (§5.3: pages, problem format, runner, progress) with two sample problems | wave 1; consumes §2/§3 types |
| 3 | The 12 problems with reference solutions passing all tests; landing page section; release | wave 2 |

---

## 7. Version 2: closing the gaps found while writing problems

Writing the twelve problems showed where checks were too coarse to tell a good
design from a lucky one. This section extends §1–§3; everything above still
holds unless stated here. Types are in `frontend/src/dsl/types.ts` (marked
§7.x).

### 7.1 Assertions

| Assertion | Holds when |
|---|---|
| `U [scenario S] never waits for X` | no synchronous (`->`) call to a node matching X happens before U's entry response, in any scenario (or S). Async sends (`->>`) and calls after the response are fine. It passes when X is never called; add `calls X` to require the call. |
| `U [scenario S] calls Y after X` | in every scenario that calls both, the **last** call to Y comes after the **first** call to X; and some scenario calls both. (Unlike `before`, which compares first calls; this expresses "book the ledger after the gateway" even when the same database was read earlier.) |
| `[in U] X calls Y` | some step is **sent by** a node matching X to a node matching Y (in U, or in any use case) |
| `[in U] X never calls Y` | no step is sent by X to Y. E.g. `any service never calls blobs`: bytes never pass through a server. |
| `U starts at X` | U's entry request is sent by a node matching X (e.g. `"Retry charge" starts at any queue`) |

**Selector unions:** `X or Y [or Z]` anywhere a selector is allowed
(`never calls any cache or any database`).

**Consistency selectors:** `any strong store`, `any eventual store` (§7.4).

**Messages:** when a use case or scenario is missing, a test reports it once,
not once per assertion.

### 7.2 Reads, writes and single-primary stores

- Every request step has an **access**: `write` if the HTTP method is POST,
  PUT, PATCH or DELETE, or the label's first word (case-insensitive) is one of
  INSERT, UPDATE, UPSERT, DELETE, PUT, SET, WRITE, APPEND, INCR, DECR, LPUSH,
  RPUSH, ZADD, HSET, GEOADD, PUBLISH, SEND, ENQUEUE, PRODUCE, CHARGE, CREATE,
  PUTITEM, UPDATEITEM, DELETEITEM, BATCHWRITEITEM, INCRBY, HINCRBY, SADD, XADD,
  MSET, SAVE, STORE, UPLOAD, COMMIT, RECORD, MARK, RESERVE, HOLD, BOOK, EMIT,
  NOTIFY; `read` otherwise (GET, SELECT, QUERY, SCAN, FETCH, LOOKUP, GEOSEARCH, …).
- `durable U` and `writes X before responding` count **write** steps only. A
  SELECT no longer counts as a durable write.
- Profiles gain separate read and write capacity and a **write scaling** rule:
  single-primary stores (relational databases: PostgreSQL, MySQL, Aurora, RDS,
  SQL Server, Oracle, MariaDB, Cloud SQL, Azure SQL…) scale **reads** with
  replicas but **writes only with shards**; partitioned stores (DynamoDB,
  Cassandra, Bigtable, Spanner, Cosmos DB, Kafka, caches) scale both with
  replicas. Defaults: relational 20k reads / 5k writes per node; NoSQL 20k /
  20k; cache 100k / 100k.
- `capacity { db reads 30k rps  writes 8k rps  shards 4 }` overrides; `rps`
  alone still sets both.
- Utilisation is computed separately for reads and writes; a node is saturated
  when either is. For a single-primary store the node's utilisation is the
  busier side (replicas serve reads, primaries take writes). Every other node
  serves both on the same replicas, so its utilisation is the sum of the two
  shares (total load ÷ capacity when read and write capacity are equal, as in
  §2.2).
- A request to a **queue** is always a write (publish/enqueue, any arrow),
  whatever its label: `api ->> jobs : OrderPlaced` counts against the queue's
  write capacity and as a durable write. Everything else follows the step's
  `access`.
- `shards` multiplies a store into independent partitions, each with its own
  primary and `x<n>` replicas: reads scale with replicas × shards, single-primary
  writes with shards, partitioned writes with replicas × shards, and the node
  costs replicas × shards instances.

### 7.3 Fan-out and payload size

- A label may start with `x<N>` to say the step happens N times per request:
  `worker -> feeds : x200 LPUSH feed:{follower}`. Load counts N calls; latency
  counts the step once (assumed batched or parallel).
- A label may start with `~<size>` (`~2MB`, `~500KB`, `~4GB`), before or after
  `x<N>`: the payload size. It adds **transfer time** `size ÷ bandwidth` to the
  hop (bandwidth per replica: client 10 MB/s, edge/cdn 1 000 MB/s, service
  200 MB/s, storage 100 MB/s, others 100 MB/s; override `bandwidth 500 MB/s`)
  and **egress cost** for data leaving storage or a CDN:
  `rps × share × multiplier × size × 2 592 000 s/month × price`, with prices
  storage $0.09/GB, cdn $0.02/GB, others $0 (override `egress 0.05 usd/GB`).
  Egress appears in the cost total and per node in the Analysis panel.
- Transfer time uses the slower of the two ends' bandwidth (the client's
  10 MB/s bounds both uploads and downloads). A read's payload leaves its
  target (the answer), a write's leaves its sender; 1 GB = 10⁹ bytes.
- Since then (see §2): egress is charged on payloads a node you run sends to
  a client or a third party ($0.09/GB, a CDN $0.02/GB), not on every byte
  leaving storage; a fan-out of N moves N payloads; and nodes you run
  saturate when their payloads exceed their bandwidth.

### 7.4 Consistency

- Every data store has a consistency: `strong` (relational databases,
  Spanner, etcd-like, queues for ordering) or `eventual` (caches, Cassandra,
  DynamoDB default reads, Elasticsearch, CDNs, object storage listings).
  Override with `capacity { table consistency strong }`.
- Selectors `any strong store` / `any eventual store` match data stores by
  consistency (data store kinds only: CDNs cache content but are not matched), so a test can require `"Hold seat" writes any strong store
  before responding` and `"Hold seat" never calls any eventual store`.
- Time (TTL, expiry, staleness windows) stays out of the model for now; model
  expiry as a scenario.

### 7.5 Edge sub-kinds

`edge` splits into `cdn` (CloudFront, Azure CDN, Cloud CDN, Front Door),
`loadbalancer` (AWS Load Balancer, GCP Load Balancing), `gateway` (AWS API
Gateway, Azure API Management) and `dns` (Route53, Azure DNS, Cloud DNS).
`any edge` still matches all four. Profiles: cdn 200k rps / 5 ms / 99.99% /
$100; loadbalancer 100k / 2 ms / 99.99% / $50; gateway 10k / 10 ms / 99.95% /
$100; dns: not on the request path (ignored for latency, 100% available).

### 7.6 Requirements and fallbacks

- Per-scenario latency: `p99 "Checkout" scenario "Replay" < 100ms` measures that
  scenario's own percentile, whatever its traffic share.
- Fallback rule refined: a scenario is a fallback for n if it calls n with
  `-x` **before** the entry response and has no successful synchronous call to
  n before the entry response; calls to n after responding (a background
  retry) no longer cancel the fallback. When the `-x` itself comes after the
  entry response (the use case answers at once and a worker does the rest),
  the whole scenario is the window: it is a fallback if it has no successful
  synchronous call to n at all.
- DNS is left out of failure injection and single points of failure, like
  clients and external systems.

### 7.7 Delivery

| Wave | Work |
|---|---|
| A | Parser and tooling for §7.1 syntax, §7.3 label prefixes, §7.2/§7.3/§7.4 capacity keys, §7.6 per-scenario latency; highlighting, formatter, schema, docs |
| B | Simulation for §7.1–§7.6 (assertion evaluation, access classification, read/write capacity and write scaling, fan-out, transfer time and egress, consistency, edge sub-kinds in `dsl/kinds.ts` and profiles, fallback rule, message dedup) |
| C | Revise the 12 problems to use the new checks so the key insights are enforced precisely (after A and B) |
