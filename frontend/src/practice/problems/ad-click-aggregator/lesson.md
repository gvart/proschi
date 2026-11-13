# Ad click aggregation: counting money exactly once, in minutes

```tldr
Ad clicks are billed, so each one must count **exactly once**. The app's request only **appends the event to Kafka**. A stream job **deduplicates and counts per ad in one-minute windows** in memory, and writes one record per ad and minute in a **Kafka transaction committed only after its checkpoint**. Billing and the OLAP store behind the dashboards read **only committed aggregates**, deduplicated by a record UUID.
```

## What you'll learn

- Why the request that reports a click should do nothing but append it to a durable log.
- How **pre-aggregating in tumbling windows** turns 20k events a second into about 500 records a second, and why that is what makes the OLAP store and the billing path affordable.
- What **exactly once** really means in a stream pipeline: checkpoints for the job's state, **transactions committed at the checkpoint** for its output, and **idempotent sinks** for everyone downstream.
- Why billing and dashboards should read the **same** committed numbers.
- How to size a stream pipeline: the ingest and aggregation tiers for the event rate, the sinks for the aggregate rate.

## The problem, explained

Uber Eats shows ads for restaurants. Each time the app shows an ad, it reports an **impression**; each time someone taps one, a **click**. Restaurants pay for these, so the counts are money. Uber's ads team, writing in 2021, set three requirements for the pipeline that counts them:

- **Fast.** The budget service needs fresh numbers to pace ads (spread a daily budget over the day instead of spending it by noon), and advertisers want to see their campaign's results soon after they happen.
- **Reliable.** An event that is lost is revenue that is lost, and a campaign that looks worse than it was.
- **Accurate.** A click counted twice overcharges the advertiser. Uber is the marketplace and the ad seller at once, so it has to be right.

This looks like other counting problems on the roadmap. **View counting** counts unique viewers, approximately, with HyperLogLog; a view off by 1% is fine. **Trending topics** ranks terms, and nobody can tell if a count is slightly off. **Metrics ingest** aggregates measurements where losing a few seconds is acceptable. Here none of that holds: the count is an invoice line, so it must be **exact** and **exactly once**, and the same number must reach both the bill and the dashboard.

In this exercise you build one region of Uber's design. Seven use cases: the app's **Record event**, the job's **Aggregate events**, **Publish aggregates** and **Checkpoint**, Pinot's **Load aggregates**, the budget service's **Update budget**, and the advertiser's **View report**.

## Back-of-the-envelope

Uber's post gives one volume, hundreds of millions of ad events a week. The rates below are the exercise's assumptions for a peak with room to grow.

```numbers
20k / s | ad events at peak
40× | fewer writes after one-minute windows: **500 / s**
16 + 16 | ingest and aggregation replicas at 2k each
3 | Pinot servers for 1.5k operations a second
≤ 3 min | how stale an aggregate can be
$7,500 | a month for the reference design
```

**Ingest and aggregation.** 20k events a second at about 2k per replica is 10 replicas at 100%. To stay under 70% after losing one, 15 must survive: **16**, at 63% busy. The aggregation job reads the same 20k a second, so it needs the same 16.

**Kafka.** A broker takes about 50k writes a second in the simulation, so the raw topic's 20k fit on 3 brokers (13%) with room to lose one. The aggregates topic takes 500 a second; 2 brokers are plenty.

**Windows.** If about 30k ads have events in a given minute, the job emits 30k records a minute: **500 a second**, 40 times fewer than the events. That is what Pinot and the budget service must take.

**Pinot.** 500 writes and 1k dashboard queries a second, at 2k of each per server, is 0.75 of a server. 3 servers run at 25%, and 38% after losing one. Loading the raw events instead would be 20k writes plus the queries: at least 16 servers to stay under 70% after losing one, $9,600 a month for Pinot alone.

**Freshness.** A one-minute window closes, and its record waits for the next checkpoint (every two minutes) to be committed: an aggregate is visible one to three minutes after its events.

| Tier | Load | Replicas | Busy |
|---|---|---|---|
| Ingest | 20k events / s | 16 | 63% |
| Aggregation job | 20k events / s | 16 | 63% |
| Raw events topic | 20k writes / s | 3 | 13% |
| Aggregates topic | 500 writes / s | 2 | 1% |
| Pinot | 500 writes + 1k queries / s | 3 | 25% |
| Report service | 1k queries / s | 3 | 17% |

```quiz
pre-aggregate-counts
partitions-for-throughput
```

## Concepts

### Append first, count later

The app's request has one job: make sure the event is not lost. Writing it to a replicated Kafka topic does that in a few milliseconds, and the app gets `202`. Everything else (validating, deduplicating, counting, charging) happens in the stream, where it can fall behind for a minute, restart or be redeployed without the app noticing and without losing an event.

The tempting alternative is to increment a counter row in a database during the request. At 20k events a second that is four times what one PostgreSQL primary takes, every app request waits for the write, and a click whose response timed out is retried and counted again. A log in front of the counting also gives you **replay**: Uber keeps its topics for three days, so a bad deploy of the job can be fixed and the events counted again.

