# Requirements and tests

Requirements check the numbers a design must meet: latency, availability,
cost and surviving a failure. Tests check how requests flow, such as "the
redirect reads the cache before the database". Both pass or fail in the
editor's *Results* tab and in `proschi test`.

```proschi
title "Paste bin"

user  "Visitor"    [Browser]
api   "Paste API"  [REST API]   x4
cache "Hot pastes" [Redis]      x2
db    "Pastes"     [PostgreSQL] x2

user -> api   : HTTPS
api  -> cache : RESP
api  -> db    : SQL

usecase "Read paste" {
  user -> api : GET /p/{id}
  alt "Hit" {
    api -> cache : GET paste
    api --> user : 200
  } alt "Miss" {
    api -> cache : GET paste
    api -> db    : SELECT paste
    api --> user : 200
  }
}

traffic {
  "Read paste" 2k rps mix "Hit" 80%, "Miss" 20%
}

requirements {
  p99 "Read paste" < 100ms
  survive any node failure
}

test "Reads try the cache first" {
  "Read paste" calls any cache before any database
  "Read paste" scenario "Hit" never calls any database
}
test "Clients never reach a store" {
  no path from any client to any database
}
```

> **Try it:** change `x2` to `x1` on `db`, and `survive any node failure`
> fails in the *Results* tab.

## Requirements

A `requirements` block lists targets, one per line. Each becomes a check.

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
  cost @Payments <= 500 usd/month   # a team, .tag or group id
  lag "Place order" < 30s           # queues with a drain rate
}
```

| Requirement | Holds when |
|---|---|
| Latency: `p99 "U" < 50ms` | That percentile (p50, p90, p95, p99, p999) of the use case's latency, its scenarios mixed by share, is under the limit. Without a use case, every use case with traffic is checked; `scenario "S"` checks one scenario. |
| Availability: `availability "U" >= 99.9%` | The use case's (or every use case's) availability is at least that. |
| Durability: `durable "U"` | Every success scenario writes to a durable store, synchronously, before the first request is answered. |
| Failures: `survive any node failure` | After losing any one node instance, nothing saturates and every latency target that held still holds. `survive failure of` a [selector](#selectors-and-kinds) checks only those nodes. |
| Budget: `cost <= 3000 usd/month` | Replicas plus egress cost at most that much. |
| Lag: `lag "U" < 30s` | The queues U sends to that have a [drain rate](HLD.md#queue-backlog-and-lag) keep up, and a message waits less than that in the slowest of them. |
| Scoped budget: `cost @Payments <= 500 usd/month` | The nodes the team owns cost at most that much. `cost .edge` covers the nodes with the tag, and the nodes inside a group with it; `cost group checkout` the nodes inside the group. See [budgets per team](#budgets-per-team-group-or-tag). |

Requirements need [traffic](HLD.md#traffic): a use case without traffic is
not measured.

### Budgets per team, group or tag

A total budget says what the design may cost. A scoped one says who pays:
the team that owns a node (`@Payments` after its name), a legend tag, or a
group. The *Results* tab splits the cost the same three ways, and
`proschi analyze` prints a line for each.

```proschi
title "Checkout"

legend {
  edge "At the edge" blue
}

user [Browser]
group checkout "Checkout" .edge {
  api "Checkout API" [REST API] @Payments x3
  pay "Payments"     [Go]       @Payments x2
}
db    "Orders"   [PostgreSQL] @Data x2
cache "Sessions" [Redis]

user -> api
api  -> pay
api  -> cache
pay  -> db

usecase "Pay" {
  user -> api   : POST /checkout
  api  -> cache : GET session
  api  -> pay   : charge
  pay  -> db    : INSERT payment
  api --> user  : 201
}

traffic {
  "Pay" 500 rps
}

