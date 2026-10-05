# Discord messages: taming a hot partition

## What you'll learn

- What a **hot partition** is, and why adding nodes to a cluster does not cool it down.
- How **request coalescing** (also called single-flight) turns thousands of identical reads into one.
- Why a thin data-service layer between an application and its database is a good place for that logic.
- Why "just add a cache" is the wrong answer when the data is edited, deleted and reacted to all the time.
- How quorum reads and writes multiply load on replicas, and how to count them.

## The problem, explained

Discord stores every message ever sent, trillions of them, in a wide-column database (Cassandra, later ScyllaDB). Messages are **partitioned by channel and a time bucket**: all of one channel's messages from a 10-day window sit together in one partition, and each partition is copied to three nodes. That makes the common read, "open a channel and show the latest 50 messages", one cheap query on one partition.

It works until someone in a huge server pings `@everyone`. Hundreds of thousands of people open the same channel within seconds. Every read targets the same partition, and therefore the same three replicas. That is a **hot partition**: a small part of the cluster takes a huge share of the load, while the other 69 nodes sit mostly idle. Because reads run at quorum (each read waits for a majority of the replicas), those nodes slow down for every query they serve, not only for the busy channel.

The three use cases:

- **Send message**: write a message to the messages cluster at quorum before the sender hears back.
- **Read messages**: open an ordinary channel and load its latest 50 messages.
- **Read busy channel**: everyone opens the channel that was just pinged; reads hit the `hot` partition. Two scenarios: `"Joined in-flight read"` (a query for the same channel is already running, and this request gets its result) and `"First read"` (no query in flight, so this one reads the partition and shares the result).

The given declares `api` (the Discord API monolith, treated as the client), `messages` (24 shards of 3 replicas, 72 nodes, fixed) and `hot`, the three replicas that own the busy channel's partition. `hot` is drawn as a separate node because the simulation spreads load evenly and cannot see one hot key on its own. It takes 10k reads a second per replica and costs nothing extra (its nodes are already paid for in the cluster).

Requirements: p99 of every use case under 60 ms; 99.99% availability; messages durable before the answer; survive any node failure; at most $42,000 a month, the 72 database nodes included. The tests check four things:

- Every query goes through a node called `data`, and there is no path from the API to any database.
- A joined read never calls a database, the first read calls `hot`, and the busy channel never touches `messages`.
- No use case calls a cache.
- A send writes `messages` before responding.

## Back-of-the-envelope

Quorum changes the arithmetic. With three replicas, **QUORUM** means a majority: a read asks two replicas and a write goes to all three and waits for two. So each logical read is two replica reads, and each write is three replica writes. In Proschi that is the `x2` and `x3` fan-out on the step's label.

| Flow | Logical rate | Replica operations |
|---|---|---|
| Send message | 5k rps | 15k writes on `messages` |
| Read messages | 15k rps | 30k reads on `messages` |
| Busy channel, no coalescing | 40k rps | 80k reads on `hot` |
| Busy channel, 1% start a query | 400 rps | 800 reads on `hot` |

**The cluster is fine on average.** 72 nodes at 20k operations each is about 1.4M operations a second; 45k is a few percent. Discord sized it for trillions of messages on disk, not for request rate.

**The hot partition is not.** Its three replicas take 10k reads a second each: 30k in total. Without coalescing they receive 80k, about 270% utilisation, saturated. And "survive any node failure" removes one of the three, leaving 20k of capacity. Adding shards or replicas to `messages` changes nothing, because a partition lives on exactly its replication factor's nodes.

**With coalescing**, only about 1% of the busy reads start a query: 400 a second, 800 replica reads, a few percent of `hot`.

**The data services carry everything.** 5k + 15k + 40k = 60k requests a second. At about 2k rps per service replica, 30 replicas would be at 100%; keeping them well under 70% even after losing one means somewhere in the 40s. At $100 each, and with the 72 database nodes at $500 each already costing $36,000, the $42,000 budget leaves room for about 60 replicas at most. That squeeze is deliberate: the design has to be efficient, not just correct.

**Latency.** A coalesced read is one data-service hop and returns a result that is already on its way, so it is fast. A first read adds one quorum read on an idle `hot` partition. Sends and ordinary reads are a data-service hop plus a database hop. All of them fit in 60 ms at p99 if nothing is saturated.

