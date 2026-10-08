# Social Graph Cache: a million reads a second over MySQL

```tldr
**1M reads a second** at a 96.4% hit rate still send **36k a second to MySQL**. **Followers** face the web tier, **one leader per shard** is the only path to MySQL, writes go through the leader, which **invalidates the other followers asynchronously**, and the **degraded shard** sets the shard count.
```

## What you'll learn

- Why a read-heavy system with a 96% cache hit rate still needs careful miss handling.
- How a two-tier cache (followers and a leader per shard) protects the database and keeps caches consistent with it.
- The difference between look-aside caching and a cache that owns the path to the database (read-through and write-through).
- How asynchronous invalidation gives the writer read-your-writes while other readers converge moments later.

## The problem, explained

Facebook's social graph is made of **objects** (people, posts, check-ins) and **associations**, typed edges between them (Alice *likes* post 7, Bob is *friends with* Alice). Every page view reads dozens of them; writes are rare in comparison.

```deepdive Before TAO: memcache as a look-aside cache
For years the web servers read MySQL directly and used memcache as a **look-aside cache**: each web server checked memcache, read MySQL on a miss, filled the cache, and deleted keys after writes. TAO replaced that with a graph-aware cache service that owns the path to the database.
```

TAO has two cache tiers. **Followers** take every request from the web tier and can be added freely. Each shard has one **leader**, the only server that reads or writes that shard in MySQL. Follower misses and all writes go to the leader, which tells the other followers asynchronously after a write commits.

Two use cases for one region's slice:

- **Read**: a web server reads an object or association list. Scenarios: `"Follower hit"`, answered by the follower, and `"Follower miss"`, where the follower asks the leader, which reads MySQL.
- **Write**: a web server adds an association, through a follower to the leader, which commits to MySQL before answering; the other followers are updated after the commit, without the writer waiting.

Requirements: 1M reads and 2k writes per second; p99 (the latency 99% of requests beat) under 25 ms for reads and 60 ms for writes; reads available 99.99% of the time; durable writes; surviving the loss of any single machine, a MySQL replica included; at most $6,000 a month, MySQL included.

**What is given.** The `web` tier (the client) and `db`, the MySQL fleet: a primary and a replica per shard, sharded by object ID. You set the shard count with `capacity { db shards N }` and add both cache tiers.

**What the tests check**: reads hit followers before leaders and leaders before MySQL; a follower hit touches neither; the web tier has no path to leaders or MySQL; writes go followers → leaders → MySQL and write MySQL before responding; followers have no path to MySQL; and after the commit, the leaders call the followers.

## Back-of-the-envelope

```numbers
1M rps | reads
500 : 1 | reads per write
96.4% | cache hit rate
36k rps | misses that reach MySQL
20k rps | one MySQL replica's reads
10 | followers at 100% busy
```

TAO's published workload is 99.8% reads and 0.2% writes, with an overall cache hit rate of 96.4%. This slice keeps those ratios.

| Quantity | Arithmetic | Result |
|---|---|---|
| Reads | given | 1M rps |
| Writes | given | 2k rps |
| Read:write ratio | 1M : 2k | 500 : 1 |
| Follower misses (to leaders, then MySQL) | 1M × 3.6% | 36k rps |
| MySQL reads per shard (primary + replica) | 36k ÷ shards | depends on N |
| One MySQL replica's read capacity | simulation default | 20k rps |
| Follower load | 1M reads + 2k writes + invalidations | just over 1M ops/s |
| One cache replica's capacity | simulation default | 100k ops/s |
| Followers at 100% | 1M ÷ 100k | 10 |

**The database sees only the misses.** Of a million reads, 36k reach MySQL: still nearly twice what one MySQL replica takes (20k), hence the sharding. Writes, at 2k, are easy for any number of primaries (5k each).

**Shards from the failure rule.** Spread 36k reads over N shards of two replicas each. With every replica up, each shard's utilisation is `36k ÷ (N × 40k)`. But `survive any node failure` removes one replica from one shard, and keys cannot move to another shard, so that shard carries `36k ÷ N` on a single 20k replica.

```callout takeaway The degraded shard decides
Two shards put 18k on one replica, 90% busy: the read p99 breaks. Pick the smallest N that keeps the degraded shard comfortably below that.
```

**Followers.** Ten replicas would run at 100%; for well under 70% you need noticeably more: `load ÷ (100k × target)`. Count the invalidations each write sends to other followers.

**Leaders.** They see only misses and writes, 38k ops a second, so two cache replicas are plenty. Their job is not throughput but being the single gate to each shard.

**Latency.** A follower hit is one cache hop (1 ms base). A miss is follower + leader + MySQL, about 7 ms of base latency, with p99 a few times that. The read p99 mixes 96.4% hits with 3.6% misses, so it lands well under 25 ms if nothing queues; a saturated MySQL shard is the one thing that breaks it.

