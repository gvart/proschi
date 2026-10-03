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
| `no path from X to Y` | no chain of architecture connections leads from a node matching X to one matching Y |
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

### 2.1 Profiles

Every node gets a per-replica profile: kind, capacity (rps), base latency (ms),
availability, monthly cost, and whether it is durable. Profiles come from a
table keyed by tech stack, falling back to the component type; `capacity`
overrides win. Defaults (teaching values, documented in the UI as such):

| Kind | Techs (examples) | rps / replica | latency | availability | cost / month | durable |
|---|---|---|---|---|---|---|
| client | Actor, shapes with no tech | ∞ | 0 | 100% | 0 | — |
| edge | CloudFront, Load Balancer, Route53, API Gateway, Front Door, CDN | 100k | 2 ms | 99.99% | 50 | no |
| service | REST API, gRPC, GraphQL, WebSocket, EC2, ECS, EKS, Fargate, VMs | 2k | 10 ms | 99.5% | 100 | no |
| function | Lambda, Cloud Functions, Azure Functions, Cloud Run, App Engine | 10k | 25 ms | 99.95% | 200 | no |
| cache | Redis, ElastiCache, Memcached, Hazelcast, Aerospike, Azure Cache | 100k | 1 ms | 99.9% | 150 | no |
| database | PostgreSQL, MySQL, Aurora, RDS, SQL Server, Oracle, Cloud SQL, MariaDB | 5k | 5 ms | 99.95% | 400 | yes |
| database (NoSQL) | DynamoDB, Cassandra, MongoDB, Cosmos DB, Bigtable, Firestore, Spanner | 20k | 5 ms | 99.99% | 500 | yes |
| search | Elasticsearch | 3k | 15 ms | 99.9% | 400 | yes |
| analytics | BigQuery, InfluxDB, TimescaleDB | 200 | 500 ms | 99.9% | 300 | yes |
| queue | Kafka, SQS, SNS, Kinesis, Pub/Sub, RabbitMQ, Service Bus, … | 50k | 5 ms | 99.99% | 200 | yes |
| storage | S3, Blob Storage, Cloud Storage, EFS, EBS | 5k | 30 ms | 99.99% | 50 | yes |
| external | Payment Gateway, Email/SMS Service, Auth Service, Third Party API | 1k | 200 ms | 99.9% | 0 | — |

Annotations, groups and text nodes are ignored.

### 2.2 Load

For each use case U with traffic R and scenario shares m(s):
every request step (`->`, `->>`, `-x`) in scenario s adds `R · m(s)` to the
target node's load. Responses add nothing. Use cases without traffic add no
load but are still checked for structure.

Utilisation `ρ(n) = load(n) / (rps(n) · replicas(n))`. A node with `ρ ≥ 1` is
**saturated**: every latency requirement touching it fails, with the message
naming the node and its load.

### 2.3 Latency

- Hop latency: `base(n) / (1 − min(ρ(n), 0.95))` (queueing grows sharply near
  saturation).
- Scenario mean latency: the sum of hop latencies over the **synchronous**
  critical path of the entry request: sync requests (`->`) count; a `par` group
  counts its slowest member; async sends (`->>`) count only their own send
  hop, not downstream work; a failed call (`-x`) counts a timeout of 1 000 ms
  (overridable later).
- Scenario percentile: `p_q(s) = mean(s) × f(q)` with
  `f(50)=1.0, f(90)=1.6, f(95)=2.0, f(99)=3.0, f(99.9)=5.0`.
- Use case percentile: `p_q(U) = max { p_q(s) : m(s) ≥ 1 − q }`: a scenario
  carrying more than the tail share dominates that percentile. With 10% cache
  misses, p99 is the miss path; with 0.5% it is the hit path. This is
  intentional and explained in the UI.

### 2.4 Availability

- Node: `A(n) = 1 − (1 − a(n))^replicas(n)`.
- Use case: the product of `A(n)` over the distinct nodes on the synchronous
  path of its main scenario (largest share), except that a node n with a
  fallback, meaning a success scenario of U that calls n with `-x` and
  completes without n, contributes `1 − (1 − A(n)) · (1 − A(fallback path))`.

### 2.5 Failure injection

For `survive any node failure` (or the selected nodes), for each node n:
- `replicas(n) ≥ 2`: remove one replica, recompute load; it passes if no node
  becomes saturated.
- `replicas(n) = 1`: every use case whose success scenarios need n must have a
  success scenario that handles n failing (`-x n`, then completes without n).
  Otherwise it fails: *Losing db (PostgreSQL) breaks "Shorten": add a replica
  or a fallback scenario*.

### 2.6 Durability and cost

- `durable U`: every success scenario has a synchronous, non-failed request to
  a durable node before the entry response (sequence order).
- Cost: `Σ replicas(n) × cost(n)`.

### 2.7 Output

```ts
export interface NodeAnalysis { id: string; kind: Kind; replicas: number; loadRps: number; capacityRps: number; utilization: number; saturated: boolean; latencyMs: number; availability: number; costUsd: number; durable: boolean }
export interface ScenarioAnalysis { id: string; name: string; share: number; meanMs: number; percentiles: Record<'p50' | 'p90' | 'p95' | 'p99' | 'p999', number> }
export interface UseCaseAnalysis { id: string; name: string; rps: number; scenarios: ScenarioAnalysis[]; percentiles: ScenarioAnalysis['percentiles']; availability: number }
export interface Analysis { nodes: NodeAnalysis[]; useCases: UseCaseAnalysis[]; totalCostUsd: number; singlePointsOfFailure: string[]; warnings: string[] }
```

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

Problem format (`frontend/src/practice/problems/<id>.ts`):

```ts
export interface Problem {
  id: string;                         // url-shortener
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  tags: string[];                     // caching, queues, consistency, …
  statement: string;                  // Markdown
  given: string;                      // Proschi: traffic, requirements, tests, fixed nodes (e.g. client)
  starter: string;                    // starts with: import "problem.proschi"
  solution: string;                   // reference solution; CI checks it passes every test
  hints: string[];
}
```

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
