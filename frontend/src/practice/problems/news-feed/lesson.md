# News Feed: build the feed before anyone asks for it

```tldr
Reads outnumber posts **20 to 1** with a 50 ms budget, so **fan out on write**: put each post into its followers' cached feeds when it is published. **Store it first**, fan out **behind a queue** so the author never waits for the 50 ms graph, and size the feed cache for **100k writes a second** with one node lost.
```

A home timeline looks like a query: "the 50 newest posts by people I follow". Run it on every app open and you join a social graph with a posts table ten thousand times a second. This lesson turns the query inside out: deliver each post into its readers' feeds when it is written.

## What you'll learn

- Fan-out on write versus fan-out on read: what each costs, and how to pick using the read/write ratio.
- Why the fan-out must run behind a queue, and the "store first, then fan out" rule.
- How a 200× multiplier turns a modest write rate into the busiest node in the system.
- How to size a cache for write load and for surviving the loss of a node.
- Where pure fan-out on write breaks (celebrities), and the hybrid that fixes it.

## The problem, explained

**Who uses it.** 20 million daily active users of a social network who publish short posts and read what the people they follow posted.

**Functional requirements.**

- **Publish post**: a user posts up to 500 characters and gets `201` with the post id. The post shows up in all followers' feeds within a few seconds.
- **Read feed**: a user gets the 50 newest posts of the people they follow, `200`.

**Non-functional requirements.**

| Requirement | Target |
|---|---|
| p99 (the latency 99% of requests beat) | Read under 50 ms, publish under 90 ms |
| Availability | Reading 99.9% |
| Durability | A post is never lost after `201`; no feed shows a post that was not stored |
| Decoupling | Publishing never waits for the social graph or the feeds; reading never touches a database or the graph |
| Fault tolerance | Any single machine can fail |
| Budget | At most $4,000 a month, including the social graph |

**What is given, and why.** `given.proschi` declares the `user` and an existing `graph` service (four replicas) that knows who follows whom. A `capacity` line sets its latency to 50 ms per call, because listing up to 5,000 follower ids is slow. That number shapes the whole design.

**What the tests check.**

- *Reading the feed never queries a database*: Read feed calls a cache and never calls a database or the graph.
- *Posts are stored before they reach any feed*: Publish post writes a database before answering, calls the database before any cache, and answers `201`.
- *Fan-out runs behind a queue*: Publish post never waits for the graph or a cache, calls a queue before the graph, and calls a cache after the graph.

## Back-of-the-envelope

```numbers
20 : 1 | read : write requests
100k/s | feed inserts from fan-out (500 × 200)
110k ops/s | on the feed cache
10.5k rps | through the Feed API
≈ 80 GB | all feeds, raw
```

| Quantity | Arithmetic | Result |
|---|---|---|
| Read feed | given | 10k rps |
| Publish post | given | 500 rps |
| Read : write requests | 10k ÷ 500 | 20 : 1 |
| Feed inserts from fan-out | 500 posts/s × 200 followers | 100k writes/s |
| Feed cache operations | 100k inserts + 10k reads | 110k ops/s |
| Feed API requests | 10k reads + 500 publishes | 10.5k rps |
| Graph calls | one per post | 500 rps |
| Feed size per user | 500 ids × 8 bytes | about 4 KB raw |
| All feeds (20M users) | 20M × 4 KB | about 80 GB raw, several times that with Redis overhead |
| Posts per day, upper bound | 500/s × 86,400 s × ~1 KB | about 43 GB/day |

```callout pitfall The ratio flips
Requests are 20:1 reads to writes, but on the feed cache the fan-out makes it 10:1 *writes* to reads. Don't size it as "read-heavy".
```

In Proschi, `x200 ZADD …` counts 200 cache writes per post; its latency is counted once, as if batched or pipelined.

**Sizing the feed cache.** A modelled Redis replica takes 100k operations a second, and caches serve writes on every replica. 110k ops/s on two replicas is 55% busy, fine until `survive any node failure` removes one: 110% on the survivor, saturated.

```callout takeaway
Count replicas for the **degraded** case, not just the healthy one.
```

**Sizing the Feed API.** 10.5k requests a second at 2k per service replica is 5.25 replicas at 100%. Divide by a 70% target and check it with one replica lost.

