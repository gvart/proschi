Every service and host in a large company emits metrics: request counts, latencies, CPU, queue depths, each tagged with the host, the endpoint, the region and more. Uber's M3 took in about 500 million metrics a second in 2018 and stored only about 20 million a second. This lesson is about the gap between those two numbers, and about writing what remains safely to a replicated time series database you are not allowed to grow.

## What you'll learn

- How **pre-aggregation** and **downsampling** cut write volume by an order of magnitude, and which detail you give up.
- Why the aggregation tier should answer the hosts from memory and write to storage later.
- How **quorum writes** (write three replicas, succeed on two) keep ingestion running while a replica is down.
- Why dashboards and alerts talk to a query tier, not to the storage cluster.

## The problem, explained

You are designing one region's slice of a metrics platform. On the left are the collectors: Prometheus and the M3 collector on every host, each sending batches of 2,000 datapoints. On the right are Grafana dashboards and alert evaluators that query series over time ranges. In the middle is M3DB, a distributed time series database. The given file fixes it: two shards, each on three replicas, each replica taking 2k writes and 5k reads a second at $700 a month. You may not add shards or replicas.

Three use cases:

- **Emit metrics**: a collector sends a batch and gets `200`. Losing a few seconds of datapoints if an aggregator dies is acceptable; slowing the hosts is not.
- **Flush aggregates**: when a window closes at a resolution boundary, the aggregator writes the rolled-up datapoints to all three replicas of the shard and succeeds on a majority. Scenarios: `"All replicas up"` and `"Replica down"`, where one replica does not answer and the write still succeeds.
- **Query**: a dashboard or alert asks a query service, which reads M3DB and computes the result.

Limits: Emit p99 under 40 ms and 99.99% available; Query p99 under 80 ms and 99.9% available; flushes durable; any single machine may fail; $7,500 a month with the M3DB cluster included.

The tests, in words: emitting never calls a database; there is no path from collectors to M3DB at all; flushing starts at a service, writes M3DB before responding, has a `"Replica down"` scenario and handles an M3DB failure; queries start at Grafana, pass through a service before M3DB, and Grafana has no direct path to M3DB.

Proschi cannot say "two of three", so the statement tells you how to model it: a majority write is `x3` (every replica gets the write), and a replica that is down is `x2` plus a failed call (`-x`).

## Back-of-the-envelope

**Ingest.** 40 million datapoints a second in batches of 2,000:

40,000,000 / 2,000 = **20,000 batches a second** into the aggregation tier.

**After aggregation.** Uber's ratio of 500 million to 20 million is 25:1. Keeping one datapoint in 25:

40,000,000 / 25 = 1,600,000 datapoints a second = **800 batch writes a second**.

**Replication.** Each batch write goes to three replicas: 800 × 3 = **2,400 replica writes a second**.

**Storage capacity.** M3DB is a partitioned store, so every replica takes writes: 2 shards × 3 replicas × 2k = 12k writes a second, and 6 × 5k = 30k reads.

| Design | Replica writes/s | Share of 12k |
|---|---|---|
| Aggregate first | 800 × 3 = 2,400 | 20% |
| Store raw | 20,000 × 3 = 60,000 | 500% |

That table is the problem in one line. Raw ingestion would need five times the cluster just to keep up, before queries. Queries add 1k × 2 block reads = 2k reads a second, a small slice of 30k.

**Aggregators.** 20k batches a second at about 2k per service replica is 10 replicas at 100% busy. You want them comfortably under 70%, and still under 100% with one gone.

**Budget.** The cluster costs 6 × $700 = $4,200 of the $7,500. Services are $100 a replica, so roughly $3,300 is left for aggregators and the query tier. That is enough for a sensible aggregation tier and a small query tier, and not much more.

**Storage per day (illustrative).** If a stored datapoint compresses to about 2 bytes, 1.6 million a second is 1.6M × 86,400 × 2 bytes ≈ 276 GB a day per copy, about 830 GB with three replicas. Stored raw, multiply by 25: about 20 TB a day. The bytes-per-point figure is an assumption; time series databases compress far better than naive 16-byte timestamp-value pairs.

