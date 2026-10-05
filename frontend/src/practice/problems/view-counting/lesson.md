"How many people saw this post?" sounds like `count += 1`. It is not. A view count on Reddit counts **unique** viewers within a time window, filters out bots and refreshes, and has to keep up with tens of thousands of events a second. This lesson follows Reddit's 2017 design and shows why the answer is a pipeline plus a 12 KB sketch rather than a table.

## What you'll learn

- How to take an event off the user's request path with a durable log, so a page view never waits for counting.
- What **HyperLogLog** is, why it counts unique items in fixed memory, and what accuracy you give up.
- How to split a stream job into stages (filter, then count) connected by a second topic.
- How to use a cache as the primary home of a counter, with a database as a periodic backup rather than a per-event sink.

## The problem, explained

Readers open posts. Their client reports each view, and later other readers see a number next to the post. Reddit's post lists four requirements: counts in near real time, each user counted once within a short window, a displayed number within a few percent of the truth, and production scale.

The five use cases in this problem map onto a pipeline:

- **Record view**: the client sends an event; it is stored durably (in Kafka) and the client gets a `2xx`. Nothing else happens in the request.
- **Filter view**: a consumer (Reddit called it Nazar) reads raw views, checks recent activity in Redis, and passes views that should count to a second topic (`"Counted"`) or drops them (`"Ignored"`).
- **Count view**: a second consumer (Abacus) reads counted views and adds the viewer to the post's HyperLogLog in Redis. If Redis evicted the counter (`"Counter evicted"`), it is first loaded back from the database.
- **Persist counts**: every 10 seconds, the counters that changed are copied from Redis to the database (Cassandra at Reddit).
- **Read count**: a reader sees the count, served from Redis.

Non-functional limits: p99 of Record view and Read count under 60 ms, both 99.9% available, the view durable before the answer, any single machine may fail, and $10,000 a month.

The given file contains only the `reader` actor plus traffic, requirements and tests. You build everything else. The tests say, in plain words: recording a view writes a queue and touches no cache or database; filtering starts at a queue, consults a cache, and only counted views go back to a queue; counting always uses a cache and only touches the database when the counter was evicted (and then reads the database before the cache); persistence reads the cache before writing the database; and reading a count uses the cache, never the database.

## Back-of-the-envelope

**Event rates.** 20k views a second arrive. About 10% are filtered, so 18k a second are counted. About 1% of those find their counter evicted: 180 a second read the database. Roughly 20k posts change in any 10-second window, so persisting costs 20k / 10 = 2k database writes a second. Reads are 10k a second.

**The exact-set alternative.** Storing user ids as 8-byte integers costs 8 bytes per unique viewer per post. A post with 10 million viewers needs 80 MB, and you need that for every popular post, on every replica. A HyperLogLog in Redis tops out at 12 KB whatever the cardinality, with a standard error of 0.81%.

| Approach | Memory for a 10M-viewer post | Error |
|---|---|---|
| Set of 8-byte ids | ~80 MB | 0 |
| Redis HyperLogLog | ≤ 12 KB | ~0.81% |

**Write amplification avoided.** Writing Cassandra once per counted view would be 18k writes a second. Writing each changed counter every 10 seconds is 2k. That is a 9× reduction, and it grows with popularity: a hot post getting 1,000 views a second still costs one write per 10 seconds.

**Per-tier load and replicas.** With services at about 2k requests a second per replica:

| Tier | Load | Replicas at 100% |
|---|---|---|
| Event collector | 20k/s | 10 |
| Filter consumer | 20k/s | 10 |
| Count consumer | 18k/s | 9 |
| Counts API | 10k/s | 5 |

Then add headroom: Proschi marks anything above 70% as hot, and "survive any node failure" re-runs the analysis with one replica fewer. Kafka takes every raw view plus every counted view, 20k + 18k = 38k writes a second against 50k per replica. Redis for the counters sees PFADDs, count reads and persistence reads, about 30k a second against 100k per replica: two replicas are for failure, not capacity.

