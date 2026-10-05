# News Feed: build the feed before anyone asks for it

A home timeline looks like a query: "the 50 newest posts by people I follow, sorted by time". Run that query on every app open, for millions of users, and you have built a machine that joins a social graph with a posts table ten thousand times a second. This lesson turns the query inside out. Instead of assembling a feed when it is read, you deliver each post into its readers' feeds when it is written, through a queue, into a cache.

## What you'll learn

- Fan-out on write versus fan-out on read: what each costs, and how to pick using the read/write ratio.
- Why the fan-out must run behind a queue, and the "store first, then fan out" rule.
- How a 200× multiplier turns a modest write rate into the busiest node in the system.
- How to size a cache for write load and for surviving the loss of a node.
- Where pure fan-out on write breaks (celebrities), and the hybrid that fixes it.

## The problem, explained

**Who uses it.** 20 million daily active users of a social network. They publish short posts and open the app to see what the people they follow posted.

**Functional requirements.**

- **Publish post**: a user posts up to 500 characters and gets `201` with the post id. The post shows up in all followers' feeds within a few seconds.
- **Read feed**: a user gets the 50 newest posts of the people they follow, `200`.

**Non-functional requirements.** p99 under 50 ms for reading and under 90 ms for publishing. Reading available 99.9%. A post is never lost after `201`, and no feed shows a post that was not stored. Publishing never waits for the social graph or the feeds. Reading never touches a database or the social graph. Any single machine can fail. At most $4,000 a month, including the social graph.

**What is given, and why.** `given.proschi` declares the `user` and an existing `graph` service (four replicas) that knows who follows whom. Its capacity is overridden to 50 ms per call, because listing up to 5,000 follower ids is slow. That number is the reason the design looks the way it does.

**What the tests check.**

- *Reading the feed never queries a database*: Read feed calls a cache and never calls a database or the graph.
- *Posts are stored before they reach any feed*: Publish post writes a database before answering, calls the database before any cache, and answers `201`.
- *Fan-out runs behind a queue*: Publish post never waits for the graph or a cache, calls a queue before the graph, and calls a cache after the graph.

## Back-of-the-envelope

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

**The ratio flips.** Requests are 20:1 reads to writes, but on the feed cache the fan-out makes it 10:1 *writes* to reads. Whoever sizes the cache by "it's read-heavy" will be surprised. In Proschi, writing the feed step as `x200 ZADD …` tells the model to count 200 cache writes per post; its latency is counted once, as if the writes were batched or pipelined.

**Sizing the feed cache.** A Redis replica in the model takes 100k operations a second, and caches serve writes on every replica. So 110k ops/s on two replicas is 55% busy, which looks fine, until `survive any node failure` re-runs the analysis with one replica fewer: 110k on one replica is 110%, saturated. Count replicas for the *degraded* case, not just the healthy one.

**Sizing the Feed API.** 10.5k requests a second at 2k per service replica is 5.25 replicas at 100%. Divide by a 70% target and check it with one replica lost.