**In the simulation.** Utilisation above 100% means saturation, and a saturated M3DB fails every latency limit of every use case that touches it, including Query. Losing one replica re-runs the analysis with that shard down one replica, so the flush load must still fit. Availability comes from replicas multiplied along the synchronous path; the `"Replica down"` scenario is how a design states that a replica outage does not fail the flush.

## Concepts

### Pre-aggregation and downsampling

Most raw datapoints are never looked at individually. A dashboard shows "p99 latency of the checkout service per minute", not "latency reported by host 4,812 at second 17". An **aggregation tier** applies rules as datapoints stream in:

- **Roll up** across tags nobody queries: drop the host or instance tag and sum or merge the series.
- **Downsample** in time: turn ten-second points into one-minute or one-hour points for long-retention namespaces.

The aggregator keeps open windows in memory, adds each incoming datapoint to the right window, answers the collector immediately, and writes the closed window once per resolution. That decouples host latency from storage latency and divides writes by the reduction ratio.

Trade-offs: you lose detail you did not keep (you cannot later ask for one host's raw series if you dropped the host tag), an aggregator crash loses its open windows (acceptable here, by requirement), and rules need maintenance. When not to use it: audit logs, billing events, or anything where each record matters; and low-volume systems where storing raw is cheap.

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

### Quorum writes

A replicated store with **N** copies can choose how many acknowledgements a write needs (**W**) and how many replicas a read consults (**R**). Writing all three (W = 3) is the strongest, but one dead or slow replica fails or stalls every write to that shard. Writing one (W = 1) is the fastest, but a single disk loss can lose acknowledged data. **Majority** (W = 2 of 3) survives one replica down while still putting every acknowledged write on two machines. If reads also use a majority (R = 2), W + R > N guarantees a read overlaps the latest write; M3DB offers read levels including `UnstrictMajority`, which falls back to fewer replicas when a majority is not available.

The client sends to all three and returns once two answer; the third catches up later (an M3DB node that bootstraps fetches the blocks it lacks from its peers). Trade-offs: majority writes are as slow as the second-fastest replica, and you need an odd replica count for a clean majority. When not to use it: a single-leader relational database already serialises writes through one primary; quorums belong to leaderless or per-shard replicated stores.

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

Queries in PromQL or M3QL are programs: select series by tags, fetch blocks from the shards that hold them, then compute rates, sums and percentiles. If every Grafana instance did that itself, every client would need the cluster's shard layout, a storage client, and the query engine. A **query service** centralises that: it resolves which shards hold the series, fans out the reads, computes the result and can cache, limit and protect storage from expensive queries. Uber's M3 query engine served about 2,500 queries a second at the end of 2018.

When not to add one: a small single-node setup where the database itself speaks the query language (a single Prometheus server) needs no extra tier.

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

**Step 1: scope.** Confirm the input rate (40M datapoints a second), the batch size, which resolutions and retentions exist, whether short loss on aggregator failure is acceptable (yes), and that the storage cluster is fixed. That last fact turns the problem into "reduce writes by at least 5× and protect them".

**Step 2: high-level design.** Collectors → aggregation tier (answers from memory) → periodic flush with majority writes → M3DB. Grafana and alerts → query tier → M3DB. Draw the two flows separately; they share only the store.

**Step 3: deep dive.**

*Routing to aggregators.* Shard aggregators by series id so all datapoints of one series land on the same instance, otherwise two instances produce partial aggregates that collide in storage. (The simulation spreads load evenly and does not model this, but you should say it.)

*Flush semantics.* Model the flush as a call from the aggregator to M3DB with three replica writes, and a second scenario where one fails and the flush still succeeds. Put the "Replica down" share at what you would expect in practice (a small fraction of a percent).

*Sizing.* Aggregators for 20k batches a second with headroom and a spare; a query tier with at least two replicas for availability and more if its load needs it; then verify the M3DB utilisation stays low with one replica gone and that the bill fits.

*What the collectors see.* The emit path is collector → aggregator → `200`, with nothing else synchronous. Storage hiccups now only delay flushes.

**Step 4: wrap-up.** Discuss cardinality explosions (a tag with user ids creates millions of series), late and out-of-order datapoints, aggregator failover (a standby per shard), and multi-region queries. Note what Proschi does not model: the windows themselves, bytes on disk, compaction and peer streaming.

## Common mistakes

**Store raw datapoints** (`wrong/store-raw-datapoints`). Hosts write their batches straight into M3DB and a downsampling job compacts later. That is the "simple" design, and it sends 60k replica writes a second at a cluster that takes 12k. In Proschi M3DB saturates, so Emit p99 fails, then Query too; the flow tests "Ingest never waits for storage" and "Only aggregates reach storage" fail as well.

**Write through on every batch** (`wrong/write-through-on-every-batch`). The aggregator exists but also writes each raw batch to M3DB before answering, "to be safe". It brings back both problems: hosts wait for a quorum write, and storage takes the raw volume. It fails "Ingest never waits for storage" and `p99 of Emit metrics < 40 ms`.

**Wait for all replicas** (`wrong/wait-for-all-replicas`). Consistency level `all`: when one replica is down, every flush to its shard fails with an error. Real clusters always have a replica restarting, being upgraded or replaced somewhere, so this turns routine maintenance into data loss or backpressure. Proschi catches it with "A quorum write survives a replica that is down", because the `"Replica down"` scenario never succeeds.

**Dashboards read M3DB directly** (`wrong/dashboards-read-m3db`). It looks faster (one hop fewer) and the latency numbers even improve. But every dashboard now needs the shard layout and a query engine, and nothing stands between an expensive query and the storage nodes. It fails "Queries go through the query tier".

**Also common:** unbounded tag values (user ids, request ids) in metric labels, and treating metrics like logs (keeping every point forever at full resolution).

## In the interview

Open with the ratio: "40 million in, the cluster takes 12 thousand replica writes a second; that is the whole design pressure." Then show the 20% versus 500% table. Interviewers love seeing the constraint drive the architecture.

Likely follow-ups:

- *What do you lose by aggregating?* Per-host detail and sub-resolution precision for the rolled-up namespaces. Keep a short-retention raw namespace for the few metrics that need it.
- *An aggregator dies with open windows?* Those seconds are lost (accepted), or run aggregators in leader/follower pairs that both receive data and only the leader flushes.
- *Why majority, not all?* Availability during routine replica loss with two durable copies of every acknowledged write.
- *How do reads stay consistent?* Majority or unstrict-majority reads; for monitoring, slightly stale is usually fine.
- *Cardinality explosion?* Limit tags per metric, reject or drop high-cardinality labels at the aggregator, and alert on series growth.

## Further reading

- [M3: Uber's Open Source, Large-scale Metrics Platform for Prometheus](https://www.uber.com/blog/m3/), Uber Engineering, 2018: the aggregation tier, quorum writes, and the 500M versus 20M figures.
- [The Billion Data Point Challenge: Building a Query Engine for High Cardinality Time Series Data](https://www.uber.com/blog/billion-data-point-challenge/), Uber Engineering, 2018: the query tier and its scale.
- [M3DB consistency levels](https://github.com/m3db/m3/blob/master/site/content/architecture/m3db/consistencylevels.md): write levels one, majority and all, and the read levels including unstrict majority.
- [M3DB sharding](https://github.com/m3db/m3/blob/master/site/content/architecture/m3db/sharding.md): series hashed to virtual shards placed on replicas.
- [Dynamo: Amazon's Highly Available Key-value Store](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf), DeCandia et al., 2007: the classic description of N, R and W quorums (linked from the System Design Primer's "Additional system design interview questions").
- [awesome-scalability](https://github.com/binhnguyennus/awesome-scalability): the "Distributed Monitoring and Alerting" section collects M3 and monitoring platforms from Netflix, LinkedIn, Dropbox and others.
- *System Design Interview – An Insider's Guide*, Vol. 2 (Alex Xu and Sahn Lam): chapter 5 on metrics monitoring covers ingestion, time series storage, downsampling and alerting.
