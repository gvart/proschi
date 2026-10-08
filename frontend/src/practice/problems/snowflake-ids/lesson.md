```tldr
A central counter puts **one shared component on every write**. Snowflake packs **41 bits of time, 10 bits of worker id and a 12-bit sequence** into 64 bits, so each generator makes unique, **roughly time-sorted** ids in memory. The only coordination is **claiming a worker id once, at startup**, from ZooKeeper.
```

## What you'll learn

- Why a **central counter** (a ticket table, a Redis `INCR`) becomes a bottleneck and a single point of failure for every write in the company.
- How **Snowflake** packs time, a worker id and a sequence into 64 bits so each generator makes unique ids **without asking anyone**.
- The idea of **coordinating once at startup** instead of on every request, and how ZooKeeper's ephemeral nodes make that safe.
- What **"roughly sortable"** (k-sorted) means, and what clocks can do to it.
- How to compare the usual alternatives: auto-increment, ticket servers, UUIDs and block allocation.

## The problem, explained

In 2010 Twitter moved tweets from MySQL, which handed out ids with auto-increment, to Cassandra, which has no such thing (any node can take a write). It needed a new source of ids with four properties:

- **Unique** across every machine that makes them.
- **64 bits**, so they fit in a long integer everywhere (128-bit UUIDs were too big for their systems).
- **Roughly sortable by time**: tweets posted around the same moment get nearby ids, because timelines and APIs like "tweets since id X" sort by id.
- **Fast and highly available**: at least 10k ids per second per process, about 2 ms each plus network, and never the reason a tweet can't be posted.

Their answer was Snowflake, a small service that makes ids from the clock. You build it here.

Two use cases:

- **Get ID**: the Tweet Service asks a generator for an id and gets it with `200`.
- **Start generator**: a starting generator claims a **worker id** no other running generator holds, by writing to ZooKeeper, before serving any id.

The non-functional requirements:

- **Scale**: 20k ids per second at peak. Generators start about once a minute across the fleet.
- **No shared counter**: making an id never calls a database, a cache or ZooKeeper.
- **Latency**: p99 of Get ID (the time 99% of requests beat) under 40 ms, looser than Twitter's 2 ms because the simulation's services are slower.
- **Availability**: Get ID up 99.99% of the time.
- **Fault tolerance**: losing any single machine doesn't stop id generation.
- **Budget**: $4,000 a month, including the existing ZooKeeper cluster.

`given.proschi` fixes the caller, `tweets` (four replicas), and `zk`, an existing three-node ZooKeeper cluster you pay for. You add the generators, connections and both use cases.

The tests, in plain words:

1. **An id is made without a round trip to shared storage**: Get ID starts at `tweets` and never calls any database or cache.
2. **Each generator claims its worker id once, at startup**: Start generator calls `zk` and writes to it before responding, and Get ID never calls `zk`.

## Back-of-the-envelope

```numbers
20,000 / s | ids at peak
≈ 69.7 years | of 41-bit millisecond timestamps
1,024 | workers addressable with 10 bits
4,096 | ids per worker per millisecond
400% | of a MySQL ticket table's capacity
```

| Quantity | Arithmetic | Result |
|---|---|---|
| Ids per second | given | 20,000 |
| Ids per day | 20,000 × 86,400 | ≈ 1.7 billion |
| Time range of 41 bits of milliseconds | 2⁴¹ ms ÷ (1000 × 3600 × 24 × 365) | ≈ 69.7 years |
| Workers addressable with 10 bits | 2¹⁰ | 1,024 |
| Ids per worker per millisecond (12-bit sequence) | 2¹² | 4,096 |
| Ids per worker per second, theoretical | 4,096 × 1,000 | ≈ 4 million |
| Generator starts | 1 per minute | ≈ 0.017 per second |

```callout takeaway Two takeaways
The bit budget is comfortable: 70 years of timestamps, a thousand generators, a per-worker ceiling far above any realistic load. Startup traffic to ZooKeeper is tiny; per-id traffic is what would hurt if sent anywhere shared.
```

