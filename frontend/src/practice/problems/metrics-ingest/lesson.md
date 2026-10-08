```tldr
Storing raw datapoints needs **five times the cluster** you have, so cut writes: an **aggregation tier** answers hosts from memory and **flushes rolled-up windows** later with **majority writes** (two of three), so a replica outage changes nothing. Dashboards go through a **query tier**, never straight to storage.
```

Every service and host emits metrics (request counts, latencies, CPU, queue depths) tagged with host, endpoint, region and more. Uber's M3 took in about 500 million a second in 2018 and stored only about 20 million. This lesson is about that gap, and about storing the rest safely in a replicated time series database you may not grow.

## What you'll learn

- How **pre-aggregation** and **downsampling** cut write volume by an order of magnitude, and which detail you give up.
- Why the aggregation tier should answer the hosts from memory and write to storage later.
- How **quorum writes** (write three replicas, succeed on two) keep ingestion running while a replica is down.
- Why dashboards and alerts talk to a query tier, not to the storage cluster.

## The problem, explained

You are designing one region's slice of a metrics platform:

- **Left**: the collectors, Prometheus and the M3 collector on every host, each sending batches of 2,000 datapoints.
- **Right**: Grafana dashboards and alert evaluators that query series over time ranges.
- **Middle**: M3DB, a distributed time series database fixed by the given file: two shards × three replicas, each replica taking 2k writes and 5k reads a second at $700 a month. No extra shards or replicas.

Three use cases:

- **Emit metrics**: a collector sends a batch and gets `200`. Losing a few seconds of datapoints when an aggregator dies is fine; slowing the hosts is not.
- **Flush aggregates**: when a window closes at a resolution boundary, the aggregator writes the rolled-up datapoints to the shard's three replicas and succeeds on a majority. Scenarios: `"All replicas up"` and `"Replica down"` (one replica does not answer; the write still succeeds).
- **Query**: a dashboard or alert asks a query service, which reads M3DB and computes the result.

Limits: Emit p99 (the latency 99% of requests beat) under 40 ms and 99.99% available; Query p99 under 80 ms and 99.9% available; flushes durable; any single machine may fail; $7,500 a month with the M3DB cluster included.

The tests, in words:

- Emitting never calls a database, and no path leads from the collectors to M3DB.
- Flushing starts at a service, writes M3DB before responding, has a `"Replica down"` scenario and handles an M3DB failure.
- Queries start at Grafana and pass through a service before M3DB; Grafana has no direct path to it.

Proschi cannot say "two of three", so model it as the statement says: a majority write is `x3` (every replica gets the write), and a replica that is down is `x2` plus a failed call (`-x`).

## Back-of-the-envelope

```numbers
20,000 | batches a second into the aggregators
25 : 1 | Uber's ingest-to-stored ratio
2,400 | replica writes a second after aggregation
12k | replica writes a second the cluster takes
$4,200 | of the $7,500 already spent on M3DB
```

