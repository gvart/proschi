---
title: View Counting
summary: "Reddit's view counter: Kafka, a filter, and HyperLogLogs in Redis."
difficulty: medium
tags: [streaming, queues, probabilistic, caching, real-world]
company: Reddit
hints:
  - The page view must not wait for counting. What is the least the request can do and still never lose the view?
  - "Two consumers read Kafka. The first (Nazar at Reddit) checks recent views in Redis and passes the views that count to a second topic; the second (Abacus) adds them to a per-post HyperLogLog in Redis with PFADD."
  - "A HyperLogLog never stores the user ids, so there is no row per viewer. If Redis evicted a post's counter, load it from the database first, then PFADD. Copy counters to the database in \"Persist counts\" (read Redis, then write the database), never on every view."
  - "Size every service tier for its own rate at well under 70% busy (about 2k rps per replica), and give Kafka and each Redis enough replicas to lose one. The budget leaves little room for spare tiers."
---

In 2017 Reddit started showing how many people viewed each post. A view
count sounds like a counter, but it is a count of **unique** viewers: a
user who opens a post ten times is one view. Keeping a set of user ids per
post would take megabytes for every popular post. Reddit's answer was a
streaming pipeline that filters views and counts them with HyperLogLog, a
sketch of at most 12 KB per post that is off by under 1%.

## Functional requirements

- **Record view**: a reader's client reports that the reader opened a post.
  The event is stored durably and the client gets a `2xx`.
- **Filter view**: a consumer takes a view from Kafka and decides whether it
  counts, using state it keeps in Redis about recent views. Two scenarios:
  `"Counted"` passes the view on through Kafka, `"Ignored"` (a repeat view, a
  bot) drops it.
- **Count view**: a consumer takes a counted view from Kafka and adds the
  viewer to the post's HyperLogLog in Redis. Two scenarios:
  `"Counter in Redis"`, and `"Counter evicted"`, where Redis no longer has
  the counter and it is loaded from the database first.
- **Persist counts**: every 10 seconds, the counters that changed are copied
  from Redis to the database (Cassandra at Reddit), in case Redis evicts
  them.
- **Read count**: a reader sees a post's view count, read from Redis.

Use these use case and scenario names exactly: the traffic, requirements and
tests in `problem.proschi` refer to them.

## Scale

- **20k view events per second** at peak; about 10% are filtered out.
- 18k counted views per second; about 1% find their counter evicted.
- About 20k posts change in any 10 seconds: **2k counter writes per
  second**.
- **10k count reads per second**.

## Constraints

- Counts are near real time: a view is counted within seconds, and the
  count may be off by a few percent. Daily or hourly batch jobs do not
  qualify.
- p99 of **Record view** and of **Read count** under **60 ms**.
- Both available **99.9%** of the time.
- A view event is written durably (to Kafka) before the client hears back,
  and the request does nothing else: no Redis, no database.
- Losing any single machine must not stop recording or counting views.
- At most **$10,000 / month**.

## What is given

`problem.proschi` declares the `reader` and holds the traffic, requirements
and tests. Add everything else: the services, Kafka, Redis, the database,
the connections and the five use cases. The post gives no request rates;
the scale above is an assumption for this exercise.

## Based on

- Krishnan Chandra, [View Counting at Reddit](https://www.redditinc.com/blog/view-counting-at-reddit),
  Reddit engineering blog, May 2017 ([discussion](https://news.ycombinator.com/item?id=14431173)):
  the four requirements (near real time, each user counted once in a short
  window, within a few percent, production scale), the pipeline of an
  event collector, Kafka, Nazar and Abacus, HyperLogLog counters in Redis
  (up to 12 KB, 0.81% standard error), and the copy to Cassandra every 10
  seconds.