## Concepts

### Hot partitions

Partitioned databases (Cassandra, ScyllaDB, DynamoDB, sharded SQL) spread data by hashing a **partition key**. That spreads *keys* evenly, not *traffic*. If one key is far more popular than the rest, the nodes that own it get far more requests: a **hot partition** or **hot key**.

Ways to deal with it, from cheapest to most invasive:

- **Absorb the reads before they reach the database**: request coalescing, or a cache (with its costs, below).
- **Split the key**: add a time bucket (Discord does this so partitions stay a manageable size) or salt a key into several sub-keys, reading all of them and merging. This helps writes and size, but a read of "latest 50" still targets the newest bucket.
- **Replicate the hot data more widely**: read replicas of just that key, at the cost of consistency and complexity.

What does *not* work: adding nodes. More nodes means more partitions per cluster, but the same three replicas still own the hot one.

### Request coalescing

**Request coalescing** means that when several identical requests arrive while one is already in progress, the later ones wait for the first one's result instead of doing the work again. Go's `golang.org/x/sync` module ships it as the `singleflight` package, which makes sure only one call per key is in flight at a time. Discord's data services do the same for database queries: the first request for a channel spawns a worker task that runs the query; later requests for the same channel subscribe to that task; when the rows arrive, everyone gets them.

The number of database reads then depends on how many *distinct* queries are in flight, not on how many users asked. During a ping storm, tens of thousands of identical requests a second become a handful of queries.

Two details make it work:

- **Routing.** Coalescing happens inside one process, so all requests for one channel must reach the same data-service instance. Discord routes by a **consistent hash** of `channel_id`, which also keeps most assignments stable when instances are added or removed. (The simulation spreads requests evenly and takes the coalesced share from the scenario mix; the routing is described, not simulated.)
- **Freshness.** A joined request receives a result that is at most one query old. There is no stored copy to go stale, which is the difference from a cache.

When not to use it: requests whose answers differ per caller (permissions applied to results, personalised data), or writes. And it only helps when identical requests overlap in time; for steady, spread-out reads of popular data, a cache is the tool.

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

### Why not a cache?

A cache in front of the database also absorbs repeated reads. Here it is the wrong trade:

- Messages are **mutable**: edits, deletes, reactions, embeds resolving. Every one of those writes must invalidate or update the cached "latest 50" for that channel, or users see deleted messages and missing reactions.
- Invalidation races are subtle: a read that started before an edit can refill the cache with the old version after the edit's invalidation.
- The cache is another fleet to run and pay for, and another place for hot keys to appear.

Coalescing gives most of the benefit for the burst case (many identical reads at the same instant) without storing anything. That is why the problem forbids a message cache.

## Designing it step by step

**1. Scope.** Narrow it to the message store: sending, reading recent messages, and the hot-channel case. Confirm the data model (partition by channel and time bucket, replication factor three, quorum reads and writes) and that the cluster is fixed. Ask what happens today during a mass ping, and you have the problem statement.

**2. High level.** The API talks to a new **data-service layer**, which alone talks to ScyllaDB. Each data-service endpoint is one query; no business logic. Draw sends and ordinary reads going straight through, and the busy-channel read with its two scenarios.

**3. Deep dive.**

*Count the quorum load.* Put `x3` on writes and `x2` on reads, and show that the cluster has plenty of capacity while the hot partition's three replicas do not.

*Coalesce.* Explain the in-flight map: key = the query and its arguments, value = a task with a list of subscribers. The first request creates it; others subscribe; the result fans out; the entry is removed. Then explain why routing by consistent hash on `channel_id` is necessary for this to work across many instances.

*Rule out the alternatives.* More nodes do not move the partition. A cache would need invalidation on every edit, delete and reaction. Letting the API monolith query the database means thousands of processes each sending their own copy of the same read.

*Durability.* Sends go through the same layer, are written at quorum, and the sender hears back only after the write.

*Sizing and budget.* 60k requests a second across the data services; enough replicas to stay well under 70% after losing one, within what the budget leaves after the cluster.

