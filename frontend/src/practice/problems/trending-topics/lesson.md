```tldr
Twitter's trends list is fifty terms per place, read by millions. **Counting and serving share nothing but a published list**: posts hand tweets to a **firehose**; a stream detector counts terms **in memory** (sliding windows, **count-min sketch**, **top-k heap**) and ranks growth over a baseline. Every five seconds it **precomputes** each location's top fifty into a cache, so a read is one key lookup.
```

## What you'll learn

- How to keep heavy counting work off the write path of the product (posting a tweet) with a firehose topic.
- Sliding windows, the **count-min sketch** and a **top-k heap**: counting heavy hitters in bounded memory.
- Why a "trend" is growth over a baseline, not raw volume.
- How **precomputing** a small answer and serving it from a cache turns an expensive query into a key lookup.

## The problem, explained

Two systems exist: the Tweet Service (sixteen replicas) and the tweet store (Cassandra, three replicas), through which users post. You add everything that turns tweets into trends and serves them.

Four use cases:

- **Post tweet**: store the tweet, answer `201`, and hand the tweet to the firehose (Kafka) asynchronously. The post never waits for counting and never touches a cache.
- **Count tweet**: the trend detector (a stream processor; Twitter used Summingbird on Storm) reads each tweet from Kafka, extracts its terms, and updates in-memory window counts for each of its locations: city, country, worldwide. It calls no cache and no database.
- **Publish trends**: every five seconds, the detector ranks each location's terms by unusual growth and writes the top fifty to a cache (for readers) and a small database (to refill the cache).
- **Get trends**: a user opens a location's list. `"Cache hit"` is served from the cache; `"Cache miss"` reads the database and puts the list back.

Limits: Post tweet p99 under 80 ms; Get trends p99 under 50 ms and 99.99% available; durable posts; no single machine failure may break a latency limit; and $11,000 a month, including the existing Tweet Service and tweet store.

The given tests check four things:

- Posting writes the tweet store before answering, calls a queue but never waits for it, and never calls a cache.
- Counting starts at a queue and touches no cache or database.
- Publishing writes a cache.
- Reading trends checks the cache before any database, never touches a database on a hit, and never touches the tweet store.

## Back-of-the-envelope

```numbers
20k / s | tweets at a busy peak
240k / s | counter updates (12 per tweet)
200 / s | publishes (1,000 locations every 5 s)
30k / s | trends reads
150× | fewer rankings than per-reader ranking
```

**Tweets.** 20k a second at a busy peak. Twitter reported about 5,700 a second on average in 2013 and a record of 143,199 in one second: peaks many times the average are real.

**Counter updates.** Each tweet has about four terms, each counted in three locations: 12 updates per tweet.

| Quantity | Arithmetic | Rate |
|---|---|---|
| Counter updates | 20k × 12 | 240k/s |
| Publishes | 1,000 locations / 5 s | 200/s |
| Trends reads | given | 30k/s |
| Cache misses | 1% of 30k | 300/s |

Look at the first row. As a Redis call per update (`ZINCRBY`, about 100k operations a second per replica), the increments alone need more than two Redis replicas before any reader arrives. In the detector's memory, 240k a second is trivial.

```deepdive Memory for the windows
A count-min sketch with 2,000 columns and 5 rows of 4-byte counters is 40 KB. One per location per time bucket: 1,000 locations × 12 five-minute buckets for an hour × 40 KB ≈ 480 MB, spread across the detector fleet. The dimensions are illustrative, not Twitter's, but the order of magnitude shows windows fit in RAM.
```

**Read side.** A trends list is fifty short strings, a few kilobytes; 1,000 of them, a few megabytes, fit in one cache easily. Reads are what need API replicas: 30k / 2k per service replica = 15 at 100%, so more than that with headroom and a lost replica.

```callout takeaway Rank per location, not per reader
Ranking happens 200 times a second (once per location every five seconds), not 30,000 times a second (once per reader). That 150× ratio is the whole argument for precomputing.
```

**In Proschi's numbers.**

- The Tweet Service runs at about 63% from posts alone (20k ÷ 32k). A synchronous Redis call per post adds latency to a path already using most of its p99 budget.
- The tweet store takes posts at about a third of capacity (20k ÷ 60k). A `GROUP BY` per reader adds 30k reads a second and pushes it hot.
- Each replica has a fixed price (services $100, Redis $150, MySQL $400, Kafka $200). The existing systems take $3,100 of the $11,000, so the new tiers must be lean.

## Concepts

### Sliding windows and baselines, in memory

"Trending now" means "in the last N minutes". A **tumbling** window is a fixed bucket (12:00 to 12:05); a **sliding** window covers the last N minutes at any moment. The standard implementation keeps a ring of small tumbling buckets (say one per minute), sums the latest N and drops the oldest as time moves on. Memory stays bounded and expiry is constant-time.