requirements {
  cost @Payments <= 400 usd/month
  cost group checkout <= 600 usd/month
  cost <= 1500 usd/month
}
```

> **Try it:** the Payments budget fails: its five replicas cost $500, over
> its $400. Change `x3` on `api` to `x2` and it fits.

- A node counts for its own team, for every group it is inside (nested
  groups too), and for its own tag and its groups' tags. A node with no team
  is listed as *No team*.
- A budget that covers no node is a warning: an unknown team, tag or group.
  Write the team as `@Payments`, without quotes.
- Hover a team in an editor with the language server to see what it owns
  and costs, and whether it is within its budget.

## Tests

A `test` block holds assertions about the use cases' steps. All must hold.

```proschi fragment
test "Checkout answers before slow work" {
  "Checkout" never waits for any queue or any external
  "Checkout" calls ledger after gateway
  any service never calls blobs
  "Retry charge" starts at any queue
}
```

In the table, U is a use case and S a scenario, each a name in quotes, and
X and Y are [selectors](#selectors-and-kinds). After U you may add
`scenario "S"` to check one scenario only.

| Assertion | Holds when |
|---|---|
| `U calls X` | Some scenario of U has a step to X. |
| `U every scenario calls X` | Every scenario of U calls X. |
| `U never calls X` | No scenario of U calls X. |
| `U calls X before Y` | In every scenario that calls Y, X is called earlier, and some scenario calls Y. |
| `U calls Y after X` | In every scenario that calls both, the last call to Y comes after the first call to X, and some scenario calls both. |
| `U never waits for X` | No synchronous call to X happens before U's first request is answered. Async sends and later calls are fine. |
| `U writes X before responding` | Every success scenario has a synchronous, successful step to X before the answer. |
| `U calls X with GET /urls/{code}` | Some scenario sends X a request with that method and path. See [typed assertions](#typed-assertions). |
| `U uses INSERT on X` | Some scenario has a step to X whose operation is `INSERT`. |
| `U sends header Authorization to X` | Some scenario sends X a request that names the header. |
| `U responds 201` | Some scenario answers with that status, or a class such as 4xx. |
| `U has scenario S` | The scenario exists. |
| `U handles failure of X` | Some success scenario of U contains a failed call to X. |
| `U starts at X` | U's first request is sent by X. |
| `X calls Y` | Some step, in any use case, is sent by X to Y. Start with `in "U"` to look at one use case. |
| `X never calls Y` | No step is sent by X to Y. |
| `no path from X to Y` | No connection or step goes directly from X to Y. |
| `X has replicas >= 2` | Every node matching X has at least that many replicas. |

An assertion that starts with a use case is about steps that reach X; one
that starts with a selector is about the sender. Order is sequence order,
requests and responses interleaved. Unknown names and empty tests are
warnings, and two tests with one name are an error.

### Typed assertions

`calls X` holds for any step to X. When X has a [type](TYPES.md), an
assertion can also say what the step must be:

```proschi
title "Short links"

visitor [Browser]
api     [REST API]   x2
cache   [Redis]      x2
db      [PostgreSQL] x2

visitor -> api
api     -> cache
api     -> db

usecase "Shorten" {
  visitor -> api : POST /links header Idempotency-Key
  api     -> db  : INSERT link
  api    --> visitor : 201
}

usecase "Redirect" {
  visitor -> api   : GET /aZ3x9
  api     -> cache : GET code
  alt "Hit" {
    cache --> api : target
  } alt "Miss" {
    api  -> db    : SELECT link
    api ->> cache : SET code
  }
  api --> visitor : 302
}