```callout takeaway Never count on the request path
The request makes the event durable. Counting is a consumer's job.
```

```quiz
queue-load-levelling
```

### Pre-aggregate in windows

Nobody bills or charts a single click. Advertisers look at clicks per hour or per day, and the budget service needs spend per campaign every few minutes. So the job groups events by **ad and minute** (a **tumbling window**: fixed, non-overlapping, one minute long) and emits one record per group when the minute ends: the ad, the minute, the clicks, the impressions.

What it buys: 40 times fewer writes downstream, small tables, and dashboard queries that sum a few thousand rows instead of millions. Hourly and daily numbers are sums of the minutes. What it costs: up to a minute of delay, and detail is gone. A question about one specific click needs the raw events, which stay in Kafka for three days and in the data warehouse for analysts.

Uber's job keys every event by the ad identifier and its minute bucket, so a late event still lands in the minute it happened.

```quiz
tumbling-window
oltp-vs-olap
```

### Partition by ad, size for the event rate

Each window's count lives in the state of one Flink task. To keep every event of an ad in the same task, key the stream by ad: the ingest service produces with the ad as the Kafka key, so one partition and one task see all of that ad's events. A topic can be read by at most one consumer per partition, so the partition count caps the aggregation job's parallelism: give the raw topic enough partitions for the event rate, with headroom, from day one.

Size each tier for what it receives. The ingest tier and the aggregation job see every event; Pinot and the budget service see only aggregates. A job sized for its output instead of its input falls behind, its consumer lag grows, and the budget service paces with stale numbers. The simulation has no lag, so this problem asks the job to keep **Aggregate events** under 50 ms at p99 instead.

### Exactly once: checkpoints and transactions

"Exactly once" in a stream pipeline is three separate guarantees, and the pipeline is only as good as the weakest.

1. **The job's state.** Flink periodically takes a **checkpoint**: a snapshot of every task's state (open windows, the event ids it has seen for deduplication) together with the Kafka offsets it had read up to, stored durably. After a crash it restores the last checkpoint and re-reads from those offsets, so every event is reflected in the state once.
2. **The job's output.** Restoring state does not unsend records. If the job published a window's aggregate and then crashed before the next checkpoint, it would replay the same events and publish the aggregate again. So Flink writes its output into a **Kafka transaction** and commits it only when the checkpoint completes: a two-phase commit between the checkpoint and the topic. After a crash, the uncommitted transaction is aborted and the records are produced again from the restored state.
3. **The readers.** Consumers read with `read_committed`, so they never see records of an aborted transaction. And because any consumer can itself crash between applying a record and committing its offset, every aggregate carries a **record UUID**: the budget service applies each UUID once, Pinot upserts by it, and Hive deduplicates by it.

What it costs is **delay**. Readers see nothing until the checkpoint commits, so the checkpoint interval is the pipeline's latency. Uber checkpoints every two minutes instead of Flink's default ten, and says plainly that the result is not quite real time, but fast enough for pacing and reporting.

```callout pitfall Exactly-once delivery is not enough
Each hop needs its own guarantee: checkpointed state, transactional output, and an idempotent sink.
```

````deepdive Why not just deduplicate at the end?
A database at the end could reject a record UUID it has already seen, and some pipelines stop there. It works for one sink, but each new reader must implement it, and a reader that does not, a dashboard cache or a second consumer, double-counts. Committing output with the checkpoint keeps duplicates out of the topic, so every reader starts from a clean stream, and the UUID stays as a second line of defence.
````

```quiz
checkpointed-state
ad-click-aggregator-transactional-sink
at-least-once-needs-idempotency
```

### One number for billing and dashboards

The budget service and the dashboards must agree. If the budget is charged from the raw clicks while the dashboard shows the aggregates, the two numbers drift apart: the raw stream holds invalid and duplicate events the aggregation job filtered out, and a consumer restart redelivers some of them. An advertiser who sees 1,840 clicks on the dashboard and pays for 1,903 has a dispute, not a report.

So both read the committed aggregates topic. The budget service records each applied record UUID in its ledger, in the same transaction as the spend, and ignores one it has seen. Pinot ingests the same topic with upserts. One number, computed once, read twice.

```quiz
idempotent-consumer-crash
```

### An OLAP store for the dashboards

Dashboards ask analytical questions: clicks and impressions for this campaign, per day, over the last week. A row store answers that by scanning; an **OLAP store** such as Apache Pinot keeps columns, indexes and pre-sorted segments, and answers in tens of milliseconds while ingesting from Kafka in real time. Uber chose Pinot and used its **upsert** feature (keyed by the record UUID) so a redelivered aggregate replaces itself instead of adding a row.

The advertiser never queries Pinot directly: a report service checks who is asking, which campaigns they may see, and turns the request into a query.

## Designing it step by step

**1. Scope.** Ask who reads the counts (billing and advertisers), how fresh they must be (minutes), and how exact (exactly once, because it is money). Ask the event rate at peak and the reporting granularity (per minute, rolled up).

**2. High level.** App → load balancer → ingest service → raw events topic. Aggregation job reads the topic, checkpoints to object storage, writes the aggregates topic. Pinot and the budget service read the aggregates topic. Advertiser → load balancer → report service → Pinot.

