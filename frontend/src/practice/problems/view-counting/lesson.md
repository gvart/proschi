```tldr
A view count is a **distinct count at stream rate** with loose accuracy. Append each view to **Kafka** and answer; **filter** and **count** in separate stages; keep a **HyperLogLog** per post in Redis (**≤ 12 KB, ~0.81% error**) and back changed counters up to the database **every 10 seconds**.
```

"How many people saw this post?" sounds like `count += 1`. It is not: a Reddit view count counts **unique** viewers within a time window, filters out bots and refreshes, and keeps up with tens of thousands of events a second. This lesson follows Reddit's 2017 design: a pipeline plus a 12 KB sketch rather than a table.

## What you'll learn

- How to take an event off the user's request path with a durable log, so a page view never waits for counting.
- What **HyperLogLog** is, why it counts unique items in fixed memory, and what accuracy you give up.
- How to split a stream job into stages (filter, then count) connected by a second topic.
- How to use a cache as the primary home of a counter, with a database as a periodic backup rather than a per-event sink.

## The problem, explained

Clients report each view; later readers see a number next to the post. Reddit's post lists four requirements: counts in near real time, each user counted once within a short window, a displayed number within a few percent of the truth, and production scale.

The five use cases map onto a pipeline:

- **Record view**: the client sends an event; it is stored durably (in Kafka) and the client gets a `2xx`. Nothing else happens in the request.
- **Filter view**: a consumer (Reddit's Nazar) reads raw views, checks recent activity in Redis, and passes views that count to a second topic (`"Counted"`) or drops them (`"Ignored"`).
- **Count view**: a second consumer (Abacus) reads counted views and adds the viewer to the post's HyperLogLog in Redis. If Redis evicted the counter (`"Counter evicted"`), it is first loaded back from the database.
- **Persist counts**: every 10 seconds, the counters that changed are copied from Redis to the database (Cassandra at Reddit).
- **Read count**: a reader sees the count, served from Redis.

Limits: p99 of Record view and Read count under 60 ms; both 99.9% available; the view durable before the answer; any single machine loss survived; at most $10,000 a month.

The given file contains only the `reader` actor plus traffic, requirements and tests; you build everything else. The tests, in plain words:

- Recording a view writes a queue and touches no cache or database.
- Filtering starts at a queue and checks a cache, and only counted views go back to a queue.
- Counting always uses a cache. It touches the database only when the counter was evicted, and then reads the database before the cache.
- Persisting reads the cache before writing the database.
- Reading a count uses the cache, never the database.

## Back-of-the-envelope

```numbers
20k / s | views in
18k / s | counted after the filter
2k / s | database writes from 10-second persistence
80 MB vs 12 KB | exact set vs HyperLogLog, 10M viewers
≈ 1.6 billion | rows a day, the naive way
```

**Event rates.** 20k views a second arrive; about 10% are filtered, so 18k a second are counted. About 1% of those find their counter evicted: 180 database reads a second. Roughly 20k posts change in any 10-second window, so persisting costs 20k / 10 = 2k database writes a second. Reads are 10k a second.

**The exact-set alternative.** At 8 bytes per unique viewer per post, a post with 10 million viewers needs 80 MB, for every popular post, on every replica. A Redis HyperLogLog tops out at 12 KB whatever the cardinality, with a standard error of 0.81%.

| Approach | Memory for a 10M-viewer post | Error |
|---|---|---|
| Set of 8-byte ids | ~80 MB | 0 |
| Redis HyperLogLog | ≤ 12 KB | ~0.81% |

**Write amplification avoided.** Writing Cassandra once per counted view would be 18k writes a second; writing each changed counter every 10 seconds is 2k. That 9× reduction grows with popularity: a hot post getting 1,000 views a second still costs one write per 10 seconds.

**Per-tier load and replicas.** With services at about 2k requests a second per replica:

| Tier | Load | Replicas at 100% |
|---|---|---|
| Event collector | 20k/s | 10 |
| Filter consumer | 20k/s | 10 |
| Count consumer | 18k/s | 9 |
| Counts API | 10k/s | 5 |

Then add headroom: Proschi marks anything above 70% as hot, and "survive any node failure" re-runs the analysis with one replica fewer.

- **Kafka** takes every raw and every counted view, 20k + 18k = 38k writes a second against 50k per replica.
- **Redis for the counters** sees PFADDs, count reads and persistence reads, about 30k a second against 100k per replica: two replicas are for failure, not capacity.

**Cost.** Services $100 per replica, Redis $150, Kafka $200, Cassandra $500, the load balancer $50. Four service tiers with headroom are most of the bill, leaving little room for spare tiers or a bigger database.

**Rows per day, the naive way.** 18k rows a second × 86,400 seconds ≈ 1.6 billion new rows a day, forever. Keep that number handy for the interview.

## Concepts

### HyperLogLog: counting distinct things in fixed memory

Hash every user id to a bit string that looks random. A run of k leading zeros happens with probability 1 in 2^k, so if the longest run you have seen is 20, you have probably seen about a million (2^20) distinct values.

One such estimate is noisy. HyperLogLog splits the hash space into many buckets (Redis uses 16,384), keeps the longest run per bucket in a few bits each, and combines them with a harmonic mean (an average not thrown off by a few very large values). Flajolet and colleagues showed the relative error is about 1.04 / √m for m buckets, which is where Redis's 0.81% comes from.

Properties that matter in design:

- **Fixed size.** Memory does not grow with viewers. Redis stores small HLLs in a sparse form and promotes them to the 12 KB dense form as they grow.
- **Idempotent adds.** Adding the same user twice changes nothing: exactly "unique viewers", and replays from Kafka are safe.
- **Mergeable.** The union of two HLLs is the bucket-wise max, so per-hour counters merge into a day without the raw ids.

**Trade-offs.** You cannot list who viewed, remove a viewer, or get an exact number. **When not to use it:** billing, quotas, anything where a user may dispute the count, or small sets where an exact set is cheap.

```proschi
title "Distinct counter in a cache"

app   "App"            [Go]    x2
redis "Distinct Counts" [Redis] x2

app -> redis : RESP

usecase "Add member" {
  app    -> redis : PFADD visitors:2026-10-05 user-42
  redis --> app   : 1
}

usecase "Count members" {
  app    -> redis : PFCOUNT visitors:2026-10-05
  redis --> app   : 18342
}
```

```quiz
hyperloglog
```

### A durable log first, the work later

```callout takeaway
The request does the minimum that guarantees the event is not lost: append it to a replicated log and answer. If the counters fall behind in a spike, pages are not slower; the count is just a few seconds older.
```

Rules, counting and persistence run in consumers that read the log at their own pace. Stages connected by topics let you change, scale or replay the filter without touching the counter, which sees only events that matter. The cost is more moving parts and end-to-end latency in seconds rather than milliseconds.

**When not to use it.** When the user must see the result of their own action immediately and exactly (a like button that must flip at once is usually updated optimistically in the client, with the real count arriving later).

````deepdive The pattern in Proschi: a two-stage stream
```proschi
title "Two-stage stream"

client "Client"    [Actor]
api    "Ingest"    [Go]    x2
log    "Event Log" [Kafka] x3
stage1 "Enricher"  [Go]    x2
stage2 "Counter"   [Go]    x2

client -> api    : HTTPS
api    -> log    : produce
log    -> stage1 : consume
stage1 -> log    : produce
log    -> stage2 : consume

usecase "Ingest event" {
  client -> api    : POST /events
  api    -> log    : PRODUCE raw
  log   --> api    : ok
  api   --> client : 202
}

usecase "Enrich" {
  log     -> stage1 : RawEvent
  stage1  -> log    : PRODUCE enriched
  log    --> stage1 : ok
  stage1 --> log    : commit offset
}
```
````

### Cache as primary, database as periodic backup

Usually the database behind a cache is the truth. Here, for hot data, it is the other way around: counters live and are read in Redis, and Cassandra holds a copy refreshed every 10 seconds to restore an evicted or lost counter. This is **write-behind** caching: writes land in memory and reach durable storage in batches.

It works here because the counter is approximate anyway: losing up to 10 seconds of increments on a rare eviction is within "a few percent", and the raw events are still in Kafka for a rebuild.

```callout pitfall Write-behind elsewhere
Write-behind can lose acknowledged writes on a crash. Never use it for money, orders, or anything a user was told is saved.
```

```proschi
title "Write-behind snapshot"

job   "Flusher"        [Go]        x2
hot   "Hot Counters"   [Redis]     x2
cold  "Counter Backup" [Cassandra] x3

job -> hot  : RESP
job -> cold : CQL

usecase "Flush" {
  job   -> hot  : GET counter:42
  hot  --> job  : value
  job   -> cold : UPSERT counters 42
  cold --> job  : ok
}
```

```quiz
write-back-risk
pre-aggregate-counts
```

## Designing it step by step

**Step 1: scope.** Clarify "unique per what": per user per post within a short window. Ask how accurate (a few percent), how fresh (seconds), and whether anyone needs the viewer list (no). Those three answers unlock approximation and asynchrony.

**Step 2: high-level design.** Four paths:

| Path | Flow |
|---|---|
| Write | client → load balancer → collector → Kafka → answer `202` |
| Processing | Kafka → filter (with its own Redis for "has this user viewed this post recently?") → counted topic → counter → Redis HLL per post |
| Read | client → load balancer → counts API → Redis `PFCOUNT` |
| Background | a job that copies changed counters to the database |

**Step 3: deep dive.**

*Why two Redis clusters?* The filter's state (recent views per user and post, short TTLs, very hot keys) and the counters (one HLL per post, read by the API) differ in shape and failure impact. Separating them keeps a bot storm in the filter from evicting counters.

*Eviction.* Under memory pressure Redis may drop a cold post's counter. The count consumer must handle a missing key: read the stored HLL from the database, write it back to Redis, then PFADD. Model it as its own scenario: it is the only time the count path touches the database.

*Persistence.* Track which counters changed (a dirty set); every 10 seconds read each from Redis and upsert it into the database. One write per active post per interval, not per view.

*Sizing.* Use the envelope's load table. Every service tier stays well under 70% and under 100% with one replica gone; Kafka and each Redis get at least two replicas. Check the total against the budget before adding anything optional.

**Step 4: wrap-up.** Name what the model misses: hot posts concentrating load on one Redis shard, consumer lag during spikes, Kafka retention for replays, and HLL accuracy at very small counts (Redis's sparse encoding and bias correction handle it). Offer exact counting for small creators if the product asks for it.

## Common mistakes

**Counting in the request** (`wrong/count-in-request`). The collector does a PFADD before answering. In production page latency now depends on Redis: a slow or failing counter cluster slows or fails view recording, and spikes hit Redis directly. It also skips the filter, so bots count.

```callout pitfall The numbers will not warn you
In Proschi the numbers barely move (Redis has capacity to spare). That is why the flow test "Recording a view never waits for counting" exists: it catches the coupling latency cannot.
```

**Reading the count from Cassandra** (`wrong/read-count-from-cassandra`). The database copy is up to 10 seconds behind Redis, every read hits the slower, costlier store, and the backup becomes a read-path dependency. Proschi still meets the latency limit, so the test "Redis serves the counts; the database is a backup written in batches" is what fails.

**A row per viewer** (`wrong/row-per-viewer`). Exact, and it "also lets us show who viewed". But it is a write per counted view (about 18k a second instead of 2k) and about 1.6 billion new rows a day that never shrink. The test "Unique viewers go into a HyperLogLog in Redis, not a database" fails because the normal count path now calls the database.

**Classic mistakes beyond this problem:**

- *A plain counter (`INCR`) instead of a distinct count.* Fast, but a user refreshing ten times counts ten times.
- *Synchronous database writes per event, "for durability".* Durability already came from Kafka; the database copy only bounds the damage of a cache eviction.
- *One giant consumer doing filtering and counting.* Harder to scale, test and replay independently.

## In the interview

```callout interview Lead with the insight
"This is a distinct-count problem at stream rate with loose accuracy, so I will log the event, filter it asynchronously, and count with HyperLogLog." Then show the 80 MB versus 12 KB comparison; it makes the case in one line.
```

Likely follow-ups:

- *What if Redis loses a counter?* Restore it from the database snapshot (at most 10 seconds stale), or rebuild from Kafka if retention allows.
- *How do you stop bots?* Rules in the filter stage using recent-activity state: rate per user, per IP, known bad agents. As a separate stage, rules tighten without touching counting.
- *Exactly-once?* Not needed: PFADD is idempotent, so a replayed event changes nothing.
- *Can you show daily and all-time counts?* Keep one HLL per post per day and merge them for longer ranges; HLL merges are lossless.
- *Hot post?* One key is one shard. Its PFADD rate is fine for Redis, but you can split it into several keys and merge on read if needed.

```quiz
hot-partition-key
```

## Further reading

- [View Counting at Reddit](https://www.redditinc.com/blog/view-counting-at-reddit), Krishnan Chandra, Reddit, 2017: the source design: Nazar, Abacus, HyperLogLog in Redis, the Cassandra backup.
- [HyperLogLog: the analysis of a near-optimal cardinality estimation algorithm](https://dmtcs.episciences.org/3545/pdf), Flajolet, Fusy, Gandouet and Meunier, 2007: the algorithm and its error bound.
- [Redis PFADD command](https://redis.io/docs/latest/commands/pfadd/): the Redis HyperLogLog commands, memory and error.
- [The System Design Primer: Asynchronism](https://github.com/donnemartin/system-design-primer#asynchronism): queues and doing work outside the request.
- [The System Design Primer: Write-behind (write-back)](https://github.com/donnemartin/system-design-primer#write-behind-write-back): the caching pattern behind the 10-second flush, with its risks.
- [awesome-scalability](https://github.com/binhnguyennus/awesome-scalability): "Stream Data Deduplication" and counting case studies (Pinterest, Quora) show the same problems elsewhere.
- *System Design Interview – An Insider's Guide*, Vol. 2 (Alex Xu and Sahn Lam): "Ad Click Event Aggregation" works through a closely related streaming count.
