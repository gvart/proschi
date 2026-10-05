---
title: Social Graph Cache
summary: "Facebook's TAO: follower and leader cache tiers over sharded MySQL."
difficulty: hard
tags: [caching, consistency, sharding, read-heavy, real-world]
company: Meta
hints:
  - "Reads are 99.8% of the traffic and 96.4% of them hit the cache. The follower tier answers the web tier; on a miss it asks the shard's leader, and only the leader reads MySQL."
  - "Writes take the same road: web → followers → leaders → MySQL. The leader commits, updates its own cache and answers; the follower that forwarded the write updates itself on the way back, so the writer sees its own write."
  - "The other followers still hold the old value. After the commit, the leader sends them an invalidation or refill with ->>: the writer does not wait for it. There is no connection from the followers or the web tier to MySQL."
  - "About 36k reads a second miss the followers. A MySQL shard has a primary and a replica (x2) taking 20k reads each, and losing one must not overload its shard: choose the shard count with capacity { db shards N }. Size the followers for 1M reads a second at well under 70% busy."
---

Facebook's social graph (people, posts, check-ins, and the likes,
friendships and comments between them) is read at enormous rates and
written rarely. It used to be served by memcache in front of MySQL, with
every web server filling and invalidating the cache itself. TAO replaced
that with a graph-aware cache that owns the path to the database.

TAO has two cache tiers. **Followers** take all requests from the web tier
and can be added freely. Each shard has one **leader**, the only server that
reads or writes that shard in MySQL. A follower's miss and every write go
to the leader; after a write commits, the leader tells the other followers
asynchronously.

Design one region's slice of it.

## Functional requirements

- **Read**: a web server reads an object or an association list (such as
  the posts a user liked). Two scenarios: `"Follower hit"`, answered by the
  follower; `"Follower miss"`, where the follower asks the shard's leader,
  which reads MySQL.
- **Write**: a web server adds an association. The write goes through a
  follower to the shard's leader, which commits it to MySQL before
  answering; the other followers are updated after the commit, without the
  writer waiting for them.

Name the two tiers `followers` and `leaders`: the tests in
`problem.proschi` refer to them, and to the use case and scenario names
above.

## Scale

- **1M reads per second** and **2k writes per second** in this slice: reads
  are **99.8%** of TAO's requests, writes **0.2%**.
- **96.4%** of reads hit the follower tier.

## Constraints

- Only the leader tier talks to MySQL: no connection from the web tier or
  the followers to it.
- A write is committed to MySQL before the writer hears back.
- p99 of a read under **25 ms**, of a write under **60 ms**.
- Reads available **99.99%** of the time.
- Losing any single machine, a MySQL replica included, must not break a
  latency limit.
- At most **$6,000 / month**, MySQL included.

## What is given

`problem.proschi` declares the `web` tier (the client) and `db`, the MySQL
fleet: a primary and a replica per shard. Choose how many shards with
`capacity { db shards N }`, and add the two cache tiers, the connections and
the two use cases.

## Based on

- N. Bronson et al., [TAO: Facebook's Distributed Data Store for the Social Graph](https://www.usenix.org/conference/atc13/technical-sessions/presentation/bronson),
  USENIX ATC 2013 ([paper](https://www.usenix.org/system/files/conference/atc13/atc13-bronson.pdf)):
  a billion reads and millions of writes per second, follower and leader
  cache tiers, one leader per shard as the only reader and writer of MySQL,
  asynchronous invalidation and refill of followers, and an overall cache
  hit rate of 96.4%.
- A. Cheng et al., [TAOBench: An End-to-End Benchmark for Social Network Workloads](https://www.vldb.org/pvldb/vol15/p1965-cheng.pdf),
  VLDB 2022: TAO's request mix, 99.8% reads and 0.2% writes.
