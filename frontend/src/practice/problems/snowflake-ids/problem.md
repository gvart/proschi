---
title: Snowflake IDs
summary: Unique, time-ordered ids at 20k a second with no central counter.
difficulty: easy
tags: [id-generation, coordination, availability, real-world]
hints:
  - "A counter in a database or a cache means a round trip and one shared bottleneck for every id. What could a generator put in an id that is already unique to it?"
  - "Snowflake packs the time in milliseconds, a worker id and a per-millisecond sequence into 64 bits. Only the worker id needs coordinating, and only once: when the process starts."
  - "\"Start generator\" is the generator claiming its worker id with a write to zk (an ephemeral sequential node). \"Get ID\" then never leaves the generator: no database, no cache, no zk."
  - A gRPC service takes about 2k rps per replica in the simulation; size the generators for 20k rps at well under 70% busy, and keep them under 100% with one replica lost.
---

In 2010 Twitter moved tweets from MySQL to Cassandra, which has no
auto-increment. They needed a service that hands out ids that are unique,
fit in 64 bits, and are *roughly sortable*: two tweets posted at about the
same time get ids close to each other, because that is how Twitter and its
clients sort tweets. The answer was Snowflake.

Build it: a fleet of id generators that the Tweet Service calls for every new
tweet.

## Functional requirements

- **Get ID**: the Tweet Service asks a generator for a new id and gets it
  back with `200`. Ids are 64-bit, unique across all generators, and
  roughly ordered by time.
- **Start generator**: a generator process starts and claims a worker id that
  no other running generator has, by writing to ZooKeeper (`zk`), before it
  serves any id.

Use these use case names exactly: the traffic, requirements and tests in
`problem.proschi` refer to them.

## Scale

- Tens of thousands of ids a second: **20k rps** at peak. Twitter's own
  requirement was at least 10k ids a second *per process*.
- Generators start rarely: about **one a minute** across the fleet.

## Constraints

- No shared counter: making an id never calls a database, a cache or
  ZooKeeper. Coordination happens once per process, at startup.
- p99 of **Get ID** under **40 ms**. Twitter asked for 2 ms per id plus the
  network; the simulation's services are slower, so the limit is set for
  them.
- Get ID available **99.99%** of the time ("highly available" was a
  requirement).
- Losing any single machine must not stop id generation.
- At most **$4,000 / month**, the existing ZooKeeper cluster included.

## What is given

`problem.proschi` declares the `tweets` service (the caller, four replicas)
and `zk`, a three-node ZooKeeper cluster that already exists. Add the
generators, the connections and the two use cases.

## Based on

- Ryan King, [Announcing Snowflake](https://blog.x.com/engineering/en_us/a/2010/announcing-snowflake),
  Twitter Engineering, June 2010: the requirements (at least 10k ids per
  second per process, 2 ms per id, roughly sortable, highly available) and
  the design (timestamp, worker number and sequence; ZooKeeper for worker
  numbers).
- [twitter-archive/snowflake](https://github.com/twitter-archive/snowflake),
  the original code: 41 bits of milliseconds, 10 bits of worker id, 12 bits of
  sequence.
