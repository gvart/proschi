---
title: Trending Topics
summary: "Twitter's trends: count tweets in the stream, rank ahead of time, serve from a cache."
difficulty: medium
company: Twitter
tags: [streaming, queues, caching, top-k, real-world]
hints:
  - "Counting is not the tweet's job. What is the least the Tweet Service can do so that something else counts the tweet later?"
  - "Readers ask one question: the top fifty for a location. Answer it once every few seconds and keep the answer in a cache, instead of counting while someone waits."
  - "\"Count tweet\" starts at Kafka and never leaves the detector: it keeps sliding-window counts (a count-min sketch and a top-K heap per window and location) in memory. A dozen Redis increments per tweet is the shortcut to avoid."
  - "\"Publish trends\" writes each ranked list to Redis and to a small database; \"Get trends\" reads Redis and falls back to that database on a miss. Size each service tier for its own rate at well under 70% busy (about 2k rps per replica)."
---

Twitter shows every user a short list of trends: the terms, hashtags and
names whose volume is suddenly growing, worldwide or in their country or
city. A trend is not the most-tweeted term (that would be "the" and "lol"
forever) but a term tweeted much more than usual. Finding them means
counting every term of every tweet in sliding windows, per location, and
comparing each count with its own baseline.

Twitter's first trends system ran on a single machine and could only look
at a small window of tweets. Its replacement, launched in 2015, counts in a
distributed stream processor (Summingbird on Storm) that reads the
firehose of new tweets, detects terms whose volume is anomalous, and hands
the candidates on to be ranked and published.

Build the counting and serving side: the Tweet Service and the tweet store
exist; add everything that turns tweets into trends lists and serves them.

## Functional requirements

- **Post tweet**: a user posts a tweet. The Tweet Service stores it in the
  tweet store and answers `201`. It also hands the tweet to the firehose
  (Kafka), without waiting for anything to count it.
- **Count tweet**: a stream processor (the trend detector) takes a tweet
  from Kafka, extracts its terms and adds them to its sliding-window counts
  for every location the tweet belongs to (city, country, worldwide).
- **Publish trends**: every five seconds, the detector ranks each
  location's terms by how unusual their growth is, and publishes the top
  fifty: to a cache that readers use, and to a small database so the cache
  can be refilled.
- **Get trends**: a user opens a location's trends. Two scenarios:
  `"Cache hit"`, answered from the cache, and `"Cache miss"`, where the
  list is read from the database and put back in the cache.

Use these use case and scenario names exactly: the traffic, requirements and
tests in `problem.proschi` refer to them.

## Scale

- **20k tweets per second** at a busy peak. Twitter averaged about 5,700 a
  second in 2013, and its record second was 143,199.
- Each tweet updates about **a dozen counters**: around four terms, each in
  three locations.
- About **1,000 locations**, each published every 5 seconds: **200
  publishes per second**.
- **30k trends reads per second**; **99%** find the list in the cache.

## Constraints

- Posting a tweet never waits for counting: the tweet is stored before the
  answer, the firehose gets it asynchronously, and the post touches no cache.
- The detector keeps its windows in memory: counting a tweet calls no cache
  and no database. Only ranked lists leave it.
- Trends are ranked ahead of time. A read never counts anything and never
  touches the tweet store.
- p99 of **Post tweet** under **80 ms**, of **Get trends** under **50 ms**.
- Get trends available **99.99%** of the time.
- Losing any single machine must not break a latency limit.
- At most **$11,000 / month**, the Tweet Service and the tweet store
  included.

## What is given

`problem.proschi` declares the `user`, the `tweets` service (sixteen
replicas) and the `tweetstore` (Cassandra, three replicas), and holds the
traffic, requirements and tests. Add Kafka, the detector, the cache, the
database, the trends API, the connections and the four use cases.

Ranking by growth over a baseline is the detector's own logic; the
simulation only sees the calls. The rates of trends reads and publishes are
assumptions for this exercise: Twitter has not published them.

## Based on

- [Building a new trends experience](https://blog.x.com/engineering/en_us/a/2015/building-a-new-trends-experience),
  Twitter Engineering, 2015: the largest change to trends since 2008; the
  old system on a single JVM that saw only a small window of tweets; trend
  detection rebuilt on Summingbird over Storm, reading the firehose,
  detecting anomalies and surfacing candidates for post-processing.
- [Streaming MapReduce with Summingbird](https://blog.x.com/engineering/en_us/a/2013/streaming-mapreduce-with-summingbird),
  Twitter Engineering, 2013, and P. O. Boykin, S. Ritchie, I. O'Connell and J. Lin,
  [Summingbird: A Framework for Integrating Batch and Online MapReduce Computations](https://www.vldb.org/pvldb/vol7/p1441-boykin.pdf),
  VLDB 2014: aggregations computed in a stream as tweets arrive, combined
  in memory before they are written out, on Storm for the online side.
- [TSAR, a TimeSeries AggregatoR](https://blog.x.com/engineering/en_us/a/2014/tsar-a-timeseries-aggregator),
  Twitter Engineering, 2014: Twitter's pattern of pre-aggregating events
  (tens of billions a day) in Summingbird and publishing the results to
  Manhattan and to Nighthawk, its sharded Redis cache, for reads.
- Raffi Krikorian, [New Tweets per second record, and how!](https://blog.x.com/engineering/en_us/a/2013/new-tweets-per-second-record-and-how),
  Twitter Engineering, 2013: about 5,700 tweets a second on average and a
  record of 143,199.

Twitter has not published the trends serving path in detail, so the cache
in front of a small database is an assumption in the spirit of TSAR, not a
description of the production system. The count-min sketch and top-K heap
are the textbook way to find heavy hitters in a stream, not a claim about
Twitter's code.