```quiz
snowflake-throughput
```

What a shared counter would face, with the simulation's per-replica defaults:

| Design | Where every id goes | Capacity | Load / capacity |
|---|---|---|---|
| Ticket table in MySQL | the one primary (writes) | 5,000 writes/s per shard | 20,000 / 5,000 = 400% |
| Counter in Redis | one counter key | 100,000 ops/s | 20%, but a round trip and a dependency per id |
| Snowflake | nowhere: made in memory | — | — |

MySQL gets four times the writes it can take, and replicas don't help: all writes go through one primary. Redis survives the load but still puts a shared component in the path of every tweet.

The generators themselves are services. A `[gRPC]` service handles about 2,000 rps per replica in the simulation, so 20,000 rps needs **at least 10 replicas just to reach 100%**: saturation, not a design. Keep the fleet well below 70% busy, and remember that `survive any node failure` removes one replica and re-checks that nothing saturates and p99 still holds. (Real Snowflake processes are far faster: Twitter asked for 10k ids per second each; the model's services are deliberately generic.)

Other numbers in the Analysis tab:

- **Latency.** Get ID is a single hop, caller to generator, about 10 ms idle. The 40 ms p99 catches queueing (a fleet run too hot) and extra round trips (asking a store or ZooKeeper per id).
- **Availability.** One service replica is up 99.5% in the model, far short of 99.99%. Two give 99.9975%; a fleet is effectively always up, because any generator can answer.
- **Cost.** About $100 per service replica per month, plus the given ZooKeeper cluster's three nodes. Work out what that leaves before sizing the generators.

## Concepts

### Composite ids: time + worker + sequence

**What it is.** A Snowflake id is a 64-bit integer built from three fields:

| Bits | Field | Meaning |
|---|---|---|
| 1 | sign | always 0, so the id is positive |
| 41 | timestamp | milliseconds since a custom epoch |
| 10 | worker id | which generator made it |
| 12 | sequence | counter within the current millisecond |

(The original code splits the 10 worker bits into 5 bits of datacenter and 5 of worker: the same idea.)

**Why it's unique without coordination.** Ids from different workers differ in the worker field. Ids from the same worker differ in the timestamp or, within one millisecond, in the sequence. A worker that uses all 4,096 sequence values in a millisecond waits for the next one. Nothing needs another machine.

**Why it sorts by time.** The timestamp is in the high bits, so comparing ids compares times first. Ids from different workers in the same millisecond are ordered by worker id, not by the real order of events. That's *roughly* (or *k-sorted*): sorted to within the clock skew between machines.

**Trade-offs.** It depends on clocks: if NTP steps a clock backwards, a worker could repeat timestamps, so the original Snowflake refuses to make ids until the clock passes the last timestamp it used. Ids also leak the creation time, and roughly how busy a worker is.

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

```quiz
snowflake-id-layout
snowflake-clock-backwards
```

### Coordinate once, at startup

**What it is.** The only thing two generators must never share is the worker id. So a process claims one from a coordination service once, when it starts, and keeps it for its lifetime. Every id after that is made in memory.

**Why ZooKeeper.** ZooKeeper is a small, strongly consistent store built for exactly this kind of agreement:

- An **ephemeral** node disappears automatically when the process's session ends. Created under a path like `/snowflake/workers/`, the claim lives while the process lives; if it dies, the worker id is released for reuse.
- A **sequential** node gets a unique, increasing suffix, a convenient way to hand out numbers. In practice you'd map it into the 0–1,023 range, or try to create `/workers/<n>` for the lowest free `n`.

**Trade-offs.** If ZooKeeper is down, *new* generators can't start, but running ones keep serving: coordination is off the hot path, so its outages and latency don't touch tweets. The risk is a process that loses its session but keeps running: it must stop serving ids, or another could claim the same worker id.

```callout tip When not to use it
With a small, fixed fleet, worker ids can simply come from configuration (a hostname or an index). A coordination service is worth it when processes come and go automatically.
```

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

```quiz
ephemeral-znode
```

### The usual alternatives

Interviewers like to see you weigh options first:

| Approach | How | Upside | Cost |
|---|---|---|---|
| **Auto-increment in one database** | One table's counter | Simple, dense, strictly ordered | Every id is a write to one primary: a throughput ceiling and a single point of failure |
| **Ticket servers** (Flickr's approach) | A MySQL table that only auto-increments, often on two servers with interleaved sequences (one odd, one even) | Cheap and proven | A round trip per id; ordering across the two is only approximate |
| **Block allocation** | Each server claims a block of, say, 10,000 numbers from a central counter | One round trip per block, not per id | Not time-ordered across servers |
| **Random UUIDs (version 4)** | Random 128 bits | No coordination at all | No time order; inserts land in random index places |
| **Time-ordered UUIDs** (such as UUIDv7) | Time plus randomness | No coordination, sorts by time | Still 128 bits |
| **Instagram's variant** | Time, logical shard id and sequence, made inside each PostgreSQL shard | The composite idea without a separate service | Lives in the database |

**When to pick something other than Snowflake.** If a few thousand ids per second is all you'll ever need, a ticket server is simpler to run. If ids never need to sort, UUIDs need no infrastructure at all.

````deepdive A ticket server pair in Proschi
For comparison, a ticket server pair puts a store on every id:

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
````

## Designing it step by step

### Step 1: Scope

Pin the properties: unique, 64-bit, roughly time-ordered, fast, highly available. Ask how strict the ordering is ("within a second is fine" unlocks the design), whether gaps are allowed (yes), and how many generators you might run (under a thousand fits 10 bits). Note the scale: 20k ids per second.

### Step 2: High-level design

Start from the simplest thing that works and break it on purpose: "Auto-increment works, but 20k writes a second to one primary is four times what it takes, and it's a single point of failure." Try Redis `INCR`: fast enough, but every tweet now depends on one key on one cache, and a failover with asynchronous replication can hand out the same number twice.

Then introduce the composite id. The Tweet Service calls the generators directly; any generator can answer any request, so no load balancer is needed. Connect the generators to ZooKeeper and write two use cases: Get ID (one hop, made in memory) and Start generator (one write to ZooKeeper).

### Step 3: Deep dive

**The bit layout.** Walk through the 41/10/12 split and the arithmetic above. A custom epoch (say 2010 instead of 1970) keeps 41 bits useful for decades longer.

**Sequence overflow.** A worker that hands out 4,096 ids in one millisecond waits for the next. At 20k ids per second spread over a fleet, that never happens; say so.

**Clocks.** Run NTP, configured to slew rather than step backwards, and have the generator refuse to make ids if its clock is behind the last timestamp it used: a brief error for callers, never a duplicate.

**Worker ids.** Claimed in ZooKeeper at startup with an ephemeral node; released when the process dies. In Start generator, the write to `zk` comes before the generator responds (or serves anything).

**Sizing.** Divide 20k rps by the per-replica capacity, add headroom to stay well below 70%, and recheck with one replica gone. Then read the Analysis tab: p99 of Get ID under 40 ms, utilisation, and the total against $4,000 with ZooKeeper.

### Step 4: Wrap up

"Each generator claims a worker id from ZooKeeper once, then makes ids from its clock, its worker id and a per-millisecond sequence. No shared state on the hot path: any generator can answer, ZooKeeper can be down without stopping ids, and ids sort by time to within clock skew." Then list what you'd watch: clock drift, sequence exhaustion (it shouldn't happen), worker id reuse after a crash.

## Common mistakes

**The ticket table in MySQL** (`wrong/ticket-table-in-mysql`). Every id is an auto-increment row on one primary: fine at a few thousand ids per second, and Flickr ran it for years. At 20k per second it saturates: the primary takes about 5k writes per second in the model, and read replicas add no write capacity. Caught by **An id is made without a round trip to shared storage** and **p99 of Get ID < 40 ms**.

```callout pitfall A counter in Redis passes the numbers
**A counter in Redis** (`wrong/counter-in-redis`). Redis handles 20k `INCR`s a second easily and p99 passes, which is exactly why it's a good lesson. The problems are structural: every id is a round trip to one shared key, the cache becomes a dependency of every tweet, and if the Redis primary fails before replicating its latest increments, the promoted replica can hand out ids already used. Only the flow test catches it: **An id is made without a round trip to shared storage**.
```

**Asking ZooKeeper on every id** (`wrong/coordinates-every-id`). The generator checks "is worker 37 still mine?" before each id. Correct, but the coordination cluster is now on the hot path: each id waits for a ZooKeeper round trip, and any hiccup (a leader election, a slow disk) stalls tweet creation across the company. Caught by **Each generator claims its worker id once, at startup**; it also fails the p99 limit and the shared-storage test (ZooKeeper is a store).

**One generator** (`wrong/one-generator`). A single process is a single point of failure, and at 20k rps it's saturated anyway. Caught by `survive any node failure`; it also fails p99 and the 99.99% availability target.

**Random UUIDs.** Not a wrong design here (the tests can't see id formats), but a wrong interview answer: 128 bits breaks the 64-bit requirement, and random ids don't sort by time.

## In the interview

```callout interview Test every candidate against the checklist
List the requirements as a short checklist (unique, 64-bit, time-ordered, fast, available) and test each candidate: auto-increment, ticket server, Redis, UUID, then Snowflake. Each fails a box until the last. Draw the bit layout; it's the heart of the answer. Then show how little coordination remains: one write at startup.
```

Follow-up questions:

- **"What if the clock goes backwards?"** Refuse to generate until the clock catches up (or wait if it's a few milliseconds), alert, and run NTP in slew mode.
- **"What if two processes get the same worker id?"** They could produce duplicates. That's why claims are ephemeral nodes in a strongly consistent store, and why a process that loses its session must stop serving.
- **"How many ids per second can one worker make?"** Up to 4,096 per millisecond, about 4 million per second, before it waits for the next millisecond.
- **"When do you run out?"** 41 bits of milliseconds last about 69 years from the custom epoch.
- **"Can clients tell when an id was created?"** Yes: shift right by 22 bits and add the epoch. Fine for tweets; for private objects, a leak.
- **"Could you skip the service and generate ids in the caller?"** Yes, as a library, if each caller process gets a unique worker id; Instagram did it inside the database. A service is easier to version and monitor.

## Further reading

- [twitter-archive/snowflake, the 2010 release](https://github.com/twitter-archive/snowflake/tree/snowflake-2010): the README states the requirements and the 41/10/12 layout; `IdWorker.scala` has the clock-moved-backwards check.
- [Announcing Snowflake](https://blog.x.com/engineering/en_us/a/2010/announcing-snowflake) (Ryan King, Twitter Engineering, 2010): why Twitter needed it and how they chose it.
- [Ticket Servers: Distributed Unique Primary Keys on the Cheap](https://code.flickr.net/2010/02/08/ticket-servers-distributed-unique-primary-keys-on-the-cheap/) (Flickr): the ticket-server design behind this problem's wrong answer, from the people who ran it.
- [Sharding & IDs at Instagram](https://instagram-engineering.com/sharding-ids-at-instagram-1cf5a71e5a5c): the composite-id idea inside PostgreSQL shards, with a comparison of the alternatives.
- *System Design Interview – An Insider's Guide*, Vol. 1 (Alex Xu), chapter "Design A Unique Id Generator In Distributed Systems": the interview-format comparison of these approaches.
- [System Design Primer: Additional system design interview questions](https://github.com/donnemartin/system-design-primer#additional-system-design-interview-questions): lists "Design a random ID generation system" with Snowflake as the reference.
- [awesome-scalability](https://github.com/binhnguyennus/awesome-scalability): the Instagram post and many other write-ups on sharding and ids.