**Latency.** Read feed is load balancer → API → feed cache → post cache: four short hops, two to a 1 ms cache. Publish post is load balancer → API → posts database → queue, then `201`. Everything after the `201` (the graph's 50 ms, the 200 writes) is asynchronous; put the graph call before it and that hop's tail alone threatens the 90 ms limit.

**Database choice.** 500 inserts a second fits one PostgreSQL primary (5k writes/s). Cassandra suits append-only posts keyed by author and grows without resharding. Either way, the database is off the read path.

**Cost.** Graph $400, service replicas $100, a Redis replica $150, a Kafka broker $200, a Cassandra replica $500, a load balancer $50. A careful design fits; an extra replica on every tier does not.

```quiz
fanout-write-amplification
```

## Concepts

### Fan-out on write versus fan-out on read

| Approach | On publish | On read | Cost |
|---|---|---|---|
| **Fan-out on read (pull)** | Store each post once | Ask the graph who the user follows, fetch their recent posts, merge and sort | Cheap writes; slow, expensive reads that hit the graph and the database on every app open |
| **Fan-out on write (push)** | Look up the followers, insert the post id into each one's precomputed feed | One lookup | Writes amplified by the follower count |

Pick by the read/write ratio, weighted by the cost of each. Here reads are 20 times more frequent, the read budget is 50 ms and follower counts stop at 5,000: push wins. Twitter's timeline service has long been described this way, inserting tweet ids into each follower's Redis-backed timeline.

**When *not* to push:** when some authors have millions of followers: one post becomes millions of writes and takes minutes to land. The fix is a hybrid: push for ordinary accounts, pull for the few huge ones, merge at read time. The "Feeding Frenzy" paper chooses per producer/consumer pair, by how often one posts and the other reads.

````deepdive A push fan-out in Proschi
The same shape on a different example, group announcements:

```proschi
title "Push into inboxes"

author  "Author"       [Actor]
api     "Inbox API"    [REST API] x2
log     "Updates"      [Kafka]    x2
pusher  "Pusher"       [Worker]   x2
members "Member Index" [REST API] x2
inboxes "Inboxes"      [Redis]    x2

author -> api     : HTTPS
api    -> log     : produce
log    -> pusher  : consume
pusher -> members : list
pusher -> inboxes : write

usecase "Announce" {
  author   -> api     : POST /announcements
  api      -> log     : PRODUCE Announced a_1
  log     --> api     : ack
  api     --> author  : 202
  log     ->> pusher  : Announced a_1
  pusher   -> members : GET /groups/9/members
  members --> pusher  : 200 [~50 ids]
  pusher   -> inboxes : x50 LPUSH inbox:{member} a_1
}
```
````

```quiz
celebrity-fanout
```

### Store first, then fan out (through a queue)

Two ordering rules make push safe.

**Store first.** Write the post durably before anything references it: a feed must never point at a missing post. A fan-out that fails halfway is retried from the stored post; a failed store shows the user an error and leaks nothing into feeds.

**Fan out behind a queue.** After the store, put a `PostCreated` event on a durable queue and answer `201`. A fan-out worker consumes it, calls the graph and writes the feeds, so the author's latency no longer depends on follower count or graph speed.

Retries come free: if the worker dies, the event is consumed again, so feed inserts must be *idempotent* (safe to repeat). A sorted-set insert keyed by post id is.

The cost is *eventual consistency*: a follower may open the app a second before the post lands. "Within a few seconds" allows it, and clients usually show the author's own post immediately.

### Caching ids and objects separately

Store feeds as lists of post *ids* (a Redis sorted set per user, scored by time, trimmed to the newest 500) and the posts in a separate cache keyed by id. A read is two cache calls: 50 ids, then those 50 posts in one batched get.

Why split? A post is written once but referenced by 200 feeds. Copying its text into every feed multiplies memory by 200, and an edit or deletion needs 200 updates. Ids are tiny and immutable.

````deepdive Ids, then objects in Proschi
A board of cards works the same way:

```proschi
title "Ids, then objects"

reader "Reader"      [Actor]
api    "Board API"   [REST API] x2
lists  "Board Lists" [Redis]    x2
items  "Card Cache"  [Redis]    x2

reader -> api   : HTTPS
api    -> lists : ZREVRANGE
api    -> items : MGET

usecase "Open board" {
  reader -> api    : GET /boards/3
  api    -> lists  : ZREVRANGE board:3 0 19
  lists --> api    : 20 card ids
  api    -> items  : MGET card:… (20 keys)
  items --> api    : 20 cards
  api   --> reader : 200
}
```
````

Trimming to 500 ids bounds memory per user. Inactive users' feeds can also expire and be rebuilt on their next visit, a common optimisation this problem leaves out.

```quiz
feed-ids-and-objects
```

## Designing it step by step

**1. Scope.** Ask about users (20M DAU), feed contents (followees' posts, newest first, no ranking), followers (average 200, max 5,000: no celebrities), freshness (a few seconds) and latency targets. Park ranking, media and celebrities as follow-ups.

**2. High-level design.** Sketch two flows.

- *Publish*: load balancer → API → posts database (store) → queue (event) → `201`. Then, asynchronously: queue → fan-out worker → graph (followers) → post cache (the post) → feed cache (200 inserts).
- *Read*: load balancer → API → feed cache (50 ids) → post cache (50 posts) → `200`.

Say why not fan-out on read: every read would call a 50 ms graph and merge posts from up to 5,000 accounts out of the database. *Reading the feed never queries a database* rules it out, and so would the 50 ms p99.

**3. Deep dive.**

- *The multiplier.* Write `x200 ZADD feed:{follower} …` so the model counts the real write volume, then check the feed cache's utilisation in the Analysis tab, with and without one replica.
- *The async boundary.* Answer the user *before* the graph call, and use the async arrow (`->>`) from the queue to the worker so the fan-out is off the critical path.
- *Sizing.* Feed API for 10.5k rps at well under 70%; feed cache for 110k ops/s with one replica lost; the queue, post cache, database and worker with at least two replicas each.
- *Budget.* Add it up; if over, find tiers with far more replicas than their load needs.

**4. Wrap-up.** Walk the requirements: reads touch only caches; publish answers after the store and the queue; the fan-out retries from the queue; nothing is single. Then extend: the celebrity hybrid, ranking (score more candidates than you show), rebuilding expired feeds, and deletion (drop the post from the post cache; feeds still listing its id skip it on read).

## Common mistakes

**Fanning out inside the request** (`wrong/fan-out-in-request`). The API stores the post and queues the event, then also calls the graph and writes the 200 feeds before answering. The queue is decoration: the author waits for the 50 ms graph and the fan-out (much longer with 5,000 followers), and the modelled publish p99 climbs past 200 ms. It fails *Fan-out runs behind a queue* and the Publish post p99 limit.

**Two feed cache nodes** (`wrong/two-feed-cache-nodes`). Two Redis replicas handle 110k ops/s at about 55%. Lose one and the survivor needs 110%: feeds stop updating, or the cache falls over and takes reads with it. It fails `survive any node failure`.

**Other classic mistakes.**

- *Fan-out on read with a database query per read.* Fails *Reading the feed never queries a database* and, at 10k rps with a 50 ms graph, the read p99.
- *Writing feeds before storing the post.* A failure after the fan-out leaves feeds pointing at a post that was never stored. Fails *Posts are stored before they reach any feed*.
- *Forgetting the `x200`.* The model sees 500 cache writes a second instead of 100k, and a cache that would melt looks idle. Estimation is part of the answer.
- *Storing full posts in every feed.* Memory and update cost multiplied by the follower count.
- *Ignoring celebrities without saying so.* The problem excludes them, but an interviewer will ask: mention the hybrid first.

## In the interview

Start from the ratio: "Reads outnumber writes 20 to 1 and the read budget is 50 ms, so do the work at write time." Then draw the two flows and mark the async boundary.

```callout interview Do the multiplication out loud
Write 500 × 200 = 100k on the whiteboard: the rest of the design depends on that number.
```

Likely follow-ups:

- *What about a user with 10 million followers?* Don't fan out their posts. At read time, merge the precomputed feed with recent posts of the few huge accounts the user follows, from a per-author cache.
- *How do you handle deletes?* Delete from the posts store and post cache; feeds still holding the id skip it when the lookup comes back empty. Optionally fan out a removal.
- *A follower unfollows. Do you clean their feed?* Lazily: filter at read time or let old entries age out of the 500-item window.
- *What if the fan-out worker falls behind?* The queue holds the backlog; add workers; monitor consumer lag. Freshness degrades, correctness does not.
- *How do you rebuild a feed for a user who was inactive for months?* On first read, pull once: ask the graph for followees and merge their recent posts, then keep pushing.
- *How do you rank instead of sorting by time?* Fetch a few hundred candidate ids, score them with a ranking service, return the top 50.

## Further reading

- [Design the Twitter timeline and search](https://github.com/donnemartin/system-design-primer/blob/master/solutions/system_design/twitter/README.md), System Design Primer: a full worked solution with a fan-out service, memory-cache timelines and the highly-followed-user problem.
- [Timelines at Scale](https://www.infoq.com/presentations/Twitter-Timeline-Scalability), Raffi Krikorian, QCon San Francisco 2012 (InfoQ): how Twitter fanned tweets out into Redis timelines.
- [Feeding Frenzy: Selectively Materializing Users' Event Feeds](https://sns.cs.princeton.edu/assets/papers/2010-sigmod-silberstein.pdf), Silberstein et al., SIGMOD 2010: when to push and when to pull, per producer and consumer.
- [System Design Primer: Asynchronism](https://github.com/donnemartin/system-design-primer#asynchronism): uses posting a tweet as its example of work done in the background.
- [awesome-scalability](https://github.com/binhnguyennus/awesome-scalability): its Architecture section links Pinterest's write-up on its following feed and other feed case studies.
- *System Design Interview – An Insider's Guide, Volume 1* (Alex Xu), chapter "Design a News Feed System".