**4. Wrap up.** Mention what else the layer enables: per-query concurrency limits that protect the database, metrics per query, and a single place to change how queries are run. Mention the measured outcome in Discord's post (fewer nodes, much lower and steadier tail latency) and that the migration also moved from Cassandra to ScyllaDB to avoid garbage-collection pauses.

## Common mistakes

**The API queries ScyllaDB itself** (`wrong/api-queries-scylla`). Simplest possible design, and it works for ordinary channels. During a ping storm every client's read goes to the same three replicas, saturating them, and losing one replica makes it worse. Caught by **"Every query goes through the data services"**, plus the busy channel's p99 and the failure test.

**Data services without coalescing** (`wrong/no-coalescing`). The layer exists but is a pass-through, so each request runs its own query and `hot` still sees 80k reads a second against 30k. In real life this is a very common half-step: a proxy that adds a hop and fixes nothing. Caught by **"Concurrent reads of one channel share one query"** (the joined scenario calls a database), and the busy channel's p99 and failure limits.

**A cache in front** (`wrong/cache-in-front`). A Redis cache of the latest messages absorbs the reads and passes the latency limits. But now every edit, delete and reaction has to keep it in sync, and stale caches show deleted messages. Caught by **"No message cache to keep in sync"**.

**Acknowledge before writing** (`wrong/ack-before-write`). The data service answers the sender, then writes. A crash in between loses a message the sender saw as sent. Caught by **"A message is stored before the sender hears back"** (and the durability requirement).

Classic mistakes beyond the tests:

- Adding nodes or replicas to the cluster to cool a hot partition.
- Coalescing without routing by channel, so identical requests rarely meet in the same process.
- Partitioning by channel alone with no time bucket, letting the busiest channels' partitions grow without bound.
- Coalescing on a key that ignores query arguments, so different queries share the wrong result.

## In the interview

Lead with the shape of the load: "The cluster is mostly idle on average; the problem is one partition on three nodes getting tens of thousands of identical reads a second." That shows you understand why scaling out does not help. Then present coalescing as the answer to *identical concurrent* reads, and the data-service layer as the place it lives.

Likely follow-ups:

- *What happens if the leader query fails?* Every subscriber gets the error (or the service retries once on their behalf); the in-flight entry is removed so the next request starts fresh.
- *What if a message is sent while a coalesced read is in flight?* Joiners get the result of a query that started a few milliseconds earlier. The new message arrives over the real-time gateway anyway; the history read is not the delivery channel.
- *How does consistent hashing help when instances change?* Only the channels on the affected part of the ring move, so most in-flight groups and routing stay put.
- *Why ScyllaDB over Cassandra?* Same data model and query language, written in C++ without a garbage-collected runtime, so fewer latency spikes; Discord reported far lower and steadier p99s after the move.
- *Would you ever add a cache?* For immutable or rarely changing data (old buckets of archived channels, perhaps), or with invalidation driven by change data capture (a stream of every database change) if coalescing bursts is not enough. Not as the first move.

## Further reading

- Bo Ingram, [How Discord Stores Trillions of Messages](https://discord.com/blog/how-discord-stores-trillions-of-messages) (Discord, 2023) — hot partitions, Rust data services with request coalescing, consistent-hash routing, and the move to ScyllaDB.
- Stanislav Vishnevskiy, [How Discord Stores Billions of Messages](https://discord.com/blog/how-discord-stores-billions-of-messages) (Discord, 2017) — the `(channel_id, bucket)` partition key and why buckets exist.
- [Go package singleflight](https://pkg.go.dev/golang.org/x/sync/singleflight) — a minimal, readable implementation of duplicate-call suppression.
- [System Design Primer: Sharding](https://github.com/donnemartin/system-design-primer#sharding) — including lopsided shards and consistent hashing.
- [System Design Primer: Wide column store](https://github.com/donnemartin/system-design-primer#wide-column-store) — the Bigtable/Cassandra data model behind partitions and clustering keys.
- [awesome-scalability](https://github.com/binhnguyennus/awesome-scalability) — a curated list of real-world scaling write-ups, including Discord's Cassandra post.
- Alex Xu, *System Design Interview – An Insider's Guide, Volume 1*, chapters "Design Consistent Hashing" and "Design A Chat System" — the routing technique and the surrounding chat system.