**Cost.** Services are $100 per replica, Redis $150, Kafka $200, Cassandra $500, the load balancer $50. Four service tiers sized with headroom are most of the bill, so the budget leaves little room for spare tiers or a bigger database.

**Rows per day, if you did it the naive way.** 18k rows a second × 86,400 seconds ≈ 1.6 billion new rows a day, forever. Keep that number handy for the interview.

## Concepts

### HyperLogLog: counting distinct things in fixed memory

Hash every user id to a uniformly random-looking bit string. In a random bit string, a run of k leading zeros happens with probability 1 in 2^k, so if the longest run you have seen is 20, you have probably seen about a million distinct values. One such estimate is noisy, so HyperLogLog splits the hash space into many buckets (Redis uses 16,384), tracks the longest run per bucket in a few bits each, and combines the buckets with a harmonic mean. Flajolet and colleagues showed the relative error is about 1.04 / √m for m buckets, which is where Redis's 0.81% comes from.

Properties that matter in design:

- **Fixed size.** Memory does not grow with viewers. Redis even stores small HLLs in a sparse form and promotes them to the 12 KB dense form as they grow.
- **Idempotent adds.** Adding the same user twice changes nothing, which is exactly "unique viewers" and also makes replays from Kafka safe.
- **Mergeable.** The union of two HLLs is the bucket-wise max, so you can merge per-hour counters into a day without the raw ids.

Trade-offs: you cannot list who viewed, cannot remove a viewer, and cannot get an exact number. When not to use it: billing, quotas, anything where a user may dispute the count, or small sets where an exact set is cheap.

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

### A durable log first, the work later

The user's request should do the minimum that guarantees the event is not lost: append it to a replicated log and answer. Everything else (rules, counting, persistence) runs in consumers that read the log at their own pace. If the counters fall behind during a spike, pages are not slower; the count is a few seconds staler.

Splitting the consumer work into stages connected by topics has its own benefits. The filter can be changed, scaled or replayed without touching the counter, and the counter only sees events that matter. The cost is more moving parts and end-to-end latency in seconds rather than milliseconds.

When not to use it: when the user must see the result of their own action immediately and exactly (a like button that must flip at once is usually updated optimistically in the client, with the real count arriving later).

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

### Cache as primary, database as periodic backup

Usually a cache sits in front of the database, and the database is the truth. Here it is inverted for the hot data: Redis is where counters live and are read, and Cassandra holds a copy refreshed every 10 seconds so that an evicted or lost counter can be restored. This is a form of **write-behind** caching: writes land in memory and reach durable storage in batches.

Why it works here: the counter is approximate anyway, losing up to 10 seconds of increments for a rare eviction is within "a few percent", and the raw events are still in Kafka if you need to rebuild. Why it is dangerous elsewhere: write-behind can lose acknowledged writes on a crash. Never use it for money, orders, or anything a user was told is saved.

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

## Designing it step by step

**Step 1: scope.** Clarify "unique per what": per user per post within a short window. Ask how accurate the number must be (a few percent), how fresh (seconds), and whether anyone needs the list of viewers (no). Those three answers unlock approximation and asynchrony.

**Step 2: high-level design.** Draw the write path: client → load balancer → collector → Kafka → answer `202`. Then the processing path: Kafka → filter (with its own Redis for "has this user viewed this post recently?") → counted topic → counter → Redis HLL per post. Then the read path: client → load balancer → counts API → Redis `PFCOUNT`. Finally, the background job that copies changed counters to the database.

**Step 3: deep dive.**

*Why two Redis clusters?* The filter's state (recent views per user and post, short TTLs, very hot keys) and the counters (one HLL per post, read by the API) have different shapes and failure impact. Separating them keeps a bot storm in the filter from evicting counters.

*Eviction.* Redis under memory pressure may drop a cold post's counter. The count consumer must handle a missing key: read the stored HLL from the database, write it back to Redis, then PFADD. Model this as its own scenario, because it is the only time the count path touches the database.

*Persistence.* Track which counters changed (a dirty set), and every 10 seconds read each one from Redis and upsert it into the database. One write per active post per interval, not per view.

