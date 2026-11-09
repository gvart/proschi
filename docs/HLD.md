# High-level design

A high-level design adds what a design review asks after the architecture:
how much traffic comes in, what each node can take, what data lives where
and why. With it, the simulation can test the design, not only draw it.

Each part is a top-level block. This URL shortener uses them all, with
[requirements](TESTS.md#requirements) to check:

```proschi
title "URL Shortener" "Short codes that redirect to long URLs"

user  "Visitor"       [Browser]
api   "Shortener API" [REST API]   x12
cache "Code cache"    [Redis]      x3
db    "URL store"     [PostgreSQL] x3

user -> api   : HTTPS
api  -> cache : RESP
api  -> db    : SQL

usecase "Redirect" {
  user -> api : GET /{code}
  alt "Cache hit" {
    api -> cache : GET code
    api --> user : 301
  } alt "Cache miss" {
    api -> cache : GET code
    api -> db    : SELECT url
    api -> cache : SET code
    api --> user : 301
  }
}

usecase "Shorten" {
  user -> api  : POST /urls {"target": "https://example.com"}
  api  -> db   : INSERT url
  api --> user : 201 {"code": "k7Qz2"}
}

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
  api 15k rps
  db  20k rps latency 4ms
}

entity Url in db "One short code and where it points" {
  code      string key
  target    string
  createdAt time   index
}

decision "Cache redirects in Redis" {
  because "Reads outnumber writes 100:1; p99 must stay under 100 ms"
  rejected "Read replicas only" "5 ms a read, many replicas at 100k rps"
}
```

> **Try it:** change the mix to `"Cache hit" 50%, "Cache miss" 50%`, open
> the example in the editor, and `survive any node failure` fails in the
> *Results* tab.

How these blocks become numbers is on
[How the simulation works](https://proschi.app/docs/model/).

- **The opening words are keywords only in that shape** (`traffic` and a
  brace, `entity` and a name), so they still work as node ids.
- **A broken line is skipped, not the block.** A malformed line is an
  error, and the rest is read. A block inside a group or use case is an
  error.

## Quantities

Every number in these blocks is a quantity: a number, an optional magnitude
(k, m or b) and a unit.

| Kind | Units | Examples |
|---|---|---|
| Rate | rps, rpm, rpd (requests per second, minute, day) | `100k rps`, `6k rpm` |
| Duration | ms, s | `50ms`, `1.5s` |
| Share or availability | % | `99.9%` |
| Cost | usd/month, usd/GB (egress price) | `3000 usd/month` |
| Bandwidth | MB/s, GB/s | `500 MB/s` |

The unit may be attached or one space away (`50ms`, `50 ms`). Rates become
requests per second (6k rpm is 100 rps). A missing or wrong unit is an error
that names the one expected.

## Constants

A number that shows up in several places gets a name: `let`, the name,
`=` and the value. Write `$name` wherever a value of that kind goes, and
`x$name` for replicas and what-if multipliers.

```proschi
title "Checkout"

let orders = 2k rps
let fleet = 3
let slo = 300ms
let budget = 1500 usd/month
let launch = 2
let launchFleet = 4

shop "Shop"         [Browser]
api  "Checkout API" [REST API]   x$fleet
db   "Orders"       [PostgreSQL] x2

shop -> api : HTTPS
api  -> db  : SQL

usecase "Checkout" {
  shop -> api  : POST /orders
  api  -> db   : INSERT order
  api --> shop : 201
}

traffic {
  "Checkout" $orders
}

requirements {
  p99 "Checkout" < $slo
  cost <= $budget
}

whatif "Launch day" {
  traffic "Checkout" x$launch
  api x$launchFleet
}
```

> **Try it:** set `let orders = 3k rps`. The traffic follows, and so does
> "Launch day", which now sends 6k rps: the Orders database, whose writes
> all go to one primary, saturates.

- **A value has a kind.** `let peak = 2k rps` is a rate, `let slo = 300ms` a
  duration, `let fleet = 3` a plain number. Using one where another kind
  goes, like `$slo` as a rate, is an error that says what was expected.
- **`x$name` takes a plain number**: whole and at least 1 for replicas
  (`api x$fleet`, `shards $n` in capacity), any number for a what-if's
  `traffic "U" x$factor`.
- **Constants are top level.** A `let` may come after the lines that use
  it. An unknown name and a name defined twice are errors.
- The editor plugins show a constant's value on hover, jump to its `let`,
  and rename it everywhere.

## Traffic

Traffic is the load: requests per second for each use case, split over its
scenarios. Without it the simulation measures nothing, so add it first.

- One line per use case: its name in quotes, then a rate, as in the
  example above.
- `peak` gives the busiest hour: `"Read" 20k rps peak x3` averages 20k rps
  and peaks at 60k, and so does `"Read" 20k rps peak 60k rps`. Capacity,
  latency and requirements are taken at the peak, because that is when a
  node saturates. Egress is costed at the average, because the bill is for
  the whole month. The results show both: avg 20k · peak 60k rps. A rate
  without `peak` is both, as before.

```proschi
title "Photo feed"

phone "Phone"    [Mobile App]
api   "Feed API" [REST API]   x6
cache "Feeds"    [Redis]      x2

phone -> api   : HTTPS
api   -> cache : RESP

usecase "Open feed" {
  phone -> api   : ~5KB GET /feed
  api   -> cache : GET feed
  api  --> phone : 200
}

traffic {
  "Open feed" 2k rps peak x4
}

requirements {
  p99 "Open feed" < 100ms
}
```

> **Try it:** replace `2k rps peak x4` with a flat `8k rps`. The Feed API
> runs just as hot, but the egress bill is four times as large.
- `mix` splits the traffic over the [scenarios](SCENARIOS.md) by their full
  names ("A › B" for nested ones). Without it, all the traffic goes to the
  first scenario.
- Shares that don't add up to 100% are scaled to fit, with a warning.
- An unknown use case or scenario name is a warning. Two lines for the same
  use case are an error.

## Capacity

Every node starts with its tech stack's default
[profile](https://proschi.app/docs/model/#profiles). When you know better,
from a benchmark or production, write it here: one line per node id, parts
in any order, numbers per replica.

```proschi fragment
capacity {
  db    20k rps latency 4ms availability 99.95% cost 400 usd/month
  cache 150k rps volatile
  users reads 30k rps writes 8k rps shards 4 consistency strong
  blobs bandwidth 500 MB/s egress 0.05 usd/GB
  pay   timeout 300ms
}
```

| Part | Meaning |
|---|---|
| a rate | Requests per second, reads and writes alike |
| `reads`, `writes` | Separate read and write capacity |
| `shards` | Number of shards. A store with a single primary scales writes with shards, not replicas. |
| `size S`, `M` or `L` | Instance size: the default capacity ×1, ×2 or ×4, for ×1, ×1.8 or ×3.5 the cost. An explicit rate or cost wins. |
| `latency` | Latency per call |
| `availability` | Availability |
| `cost` | Monthly cost |
| `durable`, `volatile` | Whether a write there survives a crash |
| `consistency strong`, `consistency eventual` | Whether `any strong store` or `any eventual store` matches it |
| `bandwidth` | Network bandwidth, for transfer time |
| `egress` | Price per GB sent to clients and third parties |
| `timeout` | What a failed call to the node costs; 1 s by default |
| `hit` | A cache's hit rate, which derives the load behind it: see below |
| `errors`, `retries` | The share of calls that fail, and how often callers try again: see below |
| `drain` | How fast a queue's consumers take messages off it: see below |

An unknown node id is a warning, and so are `shards` or `consistency` on a
non-store. A repeated part, a rate with `reads` or `writes`, and a second
line for one node are errors.

![A load gauge for Orders DB with a capacity of 2k rps: 1.2k rps is sent, it runs hot from 1.4k (70%) and saturates at 2k (100%), so it takes 200 more rps before it runs hot and 800 more before it saturates](images/concepts/headroom.svg "Headroom: how much more load a node takes before it runs hot (70%) and before it saturates (100%).")

### Cache hit rate

`hit 90%` on a cache says how many reads it answers itself. The rest, the
misses, go on to what is behind it, and the simulation sends that share of
the load there without a scenario for each case.

```proschi
title "Product pages"

user  "Shopper"  [Browser]
api   "Catalog"  [REST API]   x4
cache "Products" [Redis]      x2
db    "Catalog"  [PostgreSQL] x2

user -> api   : HTTPS
api  -> cache : RESP
api  -> db    : SQL

usecase "View product" {
  user -> api   : GET /products/{id}
  api  -> cache : GET product
  api  -> db    : SELECT product
  api  -> cache : SET product
  api --> user  : 200
}

traffic {
  "View product" 4k rps
}

capacity {
  cache hit 90%
}

requirements {
  p99 "View product" < 150ms
}

whatif "Cold cache" {
  cache hit 40%
}
```

> **Try it:** the database takes 400 rps, a tenth of the reads. Run the
> "Cold cache" what-if: at a 40% hit rate it takes 2.4k rps, six times as
> many.

- **What counts as the miss path.** After a read of the cache, the reads
  the same caller sends to a store behind it (a database, search, analytics
  or object storage), the calls the cache makes itself (a read-through
  cache, a CDN fetching from its origin), and whatever those calls lead to.
  Each takes `1 − hit` of the rate, and behind two caches the product.
- **Filling the cache is part of the miss.** The caller's write back to the
  same cache after a miss, as `SET product` above, also takes `1 − hit`.
  Other writes keep the full rate.
- **A mix wins.** A use case that splits hits and misses into
  [scenarios](SCENARIOS.md) with a traffic `mix`, like the URL shortener at
  the top, is left to its mix, and an info diagnostic says so.
- **Latency mixes hits and misses.** A hit skips its miss path, so p50
  follows the hit path and the tail the misses: the same percentiles as a
  `Cache hit` and a `Cache miss` scenario with a 90/10 mix.
- A rate over 100% is an error, and `hit` on a node that is not a cache or
  CDN is a warning. `cache hit 40%` in a [what-if](TESTS.md#what-ifs) tries
  another rate.

### Retries and partial failure

A dependency that is up can still fail some calls. `errors 2%` says how
many, and `retries 3` how many times a caller tries a failed call again.
Retries buy availability with load and latency.

```proschi
title "Checkout"

user "Shopper"  [Browser]
api  "Checkout" [REST API] x4
pay  "Payments" [Go]       x2

user -> api : HTTPS
api  -> pay : gRPC

usecase "Pay" {
  user -> api : POST /checkout
  api  -> pay : charge
  api --> user : 201
}

traffic {
  "Pay" 2k rps
}

capacity {
  pay errors 2% retries 3
}

requirements {
  availability "Pay" >= 99.9%
  p99 "Pay" < 120ms
}

whatif "Bad deploy" {
  pay errors 10%
}
```

> **Try it:** without `retries 3`, 2% of payments fail and the
> availability requirement breaks. With them, even the "Bad deploy" what-if
> holds 99.9%, but Payments takes 1.11 calls a request and the p99 grows.

- **Load.** A call fails with probability e, and each failure is tried
  again, up to `retries` times. A request makes `1 + e + e² + … + e^retries`
  calls on average, and the node gets that much more load. What it calls in
  turn is not repeated: the failure happened in it.
- **Availability.** A call fails only when every attempt does, with
  probability `e^(retries + 1)`. A use case's availability is multiplied by
  `1 − e^(retries + 1)` for each node on its main path with an error rate.
  Without `retries`, `errors 2%` alone takes 2% off.
- **Latency.** Each attempt takes the whole hop again, with no backoff. The
  path is split into a variant per attempt count, k + 1 attempts with
  probability `e^k (1 − e)` and all of them with `e^retries`, and mixed by
  those shares, as cache hits and misses are.
- **Retry storms.** A node with errors and retries that runs hot (70% or
  more) gets a warning. When it saturates, more of its calls fail, and each
  failure comes back up to `retries` more times, so its load can grow to
  `retries + 1` times: the retries keep it saturated.
- An error rate over 100% and retries outside 0 to 5 are errors.
  `pay errors 10%` in a [what-if](TESTS.md#what-ifs) tries another rate,
  with the retries the capacity line gives.

### Queue backlog and lag

`drain 5k rps` on a queue or broker says how fast its consumers take
messages off it. When more flows in, the backlog grows; when less does, a
message waits a short while, the consumer lag. A `lag` requirement checks
it.

```proschi
title "Order events"

user   "Shopper"     [Browser]
api    "Orders"      [REST API] x4
events "Order events" [Kafka]   x3
mailer "Mailer"      [Worker]   x4

user   -> api    : HTTPS
api    -> events : publish
events -> mailer : consume

usecase "Place order" {
  user  -> api    : POST /orders
  api  ->> events : publish order placed
  api  --> user   : 202
  events ->> mailer : order placed
}

traffic {
  "Place order" 2k rps peak x2
}

capacity {
  events drain 3k rps
}

requirements {
  lag "Place order" < 30s
}
```

> **Try it:** at the 4k rps peak, the mailer drains only 3k rps, so the
> backlog grows by 3.6M messages an hour and the lag requirement fails.
> Change `drain 3k rps` to `drain 5k rps`, and a message waits under a
> millisecond.

- **Inflow** is every request to the queue, at the analysed rate (the peak
  for `peak` traffic). The drain rate is what all its consumers take
  together.
- **Backlog.** With more inflow than drain, the backlog grows by
  `(inflow − drain) × 3600` messages an hour, a warning says so, and the
  queue shows over 100% on the canvas.
- **Lag.** Otherwise a message waits the queueing delay of the consumers
  as one M/M/1 server that drains at that rate: `ρ ÷ (drain − inflow)`,
  with `ρ = inflow ÷ drain`. The *Results* tab lists each queue's backlog
  or lag.
- `lag "U" < 30s` holds when no queue U sends to falls behind and the
  slowest of them has a lag under the limit. A use case that sends to no
  queue with a drain rate fails it.
- `drain` on a node that is not a queue or broker is a warning.

## Entities

An entity names a kind of record, its fields and the store that holds it,
like `Url` in the example above. Entities are documentation: the simulation
doesn't use them.

- The first line is the name, then optionally `in` and the id of the node
  that stores it, and a description in quotes.
- Then one field per line: a name, a free-form type (string, int, time)
  and any of the flags `key`, `index`, `unique` and `optional`.
- Placing an entity in a node that is not a data store (cache, database,
  search, analytics, queue, broker or storage
  [kind](TESTS.md#selectors-and-kinds)) is a warning.

## Decisions

A decision records what was chosen and why, and which options were rejected
and why. Like entities, decisions are documentation.

```proschi fragment
decision "Cache redirects in Redis" {
  because "Reads outnumber writes 100:1; p99 must stay under 50 ms"
  rejected "Read replicas only" "5 ms a read, many replicas at 100k rps"
  rejected "Memcached" "No replication; losing a node empties the cache"
}
decision "Base62 codes from a counter" because "Short and unique"
```

A decision has at most one `because` and any number of `rejected` lines
(the option, then the reason). The one-line form takes only `because`.

## Go further

- [Requirements and tests](TESTS.md): the checks on these numbers.
- [HLD documents](EDITORS.md#hld-documents): render the design as a
  document from the command line.
