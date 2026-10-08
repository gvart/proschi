# Discord messages: taming a hot partition

```tldr
An `@everyone` ping sends tens of thousands of identical reads a second to **one partition on three replicas**, while the rest of the cluster idles; adding nodes does not move it. Put a **data-service layer** in front of the database, route by **consistent hash of `channel_id`**, and **coalesce identical in-flight queries** so thousands of reads become one. No cache: messages change too often.
```

## What you'll learn

- What a **hot partition** is, and why adding nodes to a cluster does not cool it down.
- How **request coalescing** (also called single-flight) turns thousands of identical reads into one.
- Why a thin data-service layer between an application and its database is a good place for that logic.
- Why "just add a cache" is the wrong answer when the data is edited, deleted and reacted to all the time.
- How quorum reads and writes multiply load on replicas, and how to count them.

## The problem, explained

Discord stores every message ever sent, trillions of them, in a wide-column database (Cassandra, later ScyllaDB). Messages are **partitioned by channel and a time bucket**: one channel's messages from a 10-day window sit together in one partition, copied to three nodes. The common read, "open a channel and show the latest 50 messages", is one cheap query on one partition.

It works until someone in a huge server pings `@everyone`, and hundreds of thousands of people open the same channel within seconds. Every read targets the same partition, so the same three replicas: a **hot partition**, a small part of the cluster taking a huge share of the load while the other 69 nodes sit mostly idle. Because reads run at quorum (each waits for a majority of the replicas), those nodes slow down for every query they serve, not only the busy channel's.

The three use cases:

- **Send message**: write to the messages cluster at quorum before the sender hears back.
- **Read messages**: open an ordinary channel and load its latest 50 messages.
- **Read busy channel**: everyone opens the channel just pinged; reads hit the `hot` partition. Two scenarios: `"Joined in-flight read"` (a query for the same channel is already running, and this request gets its result) and `"First read"` (no query in flight, so this one reads the partition and shares the result).

The given declares `api` (the Discord API monolith, treated as the client), `messages` (24 shards of 3 replicas, 72 nodes, fixed) and `hot`, the three replicas owning the busy channel's partition. `hot` is a separate node because the simulation spreads load evenly and cannot see one hot key on its own. It takes 10k reads a second per replica and costs nothing extra (its nodes are already paid for in the cluster).

Requirements: p99 of every use case under 60 ms; 99.99% availability; messages durable before the answer; survive any node failure; at most $42,000 a month, the 72 database nodes included. The tests check:

- Every query goes through a node called `data`, and there is no path from the API to any database.
- A joined read never calls a database, the first read calls `hot`, and the busy channel never touches `messages`.
- No use case calls a cache.
- A send writes `messages` before responding.

## Back-of-the-envelope

```numbers
45k / s | replica operations on a cluster built for **≈ 1.4M**
80k / s | reads on `hot` without coalescing, **≈ 270%**
800 / s | reads on `hot` with coalescing
60k rps | through the data services
$36,000 | of the $42,000 is the 72 database nodes
```

Quorum changes the arithmetic. With three replicas, **QUORUM** is a majority: a read asks two replicas, a write goes to all three and waits for two. So each logical read is two replica reads and each write three replica writes: in Proschi, the `x2` and `x3` fan-out on the step's label.

| Flow | Logical rate | Replica operations |
|---|---|---|
| Send message | 5k rps | 15k writes on `messages` |
| Read messages | 15k rps | 30k reads on `messages` |
| Busy channel, no coalescing | 40k rps | 80k reads on `hot` |
| Busy channel, 1% start a query | 400 rps | 800 reads on `hot` |

**The cluster is fine on average.** 72 nodes at 20k operations each is about 1.4M operations a second; 45k is a few percent. Discord sized it for trillions of messages on disk, not request rate.

**The hot partition is not.** Its three replicas take 10k reads a second each, 30k in total. Without coalescing they receive 80k, about 270% utilisation: saturated. "Survive any node failure" removes one of the three, leaving 20k. Adding shards or replicas to `messages` changes nothing: a partition lives on exactly its replication factor's nodes.

**With coalescing**, only about 1% of the busy reads start a query: 400 a second, 800 replica reads, a few percent of `hot`.

**The data services carry everything**: 5k + 15k + 40k = 60k requests a second. At about 2k rps per replica, 30 replicas would be at 100%; well under 70% even after losing one means somewhere in the 40s. At $100 each, with the 72 database nodes at $500 each already costing $36,000, the $42,000 budget leaves room for about 60 replicas at most. The squeeze is deliberate: the design has to be efficient, not just correct.