**Latency.** Read feed is load balancer → API → feed cache → post cache: four short hops, a 1 ms cache twice. Publish post is load balancer → API → posts database → queue, then `201`. Everything after the `201` (the graph's 50 ms, the 200 writes) is asynchronous and does not count toward publish latency. If you put the graph call before the `201`, the 50 ms hop with its tail alone threatens the 90 ms limit.

**Database choice.** 500 inserts a second fits on one PostgreSQL primary (5k writes/s), so this is not forced. A partitioned store like Cassandra is a natural fit for append-only posts keyed by author, and grows without a resharding project. Either way, the database is off the read path.

**Cost.** Graph $400, service replicas $100, a Redis replica $150, a Kafka broker $200, a Cassandra replica $500, a load balancer $50. The budget fits a careful design, and punishes an extra replica on every tier.

## Concepts

### Fan-out on write versus fan-out on read

There are two ways to produce a timeline:

- **Fan-out on read (pull).** Store each post once. On read, ask the graph who the user follows, fetch recent posts for each, merge and sort. Writes are cheap; reads are expensive and slow, and they hit the graph and the database on every app open.
- **Fan-out on write (push).** On publish, look up the author's followers and insert the post id into each follower's precomputed feed. Reads become one lookup. Writes are amplified by the follower count.

Pick by the ratio of reads to writes, weighted by the cost of each. Here reads are 20 times more frequent, the read latency budget is tight (50 ms), and follower counts are bounded at 5,000, so push wins clearly. Twitter's timeline service has long been described this way: a fan-out step inserts tweet ids into Redis-backed timelines of each follower.

When *not* to push: when some authors have millions of followers. One post becomes millions of writes and takes minutes to land. The fix is a hybrid: push for ordinary accounts, pull for the few huge ones, and merge the two at read time. The "Feeding Frenzy" paper formalises this choice per producer/consumer pair, based on how often one posts and the other reads.

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

### Store first, then fan out (through a queue)

Two ordering rules make push safe.

**Store first.** Write the post to durable storage before anything else references it. A feed must never point at a post that does not exist. If the fan-out fails halfway, it can be retried from the stored post; if the store failed, the user saw an error and nothing leaked into feeds.

**Fan out behind a queue.** After the post is stored, put a `PostCreated` event on a durable queue and answer `201`. A fan-out worker consumes the event, calls the graph, and writes the feeds. This keeps the author's latency independent of follower count and graph speed, and gives you retries for free: if the worker dies, the event is consumed again. Since that can happen, feed inserts should be idempotent; a sorted-set insert keyed by post id is, because adding the same member twice changes nothing.

The trade-off is *eventual consistency*: a follower may open the app a second before the post lands in their feed. The requirement ("within a few seconds") explicitly allows it. The author's own feed is a different story; clients usually show their own post immediately.

### Caching ids and objects separately

Store feeds as lists of post *ids* (a Redis sorted set per user, scored by time, trimmed to the newest 500), and store the posts themselves in a separate cache keyed by id. A read is then two cache calls: fetch 50 ids, then fetch those 50 posts in one batched get.

Why split them? A post is written once into the post cache but referenced by 200 feeds; copying the full text into every feed would multiply memory by 200, and an edit or deletion would need 200 updates. Ids are tiny and immutable.

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

Trimming matters too: a feed only needs its newest 500 ids, so memory per user is bounded no matter how long they have been following people. Inactive users' feeds can expire and be rebuilt on their next visit, a common optimisation that this problem leaves out.

## Designing it step by step

**1. Scope.** Ask: how many users and how active (20M DAU), what the feed contains (posts by followees, newest first, no ranking), follower distribution (average 200, max 5,000: no celebrities), freshness (a few seconds), and the latency targets. Explicitly park ranking, media and celebrities as follow-ups.

**2. High-level design.** Sketch two flows.

- *Publish*: load balancer → API → posts database (store) → queue (event) → `201`. Then, asynchronously: queue → fan-out worker → graph (followers) → post cache (the post) → feed cache (200 inserts).
- *Read*: load balancer → API → feed cache (50 ids) → post cache (50 posts) → `200`.

Say why not fan-out on read: every read would call a 50 ms graph and merge posts from up to 5,000 accounts out of the database; the test *Reading the feed never queries a database* rules it out, and so would the 50 ms p99.

**3. Deep dive.**

- *The multiplier.* Write the feed insert as `x200 ZADD feed:{follower} …` so the model counts the real write volume. Then look at the feed cache's utilisation in the Analysis tab, and again imagining one replica gone.
- *The async boundary.* Put the response to the user *before* the graph call. Use the async arrow (`->>`) for the queue handing the event to the worker, so the fan-out is not on the critical path.
- *Sizing.* Feed API for 10.5k rps at well under 70%; feed cache for 110k ops/s with one replica lost; the queue, post cache, database and worker with at least two replicas each.
- *Budget.* Add it up. If you are over, look for tiers with far more replicas than their load needs.

**4. Wrap-up.** Walk the requirements: reads touch only caches; publish answers after the store and the queue; the fan-out retries from the queue; nothing is single. Then extend: the hybrid for celebrities, ranking (fetch more candidates than you show, score them), feed rebuild for users whose feed expired, and deletion (remove the post from the post cache; feeds that still list its id skip it on read).

## Common mistakes

**Fanning out inside the request** (`wrong/fan-out-in-request`). The API stores the post, queues the event, then also calls the graph and writes the 200 feeds before answering. The queue is decoration: the author waits for the 50 ms graph and the fan-out, and an author with 5,000 followers waits much longer. In the model the publish p99 climbs past 200 ms. It fails *Fan-out runs behind a queue*, and the p99 limit for Publish post as well.

**Two feed cache nodes** (`wrong/two-feed-cache-nodes`). Healthy, two Redis replicas handle 110k ops/s at about 55%. Lose one and the survivor needs 110% of its capacity. In production that is the moment feeds stop updating, or worse, the cache falls over and takes reads with it. It fails `survive any node failure`.

**Other classic mistakes.**

- *Fan-out on read with a database query per read.* Fails *Reading the feed never queries a database* and, at 10k rps with a 50 ms graph, the read p99.
- *Writing feeds before storing the post.* A failure after the fan-out leaves feeds pointing at a post that was never stored. Fails *Posts are stored before they reach any feed*.
- *Forgetting the `x200`.* The model then sees 500 cache writes a second instead of 100k, and a cache that would melt in production looks idle. Estimation is part of the answer.
- *Storing full posts in every feed.* Memory and update cost multiplied by the follower count.
- *Ignoring celebrities without saying so.* The problem excludes them, but an interviewer will ask. Mention the hybrid before they do.

## In the interview

Start from the ratio: "Reads outnumber writes 20 to 1 and the read budget is 50 ms, so we should do the work at write time." Then draw the two flows and mark the async boundary clearly. Do the 500 × 200 = 100k multiplication on the whiteboard; it is the number the rest of the design depends on.

Likely follow-ups:

- *What about a user with 10 million followers?* Do not fan out their posts. At read time, merge the precomputed feed with the recent posts of the few huge accounts the user follows, fetched from a per-author cache.
- *How do you handle deletes?* Delete from the posts store and the post cache; feeds that still contain the id skip it when the post lookup comes back empty. Optionally fan out a removal.
- *A follower unfollows. Do you clean their feed?* Lazily: filter at read time or let old entries age out of the 500-item window.
- *What if the fan-out worker falls behind?* The queue holds the backlog; add workers; monitor consumer lag. Freshness degrades, correctness does not.
- *How do you rebuild a feed for a user who was inactive for months?* On first read, fall back to a pull: ask the graph for followees and merge their recent posts once, then keep pushing.
- *How do you rank instead of sorting by time?* Fetch a few hundred candidate ids, score them with a ranking service, return the top 50.

## Further reading

- [Design the Twitter timeline and search](https://github.com/donnemartin/system-design-primer/blob/master/solutions/system_design/twitter/README.md), System Design Primer: a full worked solution with a fan-out service, memory-cache timelines and the highly-followed-user problem.
- [Timelines at Scale](https://www.infoq.com/presentations/Twitter-Timeline-Scalability), Raffi Krikorian, QCon San Francisco 2012 (InfoQ): how Twitter fanned tweets out into Redis timelines.
- [Feeding Frenzy: Selectively Materializing Users' Event Feeds](https://sns.cs.princeton.edu/assets/papers/2010-sigmod-silberstein.pdf), Silberstein et al., SIGMOD 2010: when to push and when to pull, per producer and consumer.
- [System Design Primer: Asynchronism](https://github.com/donnemartin/system-design-primer#asynchronism): uses posting a tweet as its example of work done in the background.
- [awesome-scalability](https://github.com/binhnguyennus/awesome-scalability): its Architecture section links Pinterest's write-up on its following feed and other feed case studies.
- *System Design Interview – An Insider's Guide, Volume 1* (Alex Xu), chapter "Design a News Feed System".
