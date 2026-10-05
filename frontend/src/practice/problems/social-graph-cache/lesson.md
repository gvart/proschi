# Social Graph Cache: a million reads a second over MySQL

## What you'll learn

- Why a read-heavy system with a 96% cache hit rate still needs its misses designed carefully.
- How a two-tier cache (followers and a leader per shard) protects the database and keeps caches consistent with it.
- The difference between look-aside caching and a cache that owns the path to the database (read-through and write-through).
- How asynchronous invalidation gives the writer read-your-writes while other readers converge moments later.

## The problem, explained

Facebook's social graph is made of **objects** (people, posts, check-ins) and **associations**, typed edges between them (Alice *likes* post 7, Bob is *friends with* Alice). Every page view reads dozens of them; writes are rare in comparison. For years the web servers read MySQL directly and used memcache as a **look-aside cache**: each web server checked memcache, read MySQL on a miss, filled the cache, and deleted keys after writes. TAO replaced that with a graph-aware cache service that owns the path to the database.

TAO has two cache tiers. **Followers** take every request from the web tier and can be added freely. Each shard of the data has one **leader**, the only server that reads or writes that shard in MySQL. A follower's miss and every write go to the leader; after a write commits, the leader tells the other followers asynchronously.

Two use cases for one region's slice:

- **Read**: a web server reads an object or association list. Scenarios: `"Follower hit"`, answered by the follower, and `"Follower miss"`, where the follower asks the leader, which reads MySQL.
- **Write**: a web server adds an association. It goes through a follower to the leader, which commits to MySQL before answering; the other followers are updated after the commit, without the writer waiting.

Requirements: 1M reads and 2k writes per second; p99 under 25 ms for reads and 60 ms for writes; reads available 99.99%; durable writes; survival of any single machine, a MySQL replica included; $6,000 a month, MySQL included.

**What is given.** The `web` tier (the client) and `db`, the MySQL fleet: a primary and a replica per shard, sharded by object ID. You choose the shard count with `capacity { db shards N }` and add both cache tiers.

**What the tests check**: reads hit followers before leaders and leaders before MySQL; a follower hit touches neither; the web tier has no path to leaders or MySQL; writes go followers → leaders → MySQL and write MySQL before responding; followers have no path to MySQL; and after the commit, the leaders call the followers.

## Back-of-the-envelope

TAO's published workload is 99.8% reads and 0.2% writes, and its overall cache hit rate is 96.4%. This slice keeps those ratios.

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

**The database sees only the misses.** Of a million reads, 36k reach MySQL. That is still nearly twice what one MySQL replica takes (20k), which is why the data is sharded. Writes, at 2k, are easy for any number of primaries (5k each).

**Shards from the failure rule.** Spread 36k reads over N shards of two replicas each. With every replica up, each shard's utilisation is `36k ÷ (N × 40k)`. But `survive any node failure` removes one replica from one shard, and keys cannot move to another shard, so that shard must carry `36k ÷ N` on a single 20k replica. Two shards put 18k on one replica, 90% busy: the read p99 breaks. Pick the smallest N that keeps the degraded shard comfortably below that.

**Followers.** Ten replicas would run at 100%. You want well under 70%, so you need noticeably more; compute `load ÷ (100k × target)`. Remember to count the invalidations each write sends to other followers.

**Leaders.** They see only misses and writes, 38k ops a second, so two cache replicas are plenty. Their job is not throughput; it is being the single gate to each shard.

**Latency.** A follower hit is one cache hop (1 ms base). A miss is follower + leader + MySQL, about 7 ms of base latency, with p99 a few times that. The read p99 mixes 96.4% hits with 3.6% misses, so it lands well under 25 ms if nothing queues. A saturated MySQL shard is the one thing that breaks it.

**Cost.** Cache replicas cost $150, MySQL replicas $400. MySQL is `N × 2 × $400`; followers and leaders the rest. Within $6,000, the follower tier and the shard count compete for budget, so do not over-provision either.

## Concepts

### Look-aside caching and its problems at scale

In a **look-aside** (cache-aside) design the application talks to both the cache and the database. Read: check the cache; on a miss, read the database and fill the cache. Write: update the database, then delete the cache key. It is simple, works with any database, and is what most applications should start with.

