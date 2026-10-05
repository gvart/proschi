## What you'll learn

- Why a **central counter** (a ticket table, a Redis `INCR`) becomes a bottleneck and a single point of failure for every write in the company.
- How **Snowflake** packs time, a worker id and a sequence into 64 bits so each generator makes unique ids **without asking anyone**.
- The idea of **coordinating once at startup** instead of on every request, and how ZooKeeper's ephemeral nodes make that safe.
- What **"roughly sortable"** (k-sorted) means, and what clocks can do to it.
- How to compare the usual alternatives: auto-increment, ticket servers, UUIDs and block allocation.

## The problem, explained

In 2010 Twitter was moving tweets from MySQL to Cassandra. MySQL had handed out ids with auto-increment. Cassandra has no such thing, and it shouldn't: any node in a distributed database can take a write. Twitter needed a new source of ids with four properties:

- **Unique** across every machine that makes them.
- **64 bits**, so they fit in a long integer everywhere (128-bit UUIDs were too big for their systems).
- **Roughly sortable by time**: two tweets posted around the same moment get nearby ids, because timelines and APIs like "tweets since id X" sort by id.
- **Fast and highly available**: at least 10k ids per second per process, about 2 ms each plus network, and never the reason a tweet can't be posted.

Their answer was Snowflake, a small service that makes ids from the clock. In this problem you build it.

Two use cases:

- **Get ID**: the Tweet Service asks a generator for an id and gets it with `200`.
- **Start generator**: a generator process starts and claims a **worker id** that no other running generator holds, by writing to ZooKeeper, before serving any id.

The non-functional requirements:

- **Scale**: 20k ids per second at peak. Generators start about once a minute across the fleet.
- **No shared counter**: making an id never calls a database, a cache or ZooKeeper.
- **Latency**: p99 of Get ID (the time 99% of requests beat) under 40 ms. That is looser than Twitter's 2 ms because the simulation's services are slower.
- **Availability**: Get ID up 99.99% of the time.
- **Fault tolerance**: losing any single machine doesn't stop id generation.
- **Budget**: $4,000 a month, including the existing ZooKeeper cluster.

`given.proschi` fixes the caller, `tweets` (four replicas), and `zk`, a three-node ZooKeeper cluster that already exists and that you pay for. You add the generators, the connections and both use cases.

The tests, in plain words:

1. **An id is made without a round trip to shared storage**: Get ID starts at `tweets` and never calls any database or cache.
2. **Each generator claims its worker id once, at startup**: Start generator calls `zk` and writes to it before responding, and Get ID never calls `zk`.

## Back-of-the-envelope

| Quantity | Arithmetic | Result |
|---|---|---|
| Ids per second | given | 20,000 |
| Ids per day | 20,000 × 86,400 | ≈ 1.7 billion |
| Time range of 41 bits of milliseconds | 2⁴¹ ms ÷ (1000 × 3600 × 24 × 365) | ≈ 69.7 years |
| Workers addressable with 10 bits | 2¹⁰ | 1,024 |
| Ids per worker per millisecond (12-bit sequence) | 2¹² | 4,096 |
| Ids per worker per second, theoretical | 4,096 × 1,000 | ≈ 4 million |
| Generator starts | 1 per minute | ≈ 0.017 per second |

Two takeaways. First, the bit budget is comfortable: 70 years of timestamps, a thousand generators, and a per-worker ceiling far above any realistic load. Second, the startup traffic to ZooKeeper is tiny. It's the per-id traffic that would hurt if you sent it anywhere shared.

Now compare what a shared counter would face, using the simulation's per-replica defaults:

| Design | Where every id goes | Capacity | Load / capacity |
|---|---|---|---|
| Ticket table in MySQL | the one primary (writes) | 5,000 writes/s per shard | 20,000 / 5,000 = 400% |
| Counter in Redis | one counter key | 100,000 ops/s | 20%, but a round trip and a dependency per id |
| Snowflake | nowhere: made in memory | — | — |

The MySQL design gets four times the writes it can take. Replicas don't help, because all writes go through one primary. Redis survives the load but still puts a shared component in the path of every tweet.