test "Typed checks" {
  "Redirect" calls api with GET /{code}
  "Redirect" uses GET on any cache before any database
  "Redirect" scenario "Miss" uses SET on any cache after db
  "Redirect" never uses INSERT on any database
  "Shorten" uses INSERT on db before responding
  "Shorten" sends header Idempotency-Key to api
}
```

> **Try it:** change `INSERT link` to `SAVE link`. `SAVE` is a write in
> general, so `writes db before responding` would still hold, but it is not
> an operation of PostgreSQL: the editor warns, and `uses INSERT on db`
> fails.

There are three ways to say what a step is:

| Clause | A step to X matches when |
|---|---|
| `calls X with GET /urls/{code}` | Its method is `GET` and its path is `/urls/{code}`. A `{param}` or `:param` segment, in the assertion or in the step, matches any one segment, so `/urls/{code}` matches `GET /urls/aZ3x9`. A query string is ignored. |
| `uses INSERT on X` | Its operation is `INSERT`: the operation of X's type that the label names (`INSERT link`, or the method of an HTTP step). Case does not matter. |
| `sends header Authorization to X` | Its label names the header after the endpoint: `GET /feed header Authorization`. Case does not matter. A name with dashes is written as it is (`Idempotency-Key`), or in quotes. |

Each clause takes the place of `calls X` in these forms:

| Form | Holds when |
|---|---|
| `U uses OP on X` | Some scenario has a matching step to X. |
| `U every scenario uses OP on X` | Every scenario has one. |
| `U never uses OP on X` | No scenario has one. |
| `U uses OP on X before Y` | In every scenario that calls Y, a matching step to X comes earlier. |
| `U uses OP on X after Y` | In every scenario that calls both, the last matching step to X comes after the first call to Y. |
| `U uses OP on X before responding` | Every success scenario has a matching synchronous, successful step to X before the answer. |

The same goes for `calls X with …` and `sends header H to X`, and
`U calls X before responding` with no clause at all. `scenario "S"` after U
works as for the other assertions.

- An operation is matched on the step's resolved operation, so it needs a
  typed target. If no node X selects has a type with that operation, the
  assertion fails with `No node matching X has an operation 'OP'`, even
  under `never`: a misspelt name never passes by accident. A header that
  every selected type's header list leaves out fails the same way.
- Pick names every product of the kind has. `uses SET on any cache` holds
  for Redis and Memcached, because both inherit `SET` from `Cache`;
  `uses PutItem on any database` holds only for DynamoDB.
- `U responds 201` compares the status the entry request is answered with.
  The responder's type checks that status when it is written (a warning, an
  error in [strict mode](PRACTICE.md#strict-mode-and-typed-tests)).

## What-ifs

A `whatif` block is a variant of the design: more traffic, a node down, or
other replica counts. Each one is analysed on its own and checked against
the same requirements, so you can ask "does it hold on launch day?" without
editing the design. The design itself is analysed exactly as before.

```proschi
title "Paste bin"

user  "Visitor"    [Browser]
api   "Paste API"  [REST API]   x4
cache "Hot pastes" [Redis]      x2
db    "Pastes"     [PostgreSQL] x2

user -> api   : HTTPS
api  -> cache : RESP
api  -> db    : SQL

usecase "Read paste" {
  user -> api : GET /p/{id}
  alt "Hit" {
    api -> cache : GET paste
    api --> user : 200
  } alt "Miss" {
    api -> cache : GET paste
    api -> db    : SELECT paste
    api --> user : 200
  } alt "Cache down" {
    api -x cache : GET paste
    api -> db    : SELECT paste
    api --> user : 200
  }
}

traffic {
  "Read paste" 2k rps mix "Hit" 80%, "Miss" 20%, "Cache down" 0%
}

capacity {
  cache timeout 50ms
}

requirements {
  p99 "Read paste" < 200ms
  availability >= 99.9%
}