At Facebook's scale three problems appear:

- **Stale sets.** A reader misses, reads the old value from the database, gets delayed; meanwhile a writer updates the database and deletes the key; then the delayed reader fills the cache with the old value. The cache is now wrong until it expires.
- **Thundering herds.** When a hot key is deleted, thousands of web servers miss at once and all hit the database.
- **Every web server talks to the database.** Each one needs connections and knowledge of the schema, and every cache server's miss is a database query.

Facebook's memcache paper describes mitigations (leases, for instance). TAO's answer was structural: take the database away from the clients entirely.

### Read-through and write-through, with a leader per shard

In a **read-through** cache, clients ask only the cache, and the cache loads misses from the database itself. In a **write-through** cache, writes go through the cache, which writes the database and updates itself. The cache owns the database path.

TAO adds a twist: two tiers, and exactly **one leader per shard**. Because one process mediates all reads and writes for a shard, it can serialise them: a miss and a concurrent write for the same key are seen in order by the same server, so stale sets are avoided. Concurrent misses for the same key from many followers arrive at one leader, which can answer them all from one database read.

The trade-off is a hop: a miss now crosses follower and leader before the database. The leader tier is also a potential bottleneck and single point of failure per shard, so leaders need replicas and failover. Do not use this design for small systems or write-heavy workloads; a leader per shard serialising writes adds latency for little gain when the cache hit rate is low.

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

### Invalidation and read-your-writes

After a write, every follower that cached the old value is stale. There are two ways to fix that:

- **Synchronously**: the leader updates every follower before answering. Every write waits for the slowest follower, and a single unreachable follower fails or stalls writes.
- **Asynchronously**: the leader answers first, then sends invalidations (or refills) to the other followers. Writes stay fast; other readers may see the old value for a short window. That is **eventual consistency**, which a "like" count tolerates well.

TAO adds one guarantee on top: the follower that forwarded the write updates its own cache from the leader's reply on the way back. Since a user's requests usually go to the same follower, the writer **reads their own write** immediately, even though others converge later.

In Proschi the async part is a `->>` step after the response, often with a fan-out such as `x4` to stand for the other followers. The writer's latency does not include it.

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

Clarify: what is the read:write ratio? (500:1.) What hit rate can the cache reach? (96.4%.) How fresh must reads be? (The writer must see their own write; others may lag briefly.) Is MySQL the source of truth? (Yes, sharded by object ID.) What may talk to it? (Only the cache layer.) The answer to the last question is the design.

### 2. High-level design

Start from the starter's single cache tier: web → cache → MySQL. Explain why it falls short at this scale: every cache server reads and writes MySQL, so concurrent misses and writes race to fill and invalidate the same keys, and the database sees every cache server's misses.

Then split the tier. Followers face the web tier; leaders face MySQL, one per shard. Reads: web → follower; on a miss, follower → leader → MySQL. Writes: web → follower → leader → MySQL, then back the same way, then an async notification from the leader to the other followers.

### 3. Deep dive

**Shard count.** Use the failure rule from the estimates. The steady state is easy; the degraded shard (one replica lost) is what decides. Check it in the analysis: after a failure, no MySQL shard may saturate or push the read p99 over 25 ms.

**Follower count.** Size for a million reads plus invalidations, below 70%. The follower is on the path of every request, so its queueing shows in the p99 of both scenarios.

**Leaders.** Two replicas, for failure rather than load.

**The write path.** Write MySQL before responding (the durability requirement), update the leader's and forwarding follower's caches on the way back, then send `->>` invalidations to the other followers. Check the flow test "The leader updates the other followers after the commit": the leader must call followers after MySQL.

**Budget.** Sum it up. If it is tight, the trade is between follower headroom and shards; the failure rule sets the floor for shards.

### 4. Wrap-up