**Cost.** Cache replicas cost $150, MySQL replicas $400. MySQL is `N × 2 × $400`; followers and leaders the rest. Within $6,000 the follower tier and the shard count compete for budget, so over-provision neither.

## Concepts

### Look-aside caching and its problems at scale

In a **look-aside** (cache-aside) design the application talks to both the cache and the database. Read: check the cache; on a miss, read the database and fill the cache. Write: update the database, then delete the cache key. It is simple, works with any database, and is where most applications should start.

At Facebook's scale three problems appear:

- **Stale sets.** A reader misses, reads the old value and is delayed. Meanwhile a writer updates the database and deletes the key. Then the delayed reader fills the cache with the old value, wrong until the entry expires.
- **Thundering herds.** When a hot key is deleted, thousands of web servers miss at once and all hit the database.
- **Every web server talks to the database.** Each needs connections and knowledge of the schema, and every cache server's miss is a database query.

Facebook's memcache paper describes mitigations (leases, for instance). TAO's answer was structural: take the database away from the clients entirely.

```quiz
delete-on-write
stale-set-race
```

### Read-through and write-through, with a leader per shard

In a **read-through** cache, clients ask only the cache, which loads misses from the database itself. In a **write-through** cache, writes go through the cache, which writes the database and updates itself. Either way, the cache owns the database path.

TAO adds a twist: two tiers, and exactly **one leader per shard**. One process mediates all reads and writes for a shard, so it can serialise them: a miss and a concurrent write for the same key are seen in order by the same server, and stale sets are avoided. Concurrent misses for one key from many followers arrive at one leader, which can answer them all from one database read.

The trade-off is a hop: a miss crosses follower and leader before the database. The leader tier is also a potential bottleneck and single point of failure per shard, so leaders need replicas and failover. Skip this design for small systems or write-heavy workloads: with a low hit rate, a leader per shard that serialises writes adds latency for little gain.

```quiz
cache-stampede
```

````deepdive Read-through tiers in Proschi
```proschi
title "Read-through tiers"

app    "App"          [Actor]
edge   "Front Cache"  [Cache] x4
owner  "Owner Cache"  [Cache] x2
store  "Database"     [MySQL] x2

app   -> edge  : get
edge  -> owner : miss
owner -> store : SQL

usecase "Get" {
  app -> edge : GET key
  alt "Hit" {
    edge --> app : value
  } alt "Miss" {
    edge   -> owner : GET key
    owner  -> store : SELECT value
    store --> owner : row
    owner --> edge  : value
    edge  --> app   : value
  }
}
```
````

### Invalidation and read-your-writes

After a write, every follower that cached the old value is stale. Two ways to fix that:

| | How | Cost |
|---|---|---|
| **Synchronously** | The leader updates every follower before answering | Every write waits for the slowest follower; one unreachable follower fails or stalls writes |
| **Asynchronously** | The leader answers first, then sends invalidations (or refills) to the other followers | Writes stay fast; other readers may see the old value for a short window: **eventual consistency**, which a "like" count tolerates well |

TAO adds one guarantee on top: the follower that forwarded the write updates its own cache from the leader's reply on the way back. A user's requests usually go to the same follower, so the writer **reads their own write** immediately, while others converge later.

In Proschi the async part is a `->>` step after the response, often with a fan-out such as `x4` standing for the other followers. The writer's latency does not include it.

```proschi
title "Async invalidation"

app   "App"     [Actor]
cache "Caches"  [Cache] x4
lead  "Leader"  [Cache] x2
db    "DB"      [MySQL] x2

app   -> cache : write
cache -> lead  : forward
lead  -> db    : SQL
lead  -> cache : invalidate

usecase "Write" {
  app    -> cache : SET key
  cache  -> lead  : SET key
  lead   -> db    : UPDATE row
  db    --> lead  : ok
  lead  --> cache : ok
  cache --> app   : ok
  lead  ->> cache : x3 INVALIDATE key
}
```

## Designing it step by step

### 1. Scope the problem

Clarify: the read:write ratio? (500:1.) The cache hit rate? (96.4%.) How fresh must reads be? (The writer must see their own write; others may lag briefly.) Is MySQL the source of truth? (Yes, sharded by object ID.) What may talk to it? (Only the cache layer.) The answer to the last question is the design.

### 2. High-level design

Start from the starter's single cache tier, web → cache → MySQL, and explain why it falls short at this scale: every cache server reads and writes MySQL, so concurrent misses and writes race to fill and invalidate the same keys, and the database sees every cache server's misses.

Then split the tier. Followers face the web tier; leaders face MySQL, one per shard. Reads: web → follower; on a miss, follower → leader → MySQL. Writes: web → follower → leader → MySQL, then back the same way, then an async notification from the leader to the other followers.

### 3. Deep dive

**Shard count.** Use the failure rule from the estimates: the degraded shard (one replica lost) decides, not the steady state. Check in the analysis that after a failure no MySQL shard saturates or pushes the read p99 over 25 ms.