**Latency.** A coalesced read is one data-service hop returning a result already on its way: fast. A first read adds one quorum read on an idle `hot` partition. Sends and ordinary reads are a data-service hop plus a database hop. All fit in 60 ms at p99 if nothing is saturated.

```quiz
quorum-replica-load
```

## Concepts

### Hot partitions

Partitioned databases (Cassandra, ScyllaDB, DynamoDB, sharded SQL) spread data by hashing a **partition key**. That spreads *keys* evenly, not *traffic*. If one key is far more popular than the rest, the nodes that own it get far more requests: a **hot partition** or **hot key**.

Ways to deal with it, from cheapest to most invasive:

| Fix | How | Cost |
|---|---|---|
| **Absorb the reads** before the database | Request coalescing, or a cache | A cache's costs, below |
| **Split the key** | Add a time bucket (Discord does, to keep partitions a manageable size) or salt the key into sub-keys, reading all and merging | Helps writes and size, but "latest 50" still targets the newest bucket |
| **Replicate the hot data more widely** | Read replicas of just that key | Consistency and complexity |

```callout takeaway Adding nodes does not cool a hot partition
More nodes means more partitions per cluster, but the same three replicas still own the hot one.
```

```quiz
hot-key-replicas
hot-partition-key
```

### Request coalescing

**Request coalescing**: when identical requests arrive while one is already in progress, the later ones wait for the first one's result instead of redoing the work. Go's `golang.org/x/sync` module ships it as the `singleflight` package, which keeps only one call per key in flight. Discord's data services do the same for queries: the first request for a channel spawns a worker task that runs the query, later requests for that channel subscribe to it, and when the rows arrive everyone gets them.

Database reads then depend on how many *distinct* queries are in flight, not how many users asked. During a ping storm, tens of thousands of identical requests a second become a handful of queries.

Two details make it work:

- **Routing.** Coalescing happens inside one process, so all requests for a channel must reach the same data-service instance. Discord routes by a **consistent hash** of `channel_id`, which also keeps most assignments stable as instances come and go. (The simulation spreads requests evenly and takes the coalesced share from the scenario mix; the routing is described, not simulated.)
- **Freshness.** A joined request gets a result at most one query old. There is no stored copy to go stale: the difference from a cache.

When not to use it: requests whose answers differ per caller (permissions applied to results, personalised data), or writes. And it only helps when identical requests overlap in time; for steady, spread-out reads of popular data, a cache is the tool.

````deepdive Coalescing in Proschi
```proschi
title "Coalesce identical reads"
client "Client" [Actor]
svc    "Service" [Go] x4 "Shares in-flight queries"
db     "Store"   [Cassandra] x3
client -> svc
svc    -> db : CQL

usecase "Get item" {
  client -> svc : GET /items/7
  alt "Joined" when "a query for item 7 is already running" {
    svc --> client : 200 shared result
  } alt "Leader" when "no query in flight" {
    svc  -> db     : SELECT item 7
    db  --> svc    : row
    svc --> client : 200
  }
}
```
````

```quiz
consistent-hashing
```

### Why not a cache?

A cache in front of the database also absorbs repeated reads. Here it is the wrong trade:

- Messages are **mutable**: edits, deletes, reactions, embeds resolving. Each of those writes must invalidate or update the channel's cached "latest 50", or users see deleted messages and missing reactions.
- The cache is another fleet to run and pay for, and another place for hot keys to appear.

```callout pitfall Invalidation races
A read that started before an edit can refill the cache with the old version *after* the edit's invalidation.
```

Coalescing gives most of the benefit for the burst case (many identical reads at the same instant) without storing anything, which is why the problem forbids a message cache.

## Designing it step by step

**1. Scope.** Narrow it to the message store: sending, reading recent messages, and the hot-channel case. Confirm the data model (partition by channel and time bucket, replication factor three, quorum reads and writes) and that the cluster is fixed. Ask what happens today during a mass ping: that is the problem statement.

**2. High level.** The API talks to a new **data-service layer**, which alone talks to ScyllaDB. Each endpoint is one query, with no business logic. Draw sends and ordinary reads going straight through, and the busy-channel read with its two scenarios.

**3. Deep dive.**

*Count the quorum load.* Put `x3` on writes and `x2` on reads, and show the cluster has plenty of capacity while the hot partition's three replicas do not.

*Coalesce.* Explain the in-flight map: key = the query and its arguments, value = a task with a list of subscribers. The first request creates it, others subscribe, the result fans out, the entry is removed. Then explain why routing by consistent hash on `channel_id` makes it work across many instances.