whatif "Launch day" {
  traffic "Read paste" x3
}
whatif "Cache outage" {
  fail cache
}
whatif "Database outage" {
  fail db
}
```

> **Try it:** run `proschi analyze --whatif all paste.proschi`. The cache
> outage passes, because "Cache down" takes the traffic. The database outage
> fails: the misses, 20% of reads, have no fallback.

| Line | What it changes |
|---|---|
| `traffic "U" x3` | Multiplies the use case's rate from the `traffic` block; `x1.5` and `x0.5` work too. Scenario shares stay. |
| `traffic "U" 50k rps` | Sets the use case's rate, also for a use case without traffic. |
| `fail n` | Takes node `n` down. Its availability is 0. The traffic of each scenario that needs `n` moves to the use case's [fallback scenarios](SCENARIOS.md#error-paths-and-conditions) for it, the ones that call it with `-x` and still complete. Without a fallback, that share of requests fails. |
| `n x4` | Runs `n` with that many replicas, for capacity, availability and cost. |
| `cache hit 40%` | Sets the [hit rate](HLD.md#cache-hit-rate) of a cache, such as a cold one after a restart. |
| `pay errors 20%` | Sets the [error rate](HLD.md#retries-and-partial-failure) of a node, such as after a bad deploy. Its `retries` stay. |

[Constants](HLD.md#constants) work here too: `traffic "U" $rate`,
`traffic "U" x$factor` and `n x$fleet`.

A what-if passes when every requirement holds under it. Test blocks don't
count, because they check request flows and not numbers. Unknown use cases
and nodes are warnings, and two what-ifs with one name are an error.

On the command line, `proschi analyze` adds a summary of the what-ifs to its
table: whether the requirements hold, the worst p99, the lowest
availability and the cost. `--whatif "Name"` prints the whole table under
one what-if, with each requirement's result. With `--whatif`, the command
exits with 1 when a what-if it runs fails, so CI can gate on it.

`--sweep` finds how far the design scales:

```sh
proschi analyze --sweep "Read paste" 1k..20k paste.proschi
```

It analyses the use case at ten rates across the range (`--steps` sets how
many) and prints p99, availability, cost and what saturates at each. Then it
prints the rate at which each node saturates and the highest rate at which
the requirements still hold. For the paste bin, the API saturates at 8k rps
and the p99 limit breaks just before, at 7.5k rps. Add `--whatif "Name"` to
sweep under a what-if.

## Selectors and kinds

Tests and the failure requirement take a selector, so a rule such as
"never calls any database" still holds when you add a database.

| Selector | Matches |
|---|---|
| `db` | The node with that id |
| `[PostgreSQL]` | Every node of that type, or of a type that extends it: `[Database]` also selects PostgreSQL and MySQL nodes, `[Cache]` Redis ones |
| `any database` | Every node of that kind (see the table below) |
| `any strong store`, `any eventual store` | Data stores with that consistency: relational databases and queues are strong; caches, most NoSQL, search, CDNs and object storage eventual. [Capacity](HLD.md#capacity) can change it. |
| `X or Y` | A node matching any of them, as in `never calls any cache or any database` |

A node's kind comes from its tech stack, or for an unknown tech, from its
name (see [Tech stacks](NODES.md#tech-stacks)):

| Kind | Tech stacks (examples) |
|---|---|
| `client` | Actor, Browser, Mobile App, shapes and nodes without a tech |
| `edge` | WAF, AWS WAF, Global Accelerator; `any edge` also selects the four kinds below |
| `cdn` | CDN, CloudFront, Fastly, Akamai, Cloudflare |
| `loadbalancer` | Load Balancer, AWS Load Balancer (ALB, NLB), nginx, Envoy, HAProxy |
| `gateway` | API Gateway, AWS API Gateway, Apigee, Kong |
| `dns` | DNS, Route53, Azure DNS, Cloud DNS |
| `service` | Service, Worker, REST API, gRPC, Spring Boot, Node.js, Kubernetes, ECS |
| `function` | Function, Lambda, Cloud Functions, Cloud Run, Cloudflare Workers |
| `cache` | Cache, Redis, Valkey, ElastiCache, Memcached |
| `database` | Database, PostgreSQL, MySQL, Aurora, DynamoDB, Cassandra, MongoDB, … |
| `search` | Search Engine, Elasticsearch, OpenSearch, Solr, Algolia |
| `analytics` | Data Warehouse, BigQuery, Snowflake, Redshift, ClickHouse |
| `queue` | Message Queue, SQS, Azure Queue Storage; `any queue` also selects brokers |
| `broker` | Kafka, Kinesis, SNS, EventBridge, Pub/Sub, RabbitMQ, NATS; simulated like a queue |
| `storage` | Object Storage, S3, Blob Storage, MinIO, R2 |
| `external` | Third Party API, Payment Gateway, Stripe, Twilio, Auth0 |
| `other` | groups, text nodes and the Note shape |

## Go further

- [High-level design](HLD.md): traffic and capacity, which the requirements
  measure.
- [Simulation and tests in CI](EDITORS.md#simulation-and-tests): run
  `proschi test` on every pull request.
