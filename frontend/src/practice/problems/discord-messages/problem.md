---
title: Discord Messages
summary: "Discord's message store: Rust data services that coalesce reads in front of a hot ScyllaDB partition."
difficulty: hard
company: Discord
tags: [hot-partitions, request-coalescing, sharding, read-heavy, real-world]
hints:
  - "Adding nodes does not help: one channel's recent messages live in one partition, on the three replicas that own it. What could stop thousands of identical reads from reaching those replicas at all?"
  - "Put a service between the API and ScyllaDB (Discord's data services, in Rust) and send every query through it. There is no connection from the API to the database."
  - "When a request arrives for a channel whose query is already running, the data service subscribes it to that query instead of starting another: in \"Joined in-flight read\" the data service answers without calling the database; only \"First read\" reads hot. Route by a consistent hash of channel_id so all requests for a channel reach the same instance and find each other."
  - "Reads and writes run at QUORUM: a read asks 2 replicas (x2), a write goes to all 3 (x3). The data services take every request, 60k a second, at about 2k per replica: size them well under 70% busy, and keep the budget in mind. No cache: send and read go straight through."
---

Discord stores every message ever sent: trillions of them. Messages are
partitioned by **channel and a time bucket**, so a channel's recent
messages sit together in one partition, copied to three nodes. That makes
the usual read (open a channel, load its latest 50 messages) one cheap
query, until a huge server pings everyone. Then hundreds of thousands of
people open the same channel within seconds, and every one of their reads
lands on the same three replicas: a **hot partition**. Reads run at quorum,
so a hot partition slows every query those nodes serve, not only the busy
channel's.

Moving from Cassandra to ScyllaDB helped, but the fix that made hot
partitions harmless was a layer in front of the database.

## Functional requirements

- **Send message**: a user posts a message. It is written to the messages
  cluster (all three replicas, at quorum) before the sender hears back.
- **Read messages**: a user opens an ordinary channel and loads its latest
  50 messages from the messages cluster.
- **Read busy channel**: everyone in a huge server opens the channel that
  was just pinged; the reads all hit the `hot` partition. Two scenarios:
  - `"Joined in-flight read"`: a query for the same channel is already
    running, and the request gets that query's result.
  - `"First read"`: no query for the channel is in flight, so this request
    reads the partition, and everyone who joins meanwhile gets the result.

Name the layer in front of the database `data`: the tests in
`problem.proschi` refer to it, and to the use case and scenario names above.

## Scale

- **5k sends**, **15k ordinary reads** and **40k reads of the busy channel**
  per second. Discord does not publish request rates; these are assumptions
  for the exercise.
- Thanks to coalescing, about **1%** of the busy channel's reads start a
  query of their own.
- The cluster is **72 nodes** (24 shards of 3 replicas), sized for trillions
  of messages on disk rather than for request load. A single partition,
  though, is read only by its 3 replicas, which take **10k reads a second
  each**.

## Constraints

- Every query goes through the data services: no connection from the API to
  the database.
- No message cache. Messages are edited, deleted and reacted to all the
  time, and a cache would have to be invalidated on every one of those
  writes; the data services hold nothing but the queries in flight.
- A message is written to ScyllaDB before the sender hears back.
- p99 of every use case under **60 ms**.
- Every use case available **99.99%** of the time.
- Losing any single machine must not break a latency limit.
- At most **$42,000 / month**, the 72 database nodes included.

## What is given

`problem.proschi` declares the `api` (the client of this problem), the
`messages` cluster and `hot`, the busy channel's partition. Both are
ScyllaDB, fixed by the problem: you cannot add replicas or shards to them.
Add the data services, the connections and the three use cases.

## What this model leaves out

- The simulation spreads a node's load evenly over its replicas and shards,
  so it cannot see one hot key. The problem draws the busy channel's
  partition as its own node, `hot`, with the three replicas that own it;
  in the real cluster they are 3 of the 72 and also serve other channels.
- That one data service instance takes all of a channel's requests is not
  simulated either: the model spreads them over the instances. The share of
  reads that join a query in flight is the scenario mix, not something the
  routing earns.
- How a hot partition at quorum slows unrelated queries on the same nodes is
  described, not simulated.

## Based on

- Bo Ingram, [How Discord Stores Trillions of Messages](https://discord.com/blog/how-discord-stores-trillions-of-messages),
  Discord blog, March 2023: 177 Cassandra nodes holding trillions of
  messages, hot partitions under quorum reads, Rust data services with one
  gRPC endpoint per query that coalesce concurrent requests for the same
  rows, consistent hash-based routing by channel_id, and the move to 72
  ScyllaDB nodes (p99 of historical reads from 40–125 ms down to 15 ms,
  inserts from 5–70 ms to a steady 5 ms).
- Stanislav Vishnevskiy, [How Discord Stores Billions of Messages](https://discord.com/blog/how-discord-stores-billions-of-messages),
  Discord blog, January 2017: messages partitioned by `(channel_id, bucket)`
  with a static 10-day bucket, sized so the busiest channel's partitions
  stay near 100 MB, and a read/write ratio of about 50/50.