**Follower count.** Size for a million reads plus invalidations, below 70%. The follower is on every request's path, so its queueing shows in both scenarios' p99.

**Leaders.** Two replicas, for failure rather than load.

**The write path.** Write MySQL before responding (durability), update the leader's and forwarding follower's caches on the way back, then send `->>` invalidations to the other followers. The flow test "The leader updates the other followers after the commit" wants the leader to call followers after MySQL.

**Budget.** If it is tight, trade follower headroom against shards; the failure rule sets the floor for shards.

### 4. Wrap-up

Summarise: followers absorb the reads, a leader per shard is the only path to MySQL, writes go through the cache and invalidate other followers asynchronously, the degraded case sets the shard count. Next steps: multiple regions (TAO keeps a leader region per shard and forwards writes to it), handling hot objects (a celebrity's post) by replicating them across followers, and versioning cached values so out-of-order invalidations cannot resurrect old data.

## Common mistakes

**One cache tier** (`wrong/one-cache-tier.proschi`). The memcache-era design: every cache server reads and writes MySQL directly. In production: stale sets after races, thundering herds on hot keys, and a database serving every cache server's misses. It fails all three flow tests: no leaders to read through, followers connected to MySQL, and no leader to send invalidations.

**Followers write MySQL** (`wrong/followers-write-mysql.proschi`). Leaders exist, but followers write MySQL themselves and tell the leader afterwards: two tiers update the same rows and keys, and the leader's ordering guarantee is gone. It fails "Only the leader tier talks to MySQL".

**No invalidation** (`wrong/no-invalidation.proschi`). Writes update the writer's follower and nothing else. The writer sees their change, but every other follower serves the old list until it expires: on a social graph, a friend's comment invisible for minutes. It fails "The leader updates the other followers after the commit".

**Too few shards** (`wrong/too-few-shards.proschi`). With two shards everything passes while all replicas are up. Remove one MySQL replica and its shard carries 18k reads on one 20k replica, 90% busy, and the read p99 more than doubles past its 25 ms limit. It fails `survive any node failure`.

```callout pitfall
This is the cluster that runs fine for months in production and falls over during the first routine host replacement.
```

**Synchronous invalidation.** Waiting for every follower before answering ties the write p99 to the slowest follower anywhere. Use `->>` after the response.

## In the interview

```callout interview Open with the ratio and what it implies
"Reads are 500 times writes and 96% hit the cache, so the design is about the cache. The database sees only misses, but at a million reads that is still 36k a second. I want exactly one component per shard to talk to MySQL, so caches cannot race each other."
```

Then draw the two tiers and walk one read miss and one write.

Expected follow-ups:

- **Why two tiers instead of a bigger single tier?** Followers scale reads independently; leaders bound database connections and serialise each shard's updates. One tier gives one or the other.
- **What happens when a leader fails?** Followers keep serving hits; the shard's misses and writes are rerouted (to another leader replica, or around the leader) until it recovers. The TAO paper covers leader, follower and database failures.
- **How do you handle a hot object?** It lands on one shard's leader and every follower. Followers absorb its reads; in extreme cases, cache it in the web tier or replicate it to extra followers.
- **Can invalidations arrive out of order?** Yes. Attach a version to each cached value and ignore updates older than what the follower holds.
- **Why keep MySQL at all?** It is durable, well understood, and good at the point lookups and range scans the graph API issues; the cache handles the read rate.

```quiz
hot-key-replicas
```

## Further reading

- [TAO: Facebook's Distributed Data Store for the Social Graph](https://www.usenix.org/conference/atc13/technical-sessions/presentation/bronson), USENIX ATC 2013 ([paper](https://www.usenix.org/system/files/conference/atc13/atc13-bronson.pdf)): the primary source for followers, leaders, asynchronous invalidation and the 96.4% hit rate.
- [TAOBench: An End-to-End Benchmark for Social Network Workloads](https://www.vldb.org/pvldb/vol15/p1965-cheng.pdf), VLDB 2022: TAO's real request mix, including the 99.8% reads.
- [Scaling Memcache at Facebook](https://www.usenix.org/conference/nsdi13/technical-sessions/presentation/nishtala), NSDI 2013: the look-aside design TAO replaced, with leases against stale sets and thundering herds.
- [System Design Primer: Cache-aside](https://github.com/donnemartin/system-design-primer#cache-aside) and [Write-through](https://github.com/donnemartin/system-design-primer#write-through): the two caching strategies this problem contrasts.
- [System Design Primer: Company architectures](https://github.com/donnemartin/system-design-primer#company-architectures): links the TAO and memcache papers among other real-world designs.
- [awesome-scalability](https://github.com/binhnguyennus/awesome-scalability): its "NoSQL Databases" list includes TAO, next to other large-scale stores.
- *System Design Interview – An Insider's Guide*, Vol. 1 (Alex Xu): "Scale From Zero To Millions Of Users" for cache tiers and database sharding, and "Design A News Feed System" for a read-heavy social workload.