| Quantity | Arithmetic | Result |
|---|---|---|
| Ingest batches | 40,000,000 / 2,000 | **20,000 batches/s** |
| Datapoints after aggregation (25:1, Uber's 500M to 20M) | 40,000,000 / 25 | 1,600,000/s = **800 batch writes/s** |
| Replica writes | 800 × 3 | **2,400/s** |
| Cluster write capacity (partitioned: every replica takes writes) | 2 shards × 3 replicas × 2k | 12k/s |
| Cluster read capacity | 6 × 5k | 30k/s |

| Design | Replica writes/s | Share of 12k |
|---|---|---|
| Aggregate first | 800 × 3 = 2,400 | 20% |
| Store raw | 20,000 × 3 = 60,000 | 500% |

```callout takeaway That table is the whole problem
Raw ingestion needs five times the cluster before any queries. Queries add only 1k × 2 block reads = 2k reads a second, a small slice of 30k.
```

**Aggregators.** 20k batches a second at about 2k per service replica is 10 replicas at 100%. Keep them comfortably under 70%, and under 100% with one gone.

**Budget.** The cluster costs 6 × $700 = $4,200 of the $7,500. At $100 a service replica, roughly $3,300 is left: a sensible aggregation tier and a small query tier, not much more.

```deepdive Storage per day (illustrative)
At about 2 bytes per compressed datapoint, 1.6M × 86,400 × 2 bytes ≈ 276 GB a day per copy, about 830 GB with three replicas. Raw, multiply by 25: about 20 TB a day with three replicas. The 2 bytes is an assumption; time series databases compress far better than naive 16-byte timestamp-value pairs.
```

**In the simulation.** Above 100% utilisation M3DB saturates and fails the latency limit of every use case touching it, Query included. `survive any node failure` re-runs with one replica fewer, so the flush load must still fit. Availability multiplies across the replicas of every node on the synchronous path. The `"Replica down"` scenario states that a replica outage does not fail the flush.

```quiz
metrics-ingest-rate
```

## Concepts

### Pre-aggregation and downsampling

Nobody reads most raw datapoints. A dashboard shows "p99 latency of the checkout service per minute", not "latency reported by host 4,812 at second 17". An **aggregation tier** applies rules as datapoints stream in:

- **Roll up** across tags nobody queries: drop the host or instance tag and sum or merge the series.
- **Downsample** in time: turn ten-second points into one-minute or one-hour points for long-retention namespaces.

The aggregator keeps open windows in memory, adds each datapoint to one, answers the collector at once, and writes each closed window once per resolution. Host latency stops depending on storage, and writes shrink by the reduction ratio.

**Trade-offs.** Detail you did not keep is gone (no raw series for one host once the host tag is dropped). An aggregator crash loses its open windows (acceptable here). The rules need maintenance.

**When not to use it.** Audit logs, billing events, or anything where each record matters; also low-volume systems, where storing raw data is cheap.

```proschi
title "Aggregate in memory, flush later"

source "Sources"     [Actor]
agg    "Aggregators" [Go]              x4
tsdb   "TSDB"        [NoSQL Database]  x3

source -> agg  : batches
agg    -> tsdb : flush

usecase "Ingest" {
  source -> agg    : POST /write batch
  agg   --> source : 200
}

usecase "Flush" {
  agg   -> tsdb : WRITE rolled-up window
  tsdb --> agg  : ok
}
```

```quiz
pre-aggregate-counts
```

### Quorum writes

A store with **N** copies chooses how many acknowledgements a write needs (**W**) and how many replicas a read consults (**R**):

| Write level | Survives a replica down? | Risk |
|---|---|---|
| W = 3 (all) | No: one dead or slow replica fails or stalls every write to that shard | Strongest, least available |
| W = 1 | Yes | A single disk loss can lose acknowledged data |
| **W = 2 of 3 (majority)** | Yes | Every acknowledged write is on two machines |

With majority reads too (R = 2), W + R > N guarantees a read overlaps the latest write. M3DB's read levels include `UnstrictMajority`, which falls back to fewer replicas when no majority is available.

The client sends to all three and returns once two answer. The third catches up later (a bootstrapping M3DB node fetches missing blocks from its peers).

**Trade-offs.** A majority write is as slow as the second-fastest replica, and a clean majority needs an odd replica count. **When not to use it:** a single-leader relational database already serialises writes through one primary; quorums belong to leaderless or per-shard replicated stores.

```proschi
title "Majority write"

writer "Writer"       [Go]             x2
store  "Replicated DB" [NoSQL Database] x3

writer -> store : write

usecase "Write" {
  alt "All up" {
    writer -> store  : x3 WRITE record
    store --> writer : majority acked
  } alt "One down" {
    writer -> store  : x2 WRITE record
    writer -x store  : WRITE to the third replica
    store --> writer : majority acked
  }
}
```

### A query tier in front of storage

Queries in PromQL or M3QL are programs: select series by tags, fetch blocks from their shards, compute rates, sums and percentiles. Without a tier in between, every Grafana instance needs the shard layout, a storage client and the query engine.

A **query service** does it in one place: find the shards, fan out the reads, compute the result. It can also cache results and limit expensive queries to protect storage. Uber's M3 query engine served about 2,500 queries a second at the end of 2018.

**When not to add one.** A small single-node setup where the database itself speaks the query language (a single Prometheus server) needs no extra tier.

```proschi
title "Query tier"

ui    "Dashboards"   [Actor]
query "Query Engine" [Go]             x2
store "Series Store" [NoSQL Database] x3

ui    -> query : PromQL over HTTP
query -> store : fetch

usecase "Run query" {
  ui     -> query : GET /api/v1/query_range
  query  -> store : x2 FETCH blocks
  store --> query : datapoints
  query --> ui    : 200
}
```

## Designing it step by step

**Step 1: scope.** Confirm the input rate (40M datapoints a second), the batch size, the resolutions and retentions, whether short loss on aggregator failure is acceptable (yes), and that the storage cluster is fixed. That last fact makes the problem "reduce writes by at least 5× and protect them".

**Step 2: high-level design.** Two flows that share only the store:

- Collectors → aggregation tier (answers from memory) → periodic flush with majority writes → M3DB.
- Grafana and alerts → query tier → M3DB.

**Step 3: deep dive.**

*Routing to aggregators.* Shard aggregators by series id so one series always lands on the same instance; otherwise two instances write partial aggregates that collide in storage. (The simulation spreads load evenly and does not model this, but say it.)

*Flush semantics.* Model the flush as aggregator → M3DB with three replica writes, plus a scenario where one fails and the flush still succeeds. Give `"Replica down"` a realistic share (a small fraction of a percent).

*Sizing.* Aggregators for 20k batches a second with headroom and a spare; a query tier of at least two replicas, more if its load needs it. Check M3DB utilisation stays low with one replica gone, and that the bill fits.

*What the collectors see.* The emit path is collector → aggregator → `200`, with nothing else synchronous. Storage hiccups now only delay flushes.

**Step 4: wrap-up.** Discuss cardinality explosions (a user-id tag creates millions of series), late and out-of-order datapoints, aggregator failover (a standby per shard) and multi-region queries. Note what Proschi does not model: the windows, bytes on disk, compaction, peer streaming.

```quiz
metric-cardinality
```

## Common mistakes

**Store raw datapoints** (`wrong/store-raw-datapoints`). Hosts write batches straight into M3DB and a downsampling job compacts later: 60k replica writes a second at a cluster that takes 12k. In Proschi M3DB saturates, so Emit p99 fails, then Query too; the flow tests "Ingest never waits for storage" and "Only aggregates reach storage" fail as well.

**Write through on every batch** (`wrong/write-through-on-every-batch`). The aggregator also writes each raw batch to M3DB before answering, "to be safe". Both problems return: hosts wait for a quorum write, storage takes the raw volume. It fails "Ingest never waits for storage" and `p99 of Emit metrics < 40 ms`.

**Wait for all replicas** (`wrong/wait-for-all-replicas`). This is consistency level `all`: when one replica is down, every flush to its shard fails. Real clusters always have a replica restarting, upgrading or being replaced, so routine maintenance becomes data loss or back pressure. Proschi catches it with "A quorum write survives a replica that is down", because the `"Replica down"` scenario never succeeds.

```callout pitfall One hop fewer is not a win
**Dashboards read M3DB directly** (`wrong/dashboards-read-m3db`). It looks faster and latency even improves. But every dashboard needs the shard layout and a query engine, and nothing shields storage from an expensive query. It fails "Queries go through the query tier".
```

**Also common:** unbounded tag values (user ids, request ids) in metric labels, and treating metrics like logs (keeping every point forever at full resolution).

## In the interview

```callout interview Open with the ratio
"40 million datapoints come in (20k batches a second), and the cluster takes only 12 thousand replica writes a second; that is the whole design pressure." Then show the 20% versus 500% table. Interviewers love seeing a constraint drive the architecture.
```

Likely follow-ups:

- *What do you lose by aggregating?* Per-host detail and sub-resolution precision in rolled-up namespaces. Keep a short-retention raw namespace for the few metrics that need it.
- *An aggregator dies with open windows?* Those seconds are lost (accepted), or run leader/follower pairs: both receive the data, only the leader flushes.
- *Why majority, not all?* Writes stay available while a replica is down for routine reasons, and every acknowledged write still has two copies.
- *How do reads stay consistent?* Majority or unstrict-majority reads; for monitoring, slightly stale is usually fine.
- *Cardinality explosion?* Limit tags per metric, reject or drop high-cardinality labels at the aggregator, and alert on series growth.

## Further reading

- [M3: Uber's Open Source, Large-scale Metrics Platform for Prometheus](https://www.uber.com/blog/m3/), Uber Engineering, 2018: aggregation tier, quorum writes, the 500M versus 20M figures.
- [The Billion Data Point Challenge: Building a Query Engine for High Cardinality Time Series Data](https://www.uber.com/blog/billion-data-point-challenge/), Uber Engineering, 2018: the query tier.
- [M3DB consistency levels](https://github.com/m3db/m3/blob/master/site/content/architecture/m3db/consistencylevels.md): write levels one, majority and all, and the read levels including unstrict majority.
- [M3DB sharding](https://github.com/m3db/m3/blob/master/site/content/architecture/m3db/sharding.md): series hashed to virtual shards placed on replicas.
- [Dynamo: Amazon's Highly Available Key-value Store](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf), DeCandia et al., 2007: the classic N, R and W quorums (in the System Design Primer's "Real world architectures").
- [awesome-scalability](https://github.com/binhnguyennus/awesome-scalability): "Distributed Monitoring and Alerting" collects M3 and platforms from Netflix, LinkedIn, Dropbox and others.
- *System Design Interview – An Insider's Guide*, Vol. 2 (Alex Xu and Sahn Lam): chapter 5, metrics monitoring: ingestion, time series storage, downsampling, alerting.
