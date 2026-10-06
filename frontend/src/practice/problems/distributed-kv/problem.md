---
title: Distributed Key-Value Store
summary: Dynamo-style quorums on a consistent-hashing ring that keep writing when a node dies.
difficulty: hard
tags: [replication, sharding, consistency, availability, write-heavy]
hints:
  - "Every key lives on three storage nodes. A coordinator in front of them decides which three (consistent hashing) and talks to them; the application servers never pick a node themselves."
  - "Choose R and W so that R + W > N = 3: write to all three replicas and answer after two (W = 2), read two (R = 2). Write the fan-out with the prefixes, x3 PUT and x2 GET, so the simulation counts every replica operation."
  - "In \"Replica down\", answer after the two healthy replicas acknowledge, then let the call to the third fail (-x) and write its copy to another node with a hint. In \"Stale replica\", write the newer version back to the stale node before you answer."
  - "Clients make 40k requests a second, but the replicas see 60k reads and 30k writes. Pick the number of shards (capacity { nodes shards <n> }) so that a replica group that loses a node stays well under 100%, and size the coordinators at about 2k requests a second each."
---

Build the storage layer itself: a key-value store in the style of Amazon's
Dynamo and of Cassandra and Riak, which copied it. Application servers put
and get small values (sessions, carts, user settings) by key. The store
spreads the keys over a cluster of commodity machines, keeps every key on
three of them, and must keep accepting writes when one machine is down.

## Functional requirements

- **Put**: an application server stores a value under a key and gets `204`.
  The write goes to the key's three replicas and succeeds once two of them
  have it. Two scenarios: `"All replicas up"`, and `"Replica down"`, where
  one of the three does not answer and the write still succeeds.
- **Get**: an application server reads the value under a key (`200`). The
  read asks two replicas. Two scenarios: `"Replicas agree"`, and
  `"Stale replica"`, where one of them returns an older version.

Use these use case and scenario names exactly: the traffic, requirements and
tests in `problem.proschi` refer to them.

## Scale

- **Put: 10k rps** and **Get: 30k rps** at peak, values of about 1 KB.
- Every key has **three replicas** (N = 3). A write goes to all three and
  is acknowledged after two (W = 2); a read asks two (R = 2).
- About **0.2%** of writes find one of their replicas down, and about **2%**
  of reads find a replica that missed a write.
- A storage node takes **20k reads** and **20k writes** a second at
  **$500 / month** (the default for a partitioned NoSQL store).

## Constraints

- Application servers never talk to the storage nodes directly: a
  coordinator tier routes every request.
- A write must succeed when one of its three replicas is down.
- A read that finds a stale replica repairs it.
- Reads are served by the replicas, never by a cache: a value read must be
  one a read quorum returned.
- p99 of **Put** and of **Get** under **60 ms**.
- Every use case available **99.99%** of the time.
- Losing any single machine must not break a latency limit.
- At most **$9,500 / month**.

## What is given

`problem.proschi` declares the `apps` (the application servers, the
clients) and `nodes`, the storage nodes, with their three replicas. You
decide how many replica groups the ring is split into with
`capacity { nodes shards <n> }` in your file: each shard is three more
machines. The file also holds the traffic, requirements and tests. Add the
coordinators, the connections and the two use cases.

The simulation has no notion of "two of three". Write a write to all three
replicas as `x3 PUT …` and a read of two as `x2 GET …`: the prefix makes it
count every replica operation, while the latency counts the step once, as
if the calls went out in parallel. A replica that is down is a failed call
(`-x`).