Stream processors must also pick a clock: when the tweet was created (event time) or processed (processing time). For trends, slightly late tweets matter little, so processing time with small buckets is usually fine.

Windows also give the baseline. Ranked by raw count, "the" and "lol" would trend forever. A detector compares a term's current count with its own history (the same hour yesterday, or a long moving average) and ranks by how unusual the ratio is. The simulation does not see this, but it is why windows and ranking live together in the detector's memory, not in a shared store.

**Trade-off.** State in a process dies with it, so you rebuild it by replaying the log. **When not to do it:** when the state is too large for the fleet's memory, or other services must query it; then use a stream processor's managed state store or a real database. In Proschi, "counting in memory" is simply a consumer step that calls nothing else:

```proschi
title "Stateful stream consumer"

log    "Event Log"        [Kafka] x3
worker "Window Counter"   [Java]  x4

log -> worker : consume

usecase "Count event" {
  log     -> worker : Event term=worldcup loc=23424977
  worker --> log    : commit offset
}
```

```quiz
tumbling-window
```

### Count-min sketch and top-k

An exact counter for every term in every location is impossible: the vocabulary is unbounded. A **count-min sketch** is a small 2D array of counters, `d` rows by `w` columns, with one hash function per row:

- **Add** a term: increment one cell per row.
- **Estimate** its count: take the minimum of its `d` cells.

Collisions can only add, never subtract, so the estimate never undercounts; with `w` and `d` chosen right the overcount is bounded with high probability (Cormode and Muthukrishnan, 2005).

A sketch answers "how often did X appear?" but cannot list the most frequent items. Pair it with a **min-heap of size k**: after each update, if the term is in the heap, update its count; otherwise, if its estimate beats the heap's smallest entry, swap it in. The heap holds the current **heavy hitters**.

**Trade-offs.** Estimates are approximate and only overcount. You cannot delete from a basic sketch (use bucketed windows instead). Heavy hitters by volume are not trends on their own. **When not to use it:** small, bounded key spaces (a few thousand products), where an exact hash map is cheaper and simpler. In Proschi the sketch and heap are invisible: they are the consumer step above.

```quiz
heavy-hitters-structure
top-k-heap
```

### Precompute and serve from a cache

When many readers ask the same few questions, answer each once and store it. Here about 1,000 questions ("trends for location X"), refreshed every five seconds, meet 30k readers a second. Writing the ranked list to a cache turns each read into one key lookup. A small database holds the last published list so a cold or failed cache can be refilled (cache-aside on the read path).

**When not to use it.** With a huge number of rarely repeated questions (arbitrary user-defined queries), precomputing wastes work; compute on demand and cache the popular answers.

````deepdive The pattern in Proschi: precomputed answers
```proschi
title "Precomputed answers"

user  "User"         [Actor]
job   "Ranker"       [Java]       x2
api   "Read API"     [REST API]   x2
cache "Answer Cache" [Redis]      x2
db    "Answer Store" [PostgreSQL] x2

job  -> cache : SET
job  -> db    : SQL
user -> api   : HTTPS
api  -> cache : RESP
api  -> db    : SQL

usecase "Publish" {
  job    -> cache : SET top:eu top 10
  cache --> job   : ok
  job    -> db    : UPSERT answers eu
  db    --> job   : ok
}

usecase "Read" {
  user -> api : GET /top/eu
  alt "Hit" {
    api    -> cache : GET top:eu
    cache --> api   : top 10
  } alt "Miss" {
    api    -> cache : GET top:eu
    cache --> api   : nil
    api    -> db    : SELECT answer FROM answers
    db    --> api   : top 10
    api    -> cache : SET top:eu top 10
    cache --> api   : ok
  }
  api --> user : 200
}
```
````

## Designing it step by step

**Step 1: scope.** Clarify what a trend is (unusual growth), the locations (about 1,000), freshness (seconds is fine), list length (fifty) and personalisation (none). Ask for the peak tweet and read rates.

**Step 2: high-level design.** Three paths:

| Path | Flow | Note |
|---|---|---|
| Write | user → Tweet Service → tweet store → `201`, plus one produce to the firehose | Almost unchanged; use an async send so the post never waits for Kafka |
| Stream | firehose → detector | Sliding-window sketches and top-k heaps per location in memory; each detector instance owns a slice of the key space, keeping state local |
| Read | user → load balancer → trends API → cache | Falls back to the trends database on a miss |

**Step 3: deep dive.**

*Where do the counts live?*