Summarise: followers absorb the reads, a leader per shard is the only path to MySQL, writes go through the cache and invalidate other followers asynchronously, and the shard count comes from the degraded case. Next steps: multiple regions (TAO keeps a leader region per shard and forwards writes to it), handling hot objects (a celebrity's post) by replicating them across followers, and versioning cached values so out-of-order invalidations cannot resurrect old data.

## Common mistakes

**One cache tier** (`wrong/one-cache-tier.proschi`). The memcache-era design: every cache server reads and writes MySQL directly. In production that means stale sets after races, thundering herds on hot keys, and a database that serves every cache server's misses. It fails all three flow tests: no leaders to read through, followers connected to MySQL, and no leader to send invalidations.

**Followers write MySQL** (`wrong/followers-write-mysql.proschi`). Leaders exist, but followers write MySQL themselves and tell the leader afterwards. Two tiers now update the same rows and keys, and the leader's ordering guarantee is gone. It fails "Only the leader tier talks to MySQL".

**No invalidation** (`wrong/no-invalidation.proschi`). Writes update the writer's follower and nothing else. The writer sees their change, but every other follower serves the old list until it happens to expire, which on a social graph can mean a friend's comment invisible for minutes. It fails "The leader updates the other followers after the commit".

**Too few shards** (`wrong/too-few-shards.proschi`). With two shards everything passes while all replicas are up. Remove one MySQL replica and its shard carries 18k reads on one 20k replica, 90% busy, and the read p99 more than doubles past its 25 ms limit. It fails `survive any node failure`. In production, this is the cluster that runs fine for months and falls over during the first routine host replacement.

**Synchronous invalidation.** Waiting for every follower before answering a write makes the write p99 depend on the slowest follower anywhere. Use `->>` after the response.

## In the interview

Open with the ratio and what it implies: "Reads are 500 times writes and 96% hit the cache, so the design is about the cache. The database sees only misses, but at a million reads that is still 36k a second. I want exactly one component per shard to talk to MySQL, so caches cannot race each other." Then draw the two tiers and walk one read miss and one write.

Expected follow-ups:

- **Why two tiers instead of a bigger single tier?** Followers scale reads independently; leaders bound database connections and serialise each shard's updates. One tier gives you one or the other.
- **What happens when a leader fails?** Followers keep serving hits; the shard's misses and writes must be rerouted (to another leader replica, or around the leader) until it recovers. The TAO paper describes how it handles leader, follower and database failures.
- **How do you handle a hot object?** It lands on one shard's leader and every follower. Followers absorb its reads; for extreme cases, cache it in the web tier or replicate it to extra followers.
- **Can invalidations arrive out of order?** Yes. Attach a version to each cached value and ignore updates older than what the follower holds.
- **Why keep MySQL at all?** It is durable, well understood, and good at the simple point lookups and range scans that the graph API issues; the cache takes care of the read rate.

## Further reading

- [TAO: Facebook's Distributed Data Store for the Social Graph](https://www.usenix.org/conference/atc13/technical-sessions/presentation/bronson), USENIX ATC 2013 ([paper](https://www.usenix.org/system/files/conference/atc13/atc13-bronson.pdf)): the primary source for followers, leaders, asynchronous invalidation and the 96.4% hit rate.
- [TAOBench: An End-to-End Benchmark for Social Network Workloads](https://www.vldb.org/pvldb/vol15/p1965-cheng.pdf), VLDB 2022: TAO's real request mix, including the 99.8% reads.
- [Scaling Memcache at Facebook](https://www.usenix.org/conference/nsdi13/technical-sessions/presentation/nishtala), NSDI 2013: the look-aside design TAO replaced, with leases against stale sets and thundering herds.
- [System Design Primer: Cache-aside](https://github.com/donnemartin/system-design-primer#cache-aside) and [Write-through](https://github.com/donnemartin/system-design-primer#write-through): the two caching strategies this problem contrasts.
- [System Design Primer: Company architectures](https://github.com/donnemartin/system-design-primer#company-architectures): links the TAO and memcache papers among other real-world designs.
- [awesome-scalability](https://github.com/binhnguyennus/awesome-scalability): its "NoSQL Databases" list includes TAO, next to other large-scale stores.
- *System Design Interview – An Insider's Guide*, Vol. 1 (Alex Xu): "Scale From Zero To Millions Of Users" for cache tiers and database sharding, and "Design A News Feed System" for a read-heavy social workload.