**3. Deep dive.**

*Record event.* Produce to Kafka keyed by ad, answer `202` after the broker acknowledges. Nothing else on this path.

*Aggregate events.* The job filters invalid events, drops duplicates using the event ids in its keyed state, and adds the event to its ad's current minute. No external call per event.

*Publish aggregates and Checkpoint.* When a minute closes, the job writes its record, with a fresh record UUID, into the open transaction. Every two minutes it stores its checkpoint, then commits the transaction.

*The readers.* Pinot ingests the aggregates with upserts by record UUID; the budget service applies each record UUID once. Both read committed records only.

*Size it.* 16 ingest and 16 aggregation replicas for 20k events a second, 3 Pinot servers, 3 report replicas, 3 and 2 brokers, two of everything to lose one machine. About $7,500 of the $9,000.

**4. Wrap up.** Name the trade-off: freshness bounded by the checkpoint interval in exchange for exactness. Mention what you would watch: consumer lag on the raw topic, checkpoint duration and failures, and the gap between the aggregates and a daily batch recount.

## Common mistakes

**Counting in the request** (`wrong/count-in-the-request`). The ingest service increments a counter row per event before it answers. 20k writes a second saturate the database and the app waits on them; a retried request counts twice. Caught by **"Recording an event only appends it to Kafka"** and **Record event's p99**.

**Storing every raw event in Pinot** (`wrong/raw-events-into-pinot`). The job inserts each cleaned event and dashboards sum at query time. Pinot takes 20k writes a second instead of 500 and needs four times the servers. Caught by **"Events are aggregated in the stream, in memory"** and the **budget**.

**Charging the budget from raw clicks** (`wrong/charge-budget-per-raw-click`). The budget service reads the raw events topic, so it charges for invalid and duplicate clicks the job would have dropped, and for redelivered ones after a restart; billing and the dashboard disagree. Caught by **"Pinot and the budget read only committed aggregates"**.

**Publishing before the checkpoint** (`wrong/publish-before-checkpoint`). Each window's record is committed to Kafka the moment the window closes. A crash before the next checkpoint replays the events and publishes the aggregate twice. Caught by **"Aggregates are committed only after a checkpoint"**.

Classic mistakes beyond the tests:

- Too few partitions on the raw topic, so the aggregation job cannot scale past them when traffic grows.
- Keying windows by arrival time, so late events land in the wrong minute.
- A checkpoint interval of ten minutes (Flink's default), so every dashboard and the pacing lag by up to ten minutes.
- No reconciliation: without a periodic batch recount of the raw events to compare against, a bug in the stream job misbills quietly.

## In the interview

```callout interview Lead with the money
"These counts are invoices, so I need exactly once and one number for billing and dashboards." Then: append-only ingest, pre-aggregation in windows, and how each hop avoids duplicates: checkpoint, transaction, idempotent sink.
```

Likely follow-ups:

- *What if the aggregation job crashes?* It restores the last checkpoint and replays from its offsets; the uncommitted transaction is aborted, so readers never saw its records.
- *Why not count in Redis with `INCR`?* A retry after a timeout counts twice, and Redis can lose acknowledged increments on failover. For billing, that is not acceptable.
- *How fresh are the numbers?* One window plus up to one checkpoint interval: one to three minutes here. Shorter checkpoints cost more overhead.
- *How do you know the counts are right?* Reconcile against a daily batch recount of the raw events in the warehouse, and alert on the difference.
- *What about click fraud?* Filtering invalid events is the aggregation job's first step; richer fraud detection can run as another consumer of the raw topic and feed back adjustments.

## Further reading

- Jacob Tsafatinos, Yuriy Bondaruk and Yupeng Fu, [Real-Time Exactly-Once Ad Event Processing with Apache Flink, Kafka, and Pinot](https://www.uber.com/blog/real-time-exactly-once-ad-event-processing/) (Uber Engineering, 2021) — the design this problem is based on.
- Piotr Nowojski and Mike Winters, [An Overview of End-to-End Exactly-Once Processing in Apache Flink](https://flink.apache.org/2018/02/28/an-overview-of-end-to-end-exactly-once-processing-in-apache-flink-with-apache-kafka-too/) (Apache Flink blog, 2018) — the two-phase commit between checkpoints and a Kafka sink.
- [Apache Flink documentation: Checkpointing](https://nightlies.apache.org/flink/flink-docs-stable/docs/dev/datastream/fault-tolerance/checkpointing/) — intervals, state and recovery.
- [Apache Pinot documentation: Stream ingestion with upsert](https://docs.pinot.apache.org/basics/data-import/upsert) — upserts by primary key on a real-time table.
- Neha Narkhede and Guozhang Wang, [Exactly-Once Semantics Are Possible: Here's How Kafka Does It](https://www.confluent.io/blog/exactly-once-semantics-are-possible-heres-how-apache-kafka-does-it/) (Confluent blog, 2017) — idempotent producers and transactions.
- Martin Kleppmann, *Designing Data-Intensive Applications*, chapter "Stream Processing" — windows, fault tolerance and exactly-once.