The generators themselves are services. In the simulation a `[gRPC]` service handles about 2,000 rps per replica, so 20,000 rps needs **at least 10 replicas just to reach 100%**, which is saturation, not a design. Size the fleet so it stays well below 70% busy, and remember that `survive any node failure` removes one replica and re-checks that nothing saturates and p99 still holds. (Real Snowflake processes are far faster: Twitter asked for 10k ids per second each. The model's services are deliberately generic.)

Other numbers that show up in the Analysis tab:

- **Latency.** The Get ID path is a single hop: the caller to a generator, about 10 ms idle. The 40 ms p99 is there to catch queueing (a fleet run too hot) and extra round trips (asking a store or ZooKeeper per id).
- **Availability.** A single service replica is up 99.5% in the model, far short of 99.99%. Two replicas give 99.9975%; a fleet of generators is effectively always up, because any one of them can answer.
- **Cost.** About $100 per service replica per month, and the given ZooKeeper cluster's three nodes are part of your bill. Work out what that leaves for generators before you size them.

## Concepts

### Composite ids: time + worker + sequence

**What it is.** A Snowflake id is a 64-bit integer built from three fields:

| Bits | Field | Meaning |
|---|---|---|
| 1 | sign | always 0, so the id is positive |
| 41 | timestamp | milliseconds since a custom epoch |
| 10 | worker id | which generator made it |
| 12 | sequence | counter within the current millisecond |

(The original code splits the 10 worker bits into 5 bits of datacenter and 5 of worker, which is the same idea.)

**Why it's unique without coordination.** Two ids from different workers differ in the worker field. Two ids from the same worker differ in the timestamp, or, within one millisecond, in the sequence. If a worker uses up all 4,096 sequence values in one millisecond, it waits for the next millisecond. Nothing in that logic needs another machine.

**Why it sorts by time.** The timestamp is in the high bits, so comparing ids compares times first. Ids from different workers in the same millisecond are ordered by worker id, not by the real order of events. That's what *roughly* (or *k-sorted*) means: ids are sorted to within the clock skew between machines.

**Trade-offs.** It depends on clocks. If NTP steps a clock backwards, a worker could repeat timestamps; the original Snowflake refuses to make ids until the clock passes the last timestamp it used. Ids also leak information: anyone can read the creation time from an id, and roughly how busy a worker is.

**When not to use it.** When ids must be unguessable (use random tokens), strictly ordered (you need a single sequencer), or dense with no gaps (invoice numbers).

```proschi
title "Local id generation"

caller "Order Service" [REST API] x3
gen    "ID Generator"  [gRPC]     x3 "time | worker | sequence, all in memory"

caller -> gen : RPC

usecase "New id" {
  caller -> gen    : GET next id
  gen   --> caller : 200 {"id": 7194012332411158528}
}
```

### Coordinate once, at startup

**What it is.** The only thing two generators must never share is the worker id. So the coordination happens once, when a process starts: it claims a worker id from a coordination service and keeps it for its lifetime. Every id after that is made in memory.

**Why ZooKeeper.** ZooKeeper is a small, strongly consistent store built for exactly this kind of agreement. A process can create an **ephemeral** node (one that disappears automatically when the process's session ends) under a path like `/snowflake/workers/`. While the process lives, its claim lives; if it dies, the claim is released and the worker id can be reused. A **sequential** node gets a unique, increasing suffix, which is a convenient way to hand out numbers. In practice you'd map it into the 0–1,023 range, or try to create `/workers/<n>` for the lowest free `n`.

**Trade-offs.** If ZooKeeper is down, *new* generators can't start, but running ones keep serving ids. That's the point: the coordination system is off the hot path, so its outages and its latency don't touch tweets. The risk is a process that loses its ZooKeeper session but keeps running: it must stop serving ids, or another process could claim the same worker id.

**When not to use it.** With a small, fixed fleet, worker ids can simply come from configuration (a hostname or an index). A coordination service is worth it when processes come and go automatically.

```proschi
title "Claim at startup"

worker "Worker"      [gRPC]      x3
coord  "Coordinator" [ZooKeeper] x3

worker -> coord : claim slot

usecase "Boot" {
  worker -> coord  : CREATE /workers/ ephemeral sequential
  coord --> worker : slot 12
}
```

### The usual alternatives

Interviewers like to see you weigh options before you land on one:

- **Auto-increment in one database.** Simple, dense, strictly ordered. Every id is a write to one primary: a throughput ceiling and a single point of failure.
- **Ticket servers** (Flickr's approach). A dedicated MySQL table whose only job is auto-increment, often two servers with interleaved sequences (one odd, one even) for redundancy. Cheap and proven, but still a round trip per id, and ordering across the two servers is only approximate.
- **Block allocation.** Each server claims a block of, say, 10,000 numbers from a central counter and hands them out locally. One round trip per block instead of per id; ids are not time-ordered across servers.
- **Random UUIDs (version 4).** No coordination at all, but 128 bits and no time order, which also hurts database indexes because inserts land in random places.
- **Time-ordered UUIDs** (such as UUIDv7) keep the "no coordination" property and sort by time, but are still 128 bits.
- **Instagram's variant.** Time, a logical shard id and a sequence, generated inside each PostgreSQL shard: the same composite idea, without a separate service.

**When to pick something other than Snowflake.** If a few thousand ids per second is all you'll ever need, a ticket server is simpler to run. If ids never need to sort, UUIDs need no infrastructure at all.

A ticket server pair, for comparison, puts a store on every id:

```proschi
title "Ticket servers"

app  "App"           [REST API] x4
odd  "Tickets odd"   [MySQL]    x1 "auto_increment_offset 1, increment 2"
even "Tickets even"  [MySQL]    x1 "auto_increment_offset 2, increment 2"

app -> odd  : SQL
app -> even : SQL

usecase "New id" {
  app  -> odd : REPLACE INTO Tickets64
  odd --> app : LAST_INSERT_ID()
}
```

## Designing it step by step

### Step 1: Scope

Pin the properties: unique, 64-bit, roughly time-ordered, fast, highly available. Ask how strict the ordering must be ("within a second is fine" unlocks the design), whether gaps are allowed (yes), and how many generator processes you might run (fewer than a thousand fits 10 bits). Note the scale: 20k ids per second.

### Step 2: High-level design

Start from the simplest thing that works and break it on purpose: "The database's auto-increment works, but 20k writes a second to one primary is four times what it takes, and it's a single point of failure." Try Redis `INCR`: fast enough, but every tweet now depends on one key on one cache, and a failover with asynchronous replication can hand out the same number twice.

Then introduce the composite id. Draw the generators as a service the Tweet Service calls directly; every generator can answer every request, so no load balancer is needed. Add the connection from the generators to ZooKeeper, and write two use cases: Get ID (one hop, made in memory) and Start generator (one write to ZooKeeper).

### Step 3: Deep dive

**The bit layout.** Walk through the 41/10/12 split and the arithmetic above. Mention the custom epoch: counting from, say, 2010 instead of 1970 keeps 41 bits useful for decades longer.

**Sequence overflow.** If a worker hands out 4,096 ids in one millisecond, it waits for the next one. At 20k ids per second spread over a fleet, that never happens; say so.

**Clocks.** Run NTP, configure it to slew rather than step backwards, and have the generator refuse to make ids if its clock is behind the last timestamp it used. That's a brief error for callers, never a duplicate.

**Worker ids.** Claimed in ZooKeeper at startup with an ephemeral node; released when the process dies. In the Start generator use case, the write to `zk` comes before the generator responds (or serves anything).

**Sizing.** Take 20k rps, divide by the per-replica capacity, then add headroom so the fleet stays well below 70% busy, and check it again with one replica gone. Then read the Analysis tab: p99 of Get ID under 40 ms, the fleet's utilisation, and the total cost against $4,000 with ZooKeeper included.

### Step 4: Wrap up

"Each generator claims a worker id from ZooKeeper once, then makes ids from its clock, its worker id and a per-millisecond sequence. No shared state on the hot path: any generator can answer, ZooKeeper can be down without stopping ids, and ids sort by time to within clock skew." Then list what you'd watch: clock drift alarms, sequence exhaustion (it shouldn't happen), and worker id reuse after a crash.

## Common mistakes

**The ticket table in MySQL** (`wrong/ticket-table-in-mysql`). The classic ticket server: every id is an auto-increment row on one primary. In the real world it's a fine choice at a few thousand ids per second, and Flickr ran it for years. At 20k per second it saturates: the primary takes about 5k writes per second in the model, and read replicas add nothing to write capacity. Caught by **An id is made without a round trip to shared storage** and **p99 of Get ID < 40 ms**.

**A counter in Redis** (`wrong/counter-in-redis`). Here the numbers look fine: Redis handles 20k `INCR`s a second without breaking a sweat, and p99 passes. That's exactly why it's a good lesson. The problems are structural: every id is a network round trip to one shared key, the cache becomes a dependency of every tweet, and if the Redis primary fails before replicating its latest increments, the promoted replica can hand out ids that were already used. Only the flow test catches it: **An id is made without a round trip to shared storage**.

**Asking ZooKeeper on every id** (`wrong/coordinates-every-id`). The generator checks "is worker 37 still mine?" before each id. Correct, but it puts the coordination cluster on the hot path of every tweet: each id now waits for a ZooKeeper round trip, and any ZooKeeper hiccup (a leader election, a slow disk) stalls tweet creation across the company. Caught by **Each generator claims its worker id once, at startup**; it also fails the p99 limit and the shared-storage test (ZooKeeper is a store).

**One generator** (`wrong/one-generator`). A single process is a single point of failure, and at 20k rps it's saturated anyway. Caught by `survive any node failure`, and it also fails p99 and the 99.99% availability target.

**Random UUIDs.** Not a wrong design here, since the tests can't see id formats, but a wrong answer in the interview: 128 bits breaks the 64-bit requirement, and random ids don't sort by time.

## In the interview

**How to present it.** List the requirements as a short checklist (unique, 64-bit, time-ordered, fast, available) and test every candidate against it: auto-increment, ticket server, Redis, UUID, then Snowflake. Each one fails a box until the last. Draw the bit layout; it's the heart of the answer. Then show how little coordination remains: one write at startup.

Follow-up questions:

- **"What if the clock goes backwards?"** Refuse to generate until the clock catches up (or wait if it's a few milliseconds), alert, and run NTP in slew mode.
- **"What if two processes get the same worker id?"** They could produce duplicates. That's why claims are ephemeral nodes in a strongly consistent store, and why a process that loses its session must stop serving.
- **"How many ids per second can one worker make?"** Up to 4,096 per millisecond, about 4 million per second, before it has to wait for the next millisecond.
- **"When do you run out?"** 41 bits of milliseconds last about 69 years from the custom epoch.
- **"Can clients tell when an id was created?"** Yes, shift right by 22 bits and add the epoch. Fine for tweets; for private objects, consider that a leak.
- **"Could you skip the service and generate ids in the caller?"** Yes, as a library, if each caller process can get a unique worker id. Instagram did it inside the database instead. A service is easier to version and monitor.

## Further reading

- [twitter-archive/snowflake, the 2010 release](https://github.com/twitter-archive/snowflake/tree/snowflake-2010): the original README states the requirements and the 41/10/12 layout, and `IdWorker.scala` shows the clock-moved-backwards check.
- [Announcing Snowflake](https://blog.x.com/engineering/en_us/a/2010/announcing-snowflake) (Ryan King, Twitter Engineering, 2010): why Twitter needed it and how they chose the design.
- [Ticket Servers: Distributed Unique Primary Keys on the Cheap](https://code.flickr.net/2010/02/08/ticket-servers-distributed-unique-primary-keys-on-the-cheap/) (Flickr): the ticket-server design this problem's wrong answer is based on, from the people who ran it.
- [Sharding & IDs at Instagram](https://instagram-engineering.com/sharding-ids-at-instagram-1cf5a71e5a5c): the same composite-id idea generated inside PostgreSQL shards, with a comparison of the alternatives.
- *System Design Interview – An Insider's Guide*, Vol. 1 (Alex Xu), chapter "Design A Unique Id Generator In Distributed Systems": the interview-format comparison of the approaches above.
- [System Design Primer: Additional system design interview questions](https://github.com/donnemartin/system-design-primer#additional-system-design-interview-questions): lists "Design a random ID generation system" with Snowflake as the reference.
- [awesome-scalability](https://github.com/binhnguyennus/awesome-scalability): links the Instagram post and many other real-world write-ups on sharding and ids.