*Rule out the alternatives.* More nodes do not move the partition. A cache needs invalidation on every edit, delete and reaction. An API monolith querying the database means thousands of processes each sending their own copy of the same read.

*Durability.* Sends go through the same layer, written at quorum; the sender hears back only after the write.

*Sizing and budget.* 60k requests a second across the data services: enough replicas to stay well under 70% after losing one, within what the budget leaves after the cluster.

**4. Wrap up.** Mention what else the layer enables: per-query concurrency limits that protect the database, metrics per query, and one place to change how queries run.

```deepdive What Discord measured
Discord's post reports fewer nodes and much lower, steadier tail latency after the change. The migration also moved from Cassandra to ScyllaDB, to avoid garbage-collection pauses.
```

## Common mistakes

**The API queries ScyllaDB itself** (`wrong/api-queries-scylla`). The simplest design, and fine for ordinary channels. During a ping storm every client's read goes to the same three replicas, saturating them, and losing one makes it worse. Caught by **"Every query goes through the data services"**, plus the busy channel's p99 and the failure test.

**Data services without coalescing** (`wrong/no-coalescing`). The layer is a pass-through, so each request runs its own query and `hot` still sees 80k reads a second against 30k. A very common real-life half-step: a proxy that adds a hop and fixes nothing. Caught by **"Concurrent reads of one channel share one query"** (the joined scenario calls a database), and the busy channel's p99 and failure limits.

**A cache in front** (`wrong/cache-in-front`). A Redis cache of the latest messages absorbs the reads and passes the latency limits. But every edit, delete and reaction must now keep it in sync, and stale caches show deleted messages. Caught by **"No message cache to keep in sync"**.

**Acknowledge before writing** (`wrong/ack-before-write`). The data service answers, then writes; a crash in between loses a message the sender saw as sent. Caught by **"A message is stored before the sender hears back"** (and the durability requirement).

Classic mistakes beyond the tests:

- Adding nodes or replicas to the cluster to cool a hot partition.
- Coalescing without routing by channel, so identical requests rarely meet in the same process.
- Partitioning by channel alone, with no time bucket, so the busiest channels' partitions grow without bound.
- Coalescing on a key that ignores query arguments, so different queries share the wrong result.

## In the interview

```callout interview Lead with the shape of the load
"The cluster is mostly idle on average; the problem is one partition on three nodes getting tens of thousands of identical reads a second." That shows you understand why scaling out does not help. Then present coalescing as the answer to *identical concurrent* reads, and the data-service layer as where it lives.
```

Likely follow-ups:

- *What if the leader query fails?* Every subscriber gets the error (or the service retries once for them); the in-flight entry is removed so the next request starts fresh.
- *What if a message is sent while a coalesced read is in flight?* Joiners get the result of a query started a few milliseconds earlier. The new message arrives over the real-time gateway anyway; the history read is not the delivery channel.
- *How does consistent hashing help when instances change?* Only channels on the affected part of the ring move; most in-flight groups and routing stay put.
- *Why ScyllaDB over Cassandra?* Same data model and query language, in C++ without a garbage-collected runtime, so fewer latency spikes; Discord reported far lower, steadier p99s after the move.
- *Would you ever add a cache?* For immutable or rarely changing data (old buckets of archived channels, perhaps), or with invalidation driven by change data capture (a stream of every database change) if coalescing bursts is not enough. Never as the first move.

## Further reading

- Bo Ingram, [How Discord Stores Trillions of Messages](https://discord.com/blog/how-discord-stores-trillions-of-messages) (Discord, 2023) — hot partitions, Rust data services with request coalescing, consistent-hash routing, and the move to ScyllaDB.
- Stanislav Vishnevskiy, [How Discord Stores Billions of Messages](https://discord.com/blog/how-discord-stores-billions-of-messages) (Discord, 2017) — the `(channel_id, bucket)` partition key and why buckets exist.
- [Go package singleflight](https://pkg.go.dev/golang.org/x/sync/singleflight) — a minimal, readable implementation of duplicate-call suppression.
- [System Design Primer: Sharding](https://github.com/donnemartin/system-design-primer#sharding) — including lopsided shards and consistent hashing.
- [System Design Primer: Wide column store](https://github.com/donnemartin/system-design-primer#wide-column-store) — the Bigtable/Cassandra data model behind partitions and clustering keys.
- [awesome-scalability](https://github.com/binhnguyennus/awesome-scalability) — a curated list of real-world scaling write-ups, including Discord's Cassandra post.
- Alex Xu, *System Design Interview – An Insider's Guide, Volume 1*, chapters "Design Consistent Hashing" and "Design A Chat System" — the routing technique and the surrounding chat system.