```callout pitfall A sorted set per location
The tempting answer is a Redis sorted set per location with `ZINCRBY` per term. Multiply it out: 240k network writes a second on a shared store, which is also the store readers depend on. Counts inside the detector's memory remove all of that; only 200 ranked lists a second leave it.
```

*What if a detector dies?* Its windows are lost, but Kafka still holds the recent tweets: a replacement replays the last window's worth of offsets and rebuilds. Trends for that slice are briefly off, which is acceptable.

*Which store backs the cache?* Tiny data (one row per location), written 200 times a second: a small relational database with a replica is plenty, read only on the 1% of misses.

*Sizing.* API replicas for 30k reads at well under 70% with one lost, two replicas per new store, a detector sized for 20k events, and the whole bill, existing services included, within budget.

**Step 4: wrap-up.** Mention spam and manipulation filtering before ranking, personalised trends (rank per user cluster), hot partitions (one term exploding worldwide lands on one detector shard), and that the model does not simulate the windows or the ranking logic.

## Common mistakes

**Counting while posting** (`wrong/count-while-posting`). The Tweet Service bumps a dozen Redis counters before answering. Every post waits on Redis, and a tweet spike is a Redis write spike. In Proschi the cache saturates (about 135% of capacity) and the post p99 breaks, failing "Posting a tweet never waits for counting" and `p99 of Post tweet < 80 ms`.

**A counter per term in Redis** (`wrong/counter-per-term-in-redis`). Same increments, moved into the detector. The post is fine, but the detector hammers the shared cache readers also use. It fails "Tweets are counted in the stream, in memory", `survive any node failure`, and the Get trends p99 (the readers' cache is saturated).

**Counting at read time** (`wrong/count-at-read-time`). Every trends request runs a `GROUP BY` over the last hour of tweets: work grows with readers instead of locations, and the tweet store (the source of truth for every tweet) runs hot. It fails "Trends are ranked ahead of time and served from a cache" and cannot survive losing a store replica.

**Reading trends from the database** (`wrong/read-trends-from-database`). The cache is written but never read, so all 30k reads hit two MySQL replicas, which run hot and cannot lose one. It fails the ranked-ahead-of-time test and `survive any node failure`.

**Also watch for:** ranking by raw volume (stop words win), unbounded per-term state with no expiry, and a single detector process that sees every tweet (Twitter's old trends system ran on one JVM and could only look at a small window).

## In the interview

```callout interview Say the separation up front
"Counting is a stream job; serving is a cache lookup; they share nothing but a published list." Then justify it with three numbers: 240k counter updates a second versus 200 publishes a second versus 30k reads a second.
```

Likely follow-ups:

- *How do you count unbounded terms in bounded memory?* Count-min sketch per window plus a top-k heap; or exact counts for a bounded candidate set.
- *How fresh are trends?* Five seconds of publish interval plus stream lag; fine for the product.
- *What if the cache dies?* Readers fall back to the database while the cache refills; the next publish overwrites it anyway.
- *Why not a database query?* It does per reader what can be done per location, and loads the store every post depends on.
- *Personalised trends?* Rank per interest cluster and location, still precomputed, and pick the list per user at read time.

## Further reading

- [Building a new trends experience](https://blog.x.com/engineering/en_us/a/2015/building-a-new-trends-experience), Twitter Engineering, 2015: from a single JVM to a distributed anomaly-detection pipeline.
- [Summingbird: A Framework for Integrating Batch and Online MapReduce Computations](https://www.vldb.org/pvldb/vol7/p1441-boykin.pdf), Boykin, Ritchie, O'Connell and Lin, VLDB 2014: the streaming framework behind it.
- [An improved data stream summary: the count-min sketch and its applications](https://www.cs.tufts.edu/~nr/cs257/archive/graham-cormode/count-min.pdf), Cormode and Muthukrishnan, 2005: the sketch and its error bounds.
- [New Tweets per second record, and how!](https://blog.x.com/engineering/en_us/a/2013/new-tweets-per-second-record-and-how), Twitter Engineering, 2013: the 5,700 average and 143,199 peak tweets a second.
- [The System Design Primer: Additional system design interview questions](https://github.com/donnemartin/system-design-primer#additional-system-design-interview-questions): "Design a trending topic system like Twitter's" and "Return the top k requests during a time interval".
- [The System Design Primer: Amazon's sales rank by category](https://github.com/donnemartin/system-design-primer/blob/master/solutions/system_design/sales_rank/README.md): a worked precomputed-ranking design.
- [awesome-system-design](https://github.com/madd86/awesome-system-design): "Stream Processing" lists Flink, Kinesis and other engines for the detector.
- *System Design Interview – An Insider's Guide*, Vol. 2 (Alex Xu and Sahn Lam): "Real-time Gaming Leaderboard" (top-k serving) and "Ad Click Event Aggregation" (windowed stream counting).
