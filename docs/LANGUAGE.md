# Proschi language reference

Proschi documents describe an architecture (nodes, groups, connections) and
use cases (step-by-step request flows) as plain text. The parser lives in
`frontend/src/dsl/` and never throws: problems come back as diagnostics with a
line and column, and everything else still renders.

The parser is the definition of the language. The same code powers the web
editor, the `proschi` command line and the language server, so every editor
reports the same problems. See [Editor support](EDITORS.md) for VS Code,
IntelliJ, Neovim, Helix, Sublime Text and CI, and the [grammar](#grammar) below
for a summary of the syntax.

```proschi
title "E-Commerce Platform"

group vpc "AWS VPC" {
  gateway "API Gateway"   [AWS API Gateway] @Platform
  orders  "Order Service" [REST API]        @Orders "Handles order processing"
}
ordersDb "Orders DB"   [PostgreSQL]
events   "OrderEvents" [Kafka]

gateway -> orders   : HTTP
orders  -> ordersDb : SQL
orders  -> events   : Publish

usecase "Create order" {
  gateway -> orders : POST /api/orders json {
    "sku": "A1"
  }
  alt "Created" {
    par {
      orders -> ordersDb : INSERT order
      orders ->> events  : OrderCreated {"orderId": "o-1"}
    }
    orders --> gateway : 201 {"status": "pending"}
  } alt "Invalid payload" {
    orders --> gateway : 400 {"error": "sku required"}
  } alt "DB down" {
    orders -x ordersDb : INSERT order
    orders --> gateway : 503
  }
}
```

The architecture is written once. Any number of use cases can play over it,
and each use case can branch into scenarios (success and error paths) with
`alt`. A document can also carry a [high-level design](#high-level-design):
traffic, requirements, capacity, the data model, decisions and tests.

The canonical style is what `proschi fmt` (or *Format code* in the editor)
produces: two spaces per block and aligned columns in runs of similar lines; see
[Formatting](EDITORS.md#formatting).

## Statements

| Statement | Syntax | Notes |
|---|---|---|
| Title | `title "Text" ["Summary"]` | The optional second string is the system summary. |
| Import | `import "path.proschi"` | Top level only. Adds everything the file declares. See [Imports](#imports). |
| Node | `id ["Name"] [Tech] [@team] ["Description"] [pos x,y] [x3]` | Parts after the id may come in any order; the first string is the name, the second the description. `x3` sets the number of replicas (default 1). |
| Group | `group id ["Name"] [Style] [pos x,y] { … }` | Holds nodes, nested groups and connections. Style is a grouping tech: `Logical Group` (default), `Network Boundary`, `Security Zone`, `Service Group`. |
| Connection | `a -> b [: label]` | Architecture edge. Undeclared ids become plain nodes automatically. |
| Use case | `usecase "Name" ["Description"] { steps }` | Top level only. |
| Parallel steps | `par { steps }` | Inside a use case or an `alt` block; steps in one block run in parallel. Cannot be nested. |
| Scenario | `alt "Name" [when "condition"] { steps }` | Inside a use case or another `alt`. See [Scenarios](#scenarios). |
| Traffic, requirements, capacity | `traffic { … }`, `requirements { … }`, `capacity { … }` | Top level only. See [High-level design](#high-level-design). |
| Entity | `entity Name [in store] ["Description"] { fields }` | Top level only. The data model. |
| Decision | `decision "Title" { … }` or `decision "Title" because "Reason"` | Top level only. |
| Test | `test "Name" { assertions }` | Top level only. Flow assertions. |
| Comment | `# …` | Anywhere a token can start. A `#` inside quotes or a JSON payload is kept. |

- **Ids** are letters, digits and `_`, starting with a letter or `_`.
- **Tech** names a technology from the catalog (about 210 of them, see [Tech stacks](#tech-stacks)), e.g. `[AWS Lambda]`, `[Redis]` or `[Spring Boot]`. It decides the node's icon, its [kind](#selectors-and-kinds) and its default numbers in the simulation.
- **Annotation tech stacks** (`Text Note`, `Sticky Note`, `Comment`) make text nodes. The description, or else the name, becomes the text.

### Tech stacks

The catalog lives in `frontend/src/catalog/componentCatalog.ts`; the editor's
and the language server's completion list all of it. Each entry has the names
people usually write as aliases, so `[S3]`, `[Amazon S3]` and `[AWS S3]` are
the same node, and so are `[Postgres]` and `[PostgreSQL]`, `[ALB]` and
`[AWS Load Balancer]`, `[k8s]` and `[Kubernetes]`. Matching ignores case,
spaces and punctuation (`[route 53]`, `[pubsub]`, `[nodejs]`) and a trailing
version (`[PostgreSQL 16]`, `[Redis 7.2]`). The parse output always holds the
catalog name.

| Group | Examples |
|---|---|
| Generic, one per kind | `Service`, `Worker`, `Database`, `NoSQL Database`, `Cache`, `Message Queue`, `Object Storage`, `CDN`, `Load Balancer`, `API Gateway`, `DNS`, `WAF`, `Function`, `Search Engine`, `Data Warehouse` |
| Services and runtimes | `REST API`, `gRPC`, `GraphQL`, `WebSocket`, `Spring Boot`, `Kotlin`, `Java`, `Go`, `Node.js`, `Python`, `Django`, `FastAPI`, `.NET`, `Kubernetes`, `Docker`, `AWS ECS`, `AWS EKS`, `GCP GKE`, `Azure AKS` |
| Functions | `AWS Lambda`, `GCP Cloud Functions`, `GCP Cloud Run`, `Azure Functions`, `Cloudflare Workers` |
| Relational and NoSQL | `PostgreSQL`, `MySQL`, `MariaDB`, `SQL Server`, `Oracle`, `AWS Aurora`, `AWS RDS`, `GCP Cloud SQL`, `CockroachDB`, `GCP Spanner`, `DynamoDB`, `Cassandra`, `ScyllaDB`, `MongoDB`, `Azure Cosmos DB`, `Neo4j`, `etcd` |
| Caches | `Redis`, `Valkey`, `Memcached`, `AWS ElastiCache`, `GCP Memorystore`, `Hazelcast` |
| Queues and streams | `Kafka`, `AWS Kinesis`, `AWS SQS`, `AWS SNS`, `RabbitMQ`, `GCP Pub/Sub`, `NATS`, `AWS EventBridge`, `Azure Service Bus`, `Apache Pulsar`, `Redpanda` |
| Search and analytics | `Elasticsearch`, `OpenSearch`, `Solr`, `GCP BigQuery`, `Snowflake`, `AWS Redshift`, `ClickHouse`, `InfluxDB`, `TimescaleDB` |
| Storage | `AWS S3`, `GCP Cloud Storage`, `Azure Blob Storage`, `MinIO`, `Cloudflare R2` |
| Edge | `AWS CloudFront`, `Fastly`, `Akamai`, `Cloudflare`, `AWS Load Balancer`, `nginx`, `Envoy`, `HAProxy`, `Kubernetes Ingress`, `AWS API Gateway`, `Kong`, `AWS Route53`, `AWS WAF` |
| External | `Stripe`, `PayPal`, `Twilio`, `SendGrid`, `Auth0`, `Okta`, `APNs`, `FCM`, `Payment Gateway`, `Third Party API` |

A tech the catalog does not know is a warning, not an error, so a document
that uses one still renders and simulates. The node keeps the text you wrote
and is drawn and simulated as the kind its name suggests: `[TigerBeetle DB]`
is a database, `[Acme Queue]` a queue, `[In-house Search Index]` a search
node. Without a telling word it takes the kind of the closest catalog tech
(`[Postgress]` is a database), and otherwise it is a service. It is never a
client: an unknown node has a finite capacity, a latency and a price. The
warning names the closest catalog tech when there is one, and the language
server offers to replace the name with it:

```text
Unknown tech stack 'Postgress'. Did you mean 'PostgreSQL'? Until then it is simulated as a generic database, like [Database]
```

To keep a product name the catalog lacks without the warning, use the generic
tech of its kind instead (`[Database]`, `[Message Queue]`) and put the product
in the node's name or description.

## Use case steps

| Arrow | Meaning |
|---|---|
| `a -> b : …` | Synchronous request |
| `a ->> b : …` | Asynchronous, fire and forget. It becomes async request/response if a reply follows. |
| `b --> a : …` | Response to the latest unanswered request from `a` to `b` |
| `a -x b : …` | Failed call: the request never gets an answer (timeout, connection refused). It cannot be answered with `-->`. |

How a step label is read:

- A request label may start with `x<N>` (fan-out: the step happens N times per
  request) and `~<size>` (payload size), in either order, e.g.
  `worker -> feeds : x200 LPUSH feed:{follower}` or
  `client -> blobs : ~2MB PUT /files/{id}`. They are removed before the rest of
  the label is read. See [Fan-out and payload size](#fan-out-and-payload-size).
- `POST /orders` sets the HTTP method and endpoint. Only the standard verbs count: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS.
- The path may be a template with `{param}` segments, e.g. `GET /orders/{id}`. Braces inside the path are part of it, not a payload.
- After the method and path, `json …`, `xml …` or `text …` sets the payload format and body. A body that starts with `{`, `[` or `<` is recognised without a keyword.
- A JSON payload can span several lines. It continues until its brackets balance.
- Any other text becomes the step name, e.g. `INSERT order` or `OrderCreated {…}`.
- On a response, a leading three-digit number is the status code, e.g. `201 {"id": 1}`.

`proschi check` can compare these steps with the OpenAPI specs of the services
they call: endpoints, status codes and JSON payloads. See
[Checking against OpenAPI](EDITORS.md#checking-against-openapi).

### Fan-out and payload size

| Prefix | Meaning | Parse output |
|---|---|---|
| `x<N>` | The step happens N times per request (N ≥ 1). Load counts N calls; latency counts the step once (batched or parallel). | `multiplier` |
| `~<size>` | Payload size: a number (decimals allowed) and `B`, `KB`, `MB`, `GB` or `TB`. Units are decimal: 1 MB = 1000 KB. It adds transfer time and egress cost. | `sizeBytes` |

A prefix counts only at the start of a request label and only when followed
by whitespace or the end of the label, so `xml payload`, `x-request-id` and
`GET /x200` are ordinary labels. `x0`, a prefix given twice and a malformed
size (`~2mb`, `~2`, `~MB`) are errors at the prefix. Response (`-->`) labels
and connection labels outside use cases are read as written.

### Reads and writes

Every request step has an `access`, `read` or `write`:

1. With an HTTP method: `POST`, `PUT`, `PATCH` and `DELETE` write; `GET`,
   `HEAD` and `OPTIONS` read.
2. Otherwise the first word of the label (after any prefixes, compared
   case-insensitively, the whole word) decides. The words in the table below
   write.
3. Everything else reads: GET, SELECT, QUERY, SCAN, FETCH, LOOKUP, GEOSEARCH,
   GetItem, MGET, an event name such as `OrderPlaced`, …

| Write verbs | Typical labels |
|---|---|
| INSERT, UPDATE, UPSERT, DELETE, CREATE | `INSERT order`, `UPDATE seat SET held` |
| PUT, SET, WRITE, APPEND, SAVE, STORE, UPLOAD, COMMIT, RECORD, MARK | `PUT pastes/k7Qz2`, `STORE body`, `MARK paid` |
| PUTITEM, UPDATEITEM, DELETEITEM, BATCHWRITEITEM | DynamoDB: `PutItem Url` |
| INCR, INCRBY, DECR, HINCRBY, LPUSH, RPUSH, ZADD, HSET, SADD, XADD, MSET, GEOADD | Redis: `INCR rate:42`, `ZADD feed:7 p_981` |
| RESERVE, HOLD, BOOK, CHARGE | claiming a resource or money: `HOLD seat 12A`, `CHARGE card` |
| PUBLISH, SEND, ENQUEUE, PRODUCE, EMIT, NOTIFY | handing something on: `EMIT OrderShipped`, `NOTIFY bob` |

Words that only start like a verb (`Stored`, `Booking`, `Notification`) read.

`durable` requirements and `writes X before responding` count write steps
only, and reads and writes load a store's read and write capacity separately.

How the protocol is inferred:

| Condition | Protocol |
|---|---|
| `->>` arrow, or a queue target | `MESSAGING` |
| An HTTP method and a `GraphQL`, `gRPC` or `SOAP API` target | `GRAPHQL`, `GRPC` or `SOAP` |
| Any other HTTP method | `REST` |
| Anything else | `OTHER` |

Steps should follow the architecture: when a step goes between two nodes that
no connection joins (in either direction), the parser warns
`No connection between 'a' and 'b' in the architecture; add 'a -> b'`. For a
response the suggested connection points the way the request went. Calls of a
node to itself are fine, and a document without any connection (only use
cases) is not checked. The language server offers a quick fix that adds the
connection.

## Scenarios

One endpoint rarely has one outcome. `alt` blocks split a use case into
scenarios without copying the steps they share:

```proschi
usecase "Get order" {
  gateway -> orders : GET /api/orders/42      # shared by every scenario

  alt "Found" {
    orders -> ordersDb  : SELECT order 42
    orders --> gateway : 200 {"id": 42}
  } alt "Not found" {
    orders -> ordersDb  : SELECT order 42
    orders --> gateway : 404 {"error": "not_found"}
  } alt "DB timeout" {
    orders -x ordersDb  : SELECT order 42
    orders --> gateway : 504
  }

  gateway ->> audit : OrderViewed               # shared again, after every branch
}
```

- `alt` blocks that follow each other directly are one set of alternatives.
  Close one and open the next on the same line (`} alt "B" {`) or on the next
  line; a step between two blocks starts a new set.
- Each branch becomes a scenario. Steps before a set are shared by all its
  branches, and steps after it are added to every branch.
- `alt` blocks can be nested. Nested sets, and several sets one after another,
  multiply: two sets of two branches give four scenarios, named like
  `A › X`. A use case keeps at most 32 scenarios; the parser warns past that.
- A response inside a branch can answer a request made before the branch.
- A scenario is an **error path** when the use case's first request is answered
  with a 4xx or 5xx status, or fails with `-x`. Playback draws error replies and
  failed calls in red.
- A use case without `alt` has a single scenario.

A branch can say when it happens: `alt "Not found" when "no order has that id" {`
(also `} alt "…" when "…" {`). The condition is free text in quotes; `when` is
a keyword only in this position, so it still works as an id elsewhere. The
editor shows the condition on the scenario tab's tooltip and as a *When:* line
during playback. For nested branches the conditions on the path are joined
with ` · `, e.g. `cache miss · db down`.

Scenario ids are the slugged branch names (`not-found`, `a-x`), used in links.

### Grouping by endpoint

The use case picker in the editor groups use cases by the HTTP method and path
of their first step, e.g. all `POST /api/orders` flows together. Use cases
that don't start with an HTTP call are listed under *Other flows*.

**Path templates.** Calls to the same endpoint with different ids share a
group:

1. A path with a `{param}` segment groups by itself: `GET /orders/{id}`.
2. Otherwise, a concrete path joins a template endpoint of another use case in
   the document with the same method that matches it, where `{param}` stands
   for exactly one non-empty segment: `GET /orders/order-789` joins
   `GET /orders/{id}`.
3. Otherwise, segments that are all digits or a UUID are read as `{id}`:
   `GET /orders/42` and `GET /orders/43` group as `GET /orders/{id}`.

The use case's `endpoint` stays the literal path; the group key is
`endpointGroup` in the parse output.

## Imports

Write the infrastructure once and keep use cases in other files, e.g. one per
team or domain:

```proschi
# infra.proschi
title "Shop infrastructure"
gateway "API Gateway" [AWS API Gateway]
orders "Order Service" [REST API] @Orders
ordersDb [PostgreSQL]
gateway -> orders
orders -> ordersDb
```

```proschi fragment
# checkout.proschi
title "Checkout"
import "infra.proschi"

usecase "Place order" {
  gateway -> orders : POST /orders
  orders -> ordersDb : INSERT order
  orders --> gateway : 201
}
```

- The path is relative to the importing file. Imports may be nested: an imported file can import others.
- Everything an imported file declares (nodes, groups, connections, use cases) becomes part of the diagram. The importing document's `title` names it; titles of imported files are ignored.
- A file imported along several paths (`a` and `b` both import `infra`) is included once. An import cycle is an error on the import that closes it: `Import cycle: a.proschi → b.proschi → a.proschi`. A file that does not exist is an error: `Cannot find 'x.proschi'`.
- Ids are shared by all files: declaring the same id in two files is an error at the later declaration, naming the file and line of the first. Use case ids stay unique too (a repeated name gets a `-2` suffix).
- Undeclared ids become plain nodes only after every file is read, so a use case file may use nodes its imports declare.
- Problems in an imported file are reported with that file's path (`file` in `proschi parse` output).

Where imports are resolved:

| Where | Resolved against |
|---|---|
| Web editor | The diagrams saved in the browser, by file name. A diagram opened from a `.proschi` file keeps its name; others are named after their title when they are created, e.g. `title "Shop Infra"` → `shop-infra.proschi`. The name stays when the title changes, so imports keep working; rename it with the pencil in the *Diagrams* menu, where it is shown. A path that matches no saved name exactly falls back to the one diagram with the same file name. |
| `proschi check` / `parse`, language server | The file system. The language server prefers the text of open, unsaved documents. |

In the web editor, nodes and connections from imported files are drawn like
any other, but canvas edits only change the open document: moving, renaming or
deleting something declared in an imported file is refused with a short
message. Edit that file instead. The problems panel lists problems in imported
files with the file name in front; clicking one opens that diagram.

## High-level design

Beyond what talks to what, a document can say how much traffic flows, how fast
and reliable the system must be, what data lives where and why it is built
this way. These statements are blocks at the top level; each line inside a
block follows that block's own rules. The design they describe is in
[docs/design/hld-and-practice.md](design/hld-and-practice.md); how the
simulation turns them into numbers, and how far to trust those numbers, is on
[How the simulation works](https://proschi.app/docs/model/).

```proschi fragment
title "URL Shortener" "Turns long URLs into short codes and redirects visitors"

api   "Shortener API" [REST API]   x12
cache "Code cache"    [Redis]      x2
db    "URL store"     [PostgreSQL] x3
# … connections and the use cases "Redirect" and "Shorten"

traffic {
  "Redirect" 100k rps mix "Cache hit" 90%, "Cache miss" 10%
  "Shorten"  1k rps
}

requirements {
  p99 "Redirect" < 100ms
  availability >= 99.9%
  durable "Shorten"
  survive any node failure
  cost <= 3000 usd/month
}

capacity {
  db 20k rps latency 4ms
}

entity Url in db "One short code and where it points" {
  code      string key
  target    string
  createdAt time   index
}

decision "Cache redirects in Redis" {
  because "Reads outnumber writes 100:1 and p99 must stay under 100 ms"
  rejected "Read replicas only" "About 5 ms per read and many replicas at 100k rps"
}

test "Redirects are served from the cache" {
  "Redirect" calls any cache before any database
  "Redirect" scenario "Cache hit" never calls any database
}
```

The *URL shortener HLD* example in the editor is a complete document using
every statement.

The words that open these blocks are keywords only in that shape (`traffic {`,
`entity Name …`, `decision "…" {` or `decision "…" because`, `test "…" {`),
so older documents that use them as node ids, e.g. `test "Test runner"
[REST API]`, still parse. A malformed line inside a block is an error on that
line and the rest of the block is still read; a misplaced block (inside a
group or a use case) is an error and its lines are skipped. Imported files
contribute all of these sections. In the parse output each section is left
out when the document has none.

### Quantities

A quantity is a number, an optional magnitude and an optional unit:

| Part | Values |
|---|---|
| Number | `120`, `99.95` |
| Magnitude | `k` (thousand), `m` (million), `b` (billion) |
| Unit | `rps`, `rpm`, `rpd` (requests per second, minute, day); `ms`, `s`; `%`; `usd/month`; `MB/s`, `GB/s` (bandwidth); `usd/GB` (egress price) |

The unit may be attached (`50ms`, `99.9%`, `100krps`) or one space away
(`50 ms`, `100k rps`). Rates are normalised to requests per second (`6k rpm` is
100 rps), durations to milliseconds (`1.5s` is 1500 ms) and bandwidth to
megabytes per second (`1 GB/s` is 1000 MB/s). `ms` is always
milliseconds. A statement that wants a unit reports a quantity without one, or
with the wrong one: `'100k' needs a unit: expected a rate, e.g. 100k rps, 6k rpm or 1m rpd`.

### Traffic

```proschi fragment
traffic {
  "Redirect" 100k rps mix "Cache hit" 90%, "Cache miss" 10%
  "Shorten"  1k rps
}
```

- One line per use case: `"<use case>" <rate>`.
- `mix` splits the use case's traffic over its scenarios by their full names
  (`A › B` for nested branches; a use case without `alt` has one scenario,
  named like the use case). Without `mix`, all traffic goes to the first
  scenario.
- Shares should add up to 100%. Otherwise there is a warning and they are
  scaled to fit. In the parse output shares are fractions (`0.9`).
- Unknown use case or scenario names are warnings, checked once every file is
  read. A second line for the same use case is an error.

### Requirements

```proschi fragment
requirements {
  p99 "Redirect" < 50ms
  p99 "Redirect" scenario "Cache hit" < 10ms
  p95 < 300ms                 # every use case
  availability "Redirect" >= 99.95%
  availability >= 99.9%       # every use case
  durable "Shorten"
  survive any node failure
  survive failure of cache    # a node id, [Tech], or any <kind>
  cost <= 3000 usd/month
}
```

| Requirement | Meaning |
|---|---|
| `p50`, `p90`, `p95`, `p99` or `p999` `["Use case"] < <duration>` | Latency percentile of the use case (or of every use case with traffic) under its traffic, over all its scenarios mixed by their shares |
| `p99 "Use case" scenario "S" < <duration>` | The same for one scenario of the use case. An unknown scenario is a warning. |
| `availability ["Use case"] >= <percent>` | Computed availability of the use case |
| `durable "Use case"` | Every success scenario writes to a durable node, synchronously, before the entry request is answered |
| `survive any node failure` | Losing any single node instance keeps every use case working: with replicas, the node does not saturate and every latency requirement that held still holds |
| `survive failure of <selector>` | The same, for the selected nodes only |
| `cost <= <usd/month>` | Sum of replica costs and egress |

`<=` is also accepted for latency and `>` for availability. Each requirement
becomes a test that the simulation evaluates.

### Capacity

```proschi fragment
capacity {
  db    20k rps latency 4ms availability 99.95% cost 400 usd/month durable
  cache 150k rps
  users reads 30k rps writes 8k rps shards 4 consistency strong
  blobs bandwidth 500 MB/s egress 0.05 usd/GB
  pay   timeout 300ms
}
```

Per-replica overrides of the default profile of a node, one line per node id,
parts in any order:

| Part | Meaning | Parse output |
|---|---|---|
| `<rate>` | Requests per second per replica, reads and writes alike | `rps` |
| `reads <rate>`, `writes <rate>` | Separate read and write capacity per replica | `readRps`, `writeRps` |
| `shards <n>` | Number of shards (n ≥ 1). Single-primary stores scale writes with shards, not replicas. | `shards` |
| `size S`, `size M` or `size L` | Instance size: the tech's default capacity ×1, ×2 or ×4 for ×1, ×1.8 or ×3.5 the cost. An explicit rate or cost wins. | `size` |
| `latency <duration>` | Latency per call | `latencyMs` |
| `availability <percent>` | Availability per replica | `availability` |
| `cost <usd/month>` | Monthly cost per replica | `costUsd` |
| `durable` or `volatile` | Whether a write there is durable | `durable` |
| `consistency strong` or `consistency eventual` | What `any strong store` / `any eventual store` match | `consistency` |
| `bandwidth <MB/s or GB/s>` | Network bandwidth per replica, for transfer time (and, for nodes you run, how many bytes they can move) | `bandwidthMBps` |
| `egress <usd/GB>` | Price of data the node sends to clients and third parties (internet egress) | `egressUsdPerGb` |
| `timeout <duration>` | What a failed call (`-x`) to the node costs; 1 000 ms by default | `timeoutMs` |

An unknown node id is a warning, and so are `shards` or `consistency` on a
node that is not a data store. A part given twice, a rate together with
`reads` or `writes`, and a second line for the same node are errors.

### Entities

```proschi fragment
entity Url in db "One short code and where it points" {
  code      string key
  target    string
  createdAt time   index
}
```

- `entity <Name> [in <node id>] ["Description"] {`, then one field per line:
  `<name> <type> {flag}` with the flags `key`, `index`, `unique` and
  `optional`. Types are free identifiers: `string`, `int`, `time`, `uuid`,
  `json`, …
- `in <node>` places the entity in a store. It is a warning when that node is
  not a data store: a cache, database, search, analytics, queue or storage
  node (see [kinds](#selectors-and-kinds)).

### Decisions

```proschi fragment
decision "Cache redirects in Redis" {
  because "Reads outnumber writes 100:1 and p99 must stay under 50 ms"
  rejected "Read replicas only" "About 5 ms per read and many replicas at 100k rps"
  rejected "Memcached" "No replication; losing a node empties the cache"
}
decision "Base62 codes from a counter" because "Short, unique, no collisions to retry"
```

`because "<reason>"` at most once, and any number of
`rejected "<option>" "<reason>"`. The one-line form takes only `because`.

### Tests

Tests check how the design works. Every assertion line in a test must hold.

```proschi fragment
test "Redirect is served from the cache" {
  "Redirect" calls any cache before any database
  "Redirect" scenario "Cache hit" never calls any database
}
test "Clients only enter through the gateway" {
  no path from client to any database
}
test "Checkout answers before slow work" {
  "Checkout" never waits for any queue or any external
  "Checkout" calls ledger after gateway
  any service never calls blobs
  "Retry charge" starts at any queue
}
```

| Assertion | Holds when |
|---|---|
| `U [scenario S] calls X` | some scenario of U (or S) has a step to a node matching X |
| `U [scenario S] every scenario calls X` | every scenario of U calls X |
| `U [scenario S] never calls X` | no scenario of U (or S) calls X |
| `U [scenario S] calls X before Y` | in every scenario that calls Y, X is called earlier; and some scenario calls Y |
| `U [scenario S] calls Y after X` | in every scenario that calls both, the last call to Y comes after the first call to X; and some scenario calls both |
| `U [scenario S] never waits for X` | no synchronous (`->`) call to X happens before U's entry response. Async sends and calls after the response are fine; it also holds when X is never called |
| `U [scenario S] writes X before responding` | every success scenario has a synchronous, non-failed step to X before the entry response |
| `U [scenario S] responds <status>` | some scenario's entry response has that status (`201`, or a class `2xx`/`4xx`/`5xx`) |
| `U has scenario S` | the scenario exists |
| `U handles failure of X` | some success scenario of U contains a failed call (`-x`) to X |
| `U starts at X` | U's entry request is sent by a node matching X |
| `[in U] X calls Y` | some step (of U, or of any use case) is sent by a node matching X to a node matching Y |
| `[in U] X never calls Y` | no step (of U, or of any use case) is sent by X to Y |
| `no path from X to Y` | no connection or step goes directly from a node matching X to a node matching Y |
| `X has replicas >= <n>` | every node matching X has at least n replicas |

`U` and `S` are a use case and a scenario name in quotes. An assertion that
starts with a quoted use case is about that use case (`"U" calls X`: some step
reaches X); one that starts with a selector or `in "U"` is about the sender
(`X calls Y`: a step sent by X). `has scenario`, `handles failure of` and
`starts at` are about the whole use case and take no `scenario`. Order in a scenario
is the sequence order, requests and responses interleaved. Unknown use cases,
scenarios (after `scenario`) and nodes are warnings; a test without
assertions is a warning and two tests with one name are an error.

### Selectors and kinds

`X` and `Y` above, and `survive failure of`, take a selector:

| Selector | Matches |
|---|---|
| `db` | the node with that id |
| `[PostgreSQL]` | every node with that tech stack |
| `any database` | every node of that kind |
| `any strong store`, `any eventual store` | every data store of that consistency (relational databases and queues are strong; caches, most NoSQL stores, search, CDNs and object storage listings are eventual; `capacity { x consistency … }` overrides) |
| `X or Y [or Z]` | a node matching any of them, e.g. `never calls any cache or any database` |

A node's kind comes from its tech stack (an unknown tech: from its name, see
[Tech stacks](#tech-stacks)):

| Kind | Tech stacks (examples) |
|---|---|
| `client` | Actor, Browser, Mobile App, shapes and nodes without a tech |
| `edge` | WAF, AWS WAF, Global Accelerator; `any edge` also selects the four kinds below |
| `cdn` | CDN, CloudFront, Fastly, Akamai, Cloudflare, Azure CDN, Cloud CDN, Front Door |
| `loadbalancer` | Load Balancer, AWS Load Balancer (ALB, NLB, ELB), nginx, Envoy, HAProxy, Traefik, Ingress |
| `gateway` | API Gateway, AWS API Gateway, Azure API Management, Apigee, Kong |
| `dns` | DNS, Route53, Azure DNS, Cloud DNS |
| `service` | Service, Worker, REST API, gRPC, GraphQL, WebSocket, Spring Boot, Go, Node.js, Kubernetes, EC2, ECS, EKS, Fargate, VMs |
| `function` | Function, Lambda, Cloud Functions, Azure Functions, Cloud Run, App Engine, Cloudflare Workers |
| `cache` | Cache, Redis, Valkey, ElastiCache, Memcached, Memorystore, Hazelcast, Aerospike |
| `database` | Database, PostgreSQL, MySQL, Aurora, RDS, CockroachDB, Spanner, DynamoDB, Cassandra, ScyllaDB, MongoDB, Cosmos DB, Neo4j, … |
| `search` | Search Engine, Elasticsearch, OpenSearch, Solr, Algolia |
| `analytics` | Data Warehouse, BigQuery, Snowflake, Redshift, ClickHouse, InfluxDB, TimescaleDB |
| `queue` | Message Queue, Kafka, SQS, SNS, Kinesis, Pub/Sub, RabbitMQ, NATS, Service Bus, … |
| `storage` | Object Storage, S3, Blob Storage, Cloud Storage, MinIO, R2, EFS, EBS |
| `external` | Third Party API, Payment Gateway, Stripe, Twilio, SendGrid, Auth0, Email/SMS Service |
| `other` | groups, text nodes and the Note shape |

## Editing on the canvas

The text is the source of truth. Edits on the diagram are written back into it:

| Canvas action | Text change |
|---|---|
| Drag a node or group | Adds or updates `pos x,y` on its declaration. Positions of group members are relative to the group. |
| Double-click a node | Sets its display name: `id "New name"`. |
| Drag from one node's dot to another's | Adds a connection, `a -> b`. |
| **Add component**, then pick one | Declares it above the first use case: `redis "Redis" [Redis]`. Dragged onto the canvas instead, it also gets `pos x,y` where it was dropped. |
| Select a node, then change its settings | Name, tech (`[Redis]`), replicas (`x3`), owner (`@team`) and description edit its declaration. Capacity, latency, availability, cost and (for data stores) shards edit its line in the `capacity` block, which is added when there is none. |
| Select a connection, then change its label | `a -> b : label`. A label with a JSON or XML payload is edited in the text. |
| Select, then **Delete** | Removes the node and its connections, or the connection. |
| **Auto-layout** button | Removes every `pos x,y`. |

Each edit changes only the part of the line it is about, so comments and alignment survive.

With a `traffic` block, **Overlay: load** draws the simulation on the canvas:
each node is coloured by how busy it is at the traffic's rates, shows its
replicas, shards and utilisation, and requests flow along the connections
(hollow dots for async work, red ones falling off a node past 100%).

A node that was only referenced, never declared, gets a declaration line above the first use case.

## Links

The address bar always holds the whole document: `#code=…`. When the document
imports other files, their text travels along as `&imports=…` (a compressed map
of path to source), so the link renders the same for someone who has none of
the files. Those files stay attached to the diagram opened from the link and
win over saved diagrams of the same name. While a use case is playing, the link also names the use case, the scenario (for use cases with `alt` blocks) and the step, e.g. `#code=…&uc=create-order&alt=db-down&step=2`, so a shared link opens playback at that step of that scenario.

## Grammar

A summary in EBNF. The language is line-oriented: each statement takes one
line, except a step or connection label whose JSON payload continues until its
brackets balance. Whitespace between tokens is ignored.

```ebnf
document     = { line } ;
line         = [ statement ] [ comment ] newline ;

statement    = title | import | node | connection
             | group-open | usecase-open | par-open | alt-open | close
             | traffic | requirements | capacity | entity | decision | test ;

title        = "title" , ( string | id ) , [ string ] ;   (* 2nd string: summary *)
import       = "import" , string ;                      (* a relative file path *)
node         = id , { string | tech | team | position | replicas } ;  (* 1st string: name, 2nd: description *)
connection   = id , arrow , id , [ ":" , label ] ;
group-open   = "group" , id , [ string ] , [ tech ] , [ position ] , "{" ;
usecase-open = "usecase" , ( string | id ) , [ string ] , "{" ;
par-open     = "par" , "{" ;
alt-open     = "alt" , ( string | id ) , [ "when" , string ] , "{" ;
close        = "}" , [ alt-open ] ;

traffic      = "traffic" , "{" , { string , quantity , [ "mix" , share , { "," , share } ] } , "}" ;
share        = string , quantity ;                       (* "Cache hit" 90% *)
requirements = "requirements" , "{" , { requirement } , "}" ;
requirement  = percentile , [ string , [ "scenario" , string ] ] , "<" , quantity
             | "availability" , [ string ] , ">=" , quantity
             | "durable" , string
             | "survive" , ( "any" , "node" , "failure" | "failure" , "of" , selector )
             | "cost" , "<=" , quantity ;
percentile   = "p50" | "p90" | "p95" | "p99" | "p999" ;
capacity     = "capacity" , "{" , { id , { capacity-part } } , "}" ;
capacity-part = quantity | "reads" , quantity | "writes" , quantity | "shards" , integer | "size" , ( "S" | "M" | "L" )
             | "latency" , quantity | "availability" , quantity | "cost" , quantity
             | "durable" | "volatile" | "consistency" , ( "strong" | "eventual" )
             | "bandwidth" , quantity | "egress" , quantity | "timeout" , quantity ;
entity       = "entity" , id , [ "in" , id ] , [ string ] , "{" , { id , id , { flag } } , "}" ;
flag         = "key" | "index" | "unique" | "optional" ;
decision     = "decision" , string , ( "because" , string
             | "{" , { "because" , string | "rejected" , string , string } , "}" ) ;
test         = "test" , string , "{" , { assertion } , "}" ;
assertion    = string , [ "scenario" , string ] , ( "calls" , selector , [ ( "before" | "after" ) , selector ]
             | "every" , "scenario" , "calls" , selector | "never" , "calls" , selector
             | "never" , "waits" , "for" , selector
             | "writes" , selector , "before" , "responding" | "responds" , status )
             | string , "has" , "scenario" , string
             | string , "handles" , "failure" , "of" , selector
             | string , "starts" , "at" , selector
             | [ "in" , string ] , selector , [ "never" ] , "calls" , selector
             | "no" , "path" , "from" , selector , "to" , selector
             | selector , "has" , "replicas" , ">=" , integer ;
selector     = selector-atom , { "or" , selector-atom } ;
selector-atom = id | tech | "any" , kind | "any" , ( "strong" | "eventual" ) , "store" ;
kind         = "client" | "edge" | "service" | "function" | "cache" | "database"
             | "search" | "analytics" | "queue" | "storage" | "external" | "other" ;
status       = digit , digit , digit | digit , "xx" ;     (* 201, 4xx *)

arrow        = "->" | "->>" | "-->" | "-x" ;
position     = "pos" , integer , "," , integer ;
replicas     = "x" , digit , { digit } ;               (* one token, e.g. x3 *)
quantity     = number , [ magnitude ] , [ unit ] ;     (* 50ms, 100k rps, 99.9% *)
number       = digit , { digit } , [ "." , digit , { digit } ] ;
magnitude    = "k" | "m" | "b" ;
unit         = "rps" | "rpm" | "rpd" | "ms" | "s" | "%" | "usd/month" | "MB/s" | "GB/s" | "usd/GB" ;
id           = ( letter | "_" ) , { letter | digit | "_" } ;
string       = '"' , { character - '"' | "\" , character } , '"' ;
tech         = "[" , { character - "]" } , "]" ;
team         = "@" , { letter | digit | "_" | "-" } ;
integer      = [ "-" ] , digit , { digit } ;
comment      = "#" , { character } ;            (* only where a token can start *)
label        = [ label-prefix , [ label-prefix ] ] , { character } ;  (* to end of line; see below *)
label-prefix = ( "x" , digit , { digit } | "~" , number , size-unit ) , whitespace ;  (* requests only *)
size-unit    = "B" | "KB" | "MB" | "GB" | "TB" ;
```

Where each statement may appear:

| Statement | Top level | In `group` | In `usecase` / `alt` | In `par` |
|---|---|---|---|---|
| `title` | ✓ | | | |
| `import` | ✓ | | | |
| node | ✓ | ✓ | | |
| `group` | ✓ | ✓ | | |
| connection (`a -> b`) | ✓ | ✓ | as a step | as a step |
| `usecase` | ✓ | | | |
| `par` | | | ✓ | |
| `alt` | | | ✓ | |
| `traffic`, `requirements`, `capacity`, `entity`, `decision`, `test` | ✓ | | | |

`-x` is only valid as a step. A label is read as described in
[Use case steps](#use-case-steps): optional `x<N>` / `~<size>` prefixes on a request, an optional HTTP method and path, an optional
`json` / `xml` / `text` payload, and on a response a leading status code.

The grammar describes syntax only. The parser also checks meaning: duplicate
ids, unknown tech stacks (a warning), responses without a matching request, steps between
nodes the architecture does not connect, import cycles and missing imported
files, unknown use cases, scenarios and nodes in the high-level design
sections, and so on.
Those checks are what the language server and `proschi check` report.