*Sizing.* Use the load table from the envelope. Every service tier gets enough replicas to stay well under 70% and still under 100% with one gone; Kafka and each Redis get at least two replicas. Then check the total against the budget before adding anything optional.

**Step 4: wrap-up.** Mention what the model does not capture: hot posts concentrating load on one Redis shard, consumer lag during spikes, Kafka retention for replays, and the accuracy of HLL at very small counts (Redis's sparse encoding and bias correction handle it). Offer exact counting for small creators if the product asks for it.

## Common mistakes

**Counting in the request** (`wrong/count-in-request`). The collector does a PFADD before answering. In production this couples page latency to Redis health: a slow or failing counter cluster now slows or fails view recording, and spikes hit Redis head on. It also skips the filter, so bots get counted. In Proschi the numbers barely move (Redis has capacity to spare), which is exactly why the flow test "Recording a view never waits for counting" exists: it catches the coupling the latency numbers cannot.

**Reading the count from Cassandra** (`wrong/read-count-from-cassandra`). The database copy is up to 10 seconds behind Redis, and every read now hits the slower, costlier store. It also turns the backup into a read-path dependency. Proschi still meets the latency limit here, so the test "Redis serves the counts; the database is a backup written in batches" is what fails.

**A row per viewer** (`wrong/row-per-viewer`). Exact, and appealing because it "also lets us show who viewed". But it is a write per counted view (about 18k a second instead of 2k) and about 1.6 billion new rows a day that never shrink. The test "Unique viewers go into a HyperLogLog in Redis, not a database" fails because the normal count path now calls the database.

**Classic mistakes beyond this problem:**

- *A plain counter (`INCR`) instead of a distinct count.* Fast, but a user refreshing ten times counts ten times.
- *Synchronous database writes per event, "for durability".* Durability already came from Kafka; the database copy only needs to bound the damage of a cache eviction.
- *One giant consumer doing filtering and counting.* Harder to scale, test and replay independently.

## In the interview

Lead with the insight: "This is a distinct-count problem at stream rate with loose accuracy, so I will log the event, filter it asynchronously, and count with HyperLogLog." Then show the 80 MB versus 12 KB comparison; it makes the case in one line.

Likely follow-ups:

- *What if Redis loses a counter?* Restore it from the database snapshot (at most 10 seconds stale), or rebuild from Kafka if retention allows.
- *How do you stop bots?* Rules in the filter stage using recent-activity state: rate per user, per IP, known bad agents. Being a separate stage means you can tighten rules without touching counting.
- *Exactly-once?* Not needed: PFADD is idempotent, so a replayed event changes nothing.
- *Can you show daily and all-time counts?* Keep one HLL per post per day and merge them for longer ranges; merges are lossless for HLL.
- *Hot post?* One key is one shard. Its PFADD rate is fine for Redis, but you can split it into several keys and merge on read if needed.

## Further reading

- [View Counting at Reddit](https://www.redditinc.com/blog/view-counting-at-reddit), Krishnan Chandra, Reddit, 2017: the source design, with Nazar, Abacus, HyperLogLog in Redis and the Cassandra backup.
- [HyperLogLog: the analysis of a near-optimal cardinality estimation algorithm](https://dmtcs.episciences.org/3545/pdf), Flajolet, Fusy, Gandouet and Meunier, 2007: the algorithm and its error bound.
- [Redis PFADD command](https://redis.io/docs/latest/commands/pfadd/): the Redis HyperLogLog commands, memory and error.
- [The System Design Primer: Asynchronism](https://github.com/donnemartin/system-design-primer#asynchronism): queues and doing work outside the request.
- [The System Design Primer: Write-behind (write-back)](https://github.com/donnemartin/system-design-primer#write-behind-write-back): the caching pattern behind the 10-second flush, with its risks.
- [awesome-scalability](https://github.com/binhnguyennus/awesome-scalability): its "Stream Data Deduplication" list and counting case studies (Pinterest, Quora) show the same problems at other companies.
- *System Design Interview – An Insider's Guide*, Vol. 2 (Alex Xu and Sahn Lam): the chapter "Ad Click Event Aggregation" works through a closely related streaming count.
