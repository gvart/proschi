---
title: Search Indexing
summary: DoorDash's search, fed through Kafka so menu edits reach the index in near real time and queries never wait on writes.
difficulty: medium
company: DoorDash
tags: [search, streaming, queues, async, replication, real-world]
hints:
  - "Diners only read and merchants only write. What if those two paths never shared a node: queries answered from a search index alone, and edits written to the database alone?"
  - "How does an edit reach the index without the merchant waiting for it? Save it, publish a change event to Kafka, and answer. Indexers consume the stream, read the store's current rows from the database and update the search cluster a few seconds later."
  - "Writing every change to Elasticsearch on its own costs the cluster 12k writes a second, more than the queries. In \"Index change\" and \"Backfill\", let \"Buffered\" only add the document to a buffer, and let \"Flush\" send one _bulk request for the whole batch."
  - "The search cluster takes 3k requests a second per node. Split the index into shards and give each shard 2 replicas (capacity { search shards 3 } with x3): then losing a node leaves every shard two copies, and the queries still fit. Size the Search API and the indexers near 60% busy."
---

DoorDash's search finds stores and dishes near a diner. Its index is built
from the stores, menus and items that merchants and operators edit all day,
plus scores and tags that a nightly ETL computes for every item. The old
indexing was slow and unreliable: it could take up to a week to reindex all
of the changes, mismatches between the index and the source of truth had to
be fixed by hand, and a full reindex job typically took a month.

The rebuild separated the two sides completely. Edits go to the database,
and a change event goes to Kafka. Flink jobs turn each event into a search
document and write it to Elasticsearch in bulk. Diners query Elasticsearch
only. Design that pipeline and the query path beside it.

## Functional requirements

- **Search**: a diner searches for stores and dishes and gets results from
  the search cluster.
- **Edit menu**: a merchant changes a store, menu or item. The edit is saved
  in the `db` before the merchant hears back, and a change event (the
  store's id, not its contents) is published to a change stream. The edit
  never waits for the search cluster, and nothing but the stream leads into
  the index.
- **Index change**: an indexer receives a change event from the stream,
  reads the store's current rows from `db`, builds the search document and
  adds it to a bulk buffer. Two scenarios:
  - `"Buffered"`: the buffer has room; the document waits in it, and the
    search cluster is not called.
  - `"Flush"`: the buffer is full (about 100 documents) or a second has
    passed; one `_bulk` request writes the whole batch.
- **Backfill**: the nightly ETL's rows (scores and tags) are streamed in
  throttled batches by the given `loader` into the change stream, and from
  there to the indexers, with the same `"Buffered"` and `"Flush"` scenarios.
  The rows carry their values, so a backfill never reads `db`.

Use these use case and scenario names exactly: the traffic, requirements and
tests in `problem.proschi` refer to them.

## Scale

- **10k searches a second** at peak.
- **2k edits a second**, each one change event.
- The backfill streams **10k ETL rows a second**, spread over the day.
- A bulk request carries about **100 documents**, so 1% of the changes and
  rows trigger a flush.
- An Elasticsearch node serves about **3k requests a second**.

DoorDash did not publish these rates; they are assumptions for the exercise.

## Constraints

- Searches never call `db`, and no client connects to it.
- p99 of a search under **120 ms**, of an edit under **150 ms**, with the
  backfill running.
- Searches available **99.95%** of the time, edits **99.9%**.
- Every shard of the index has at least two copies; losing any single
  machine must not break a latency limit.
- At most **$8,000 / month**, the database and the loader included.

## What is given

`problem.proschi` declares the two clients, `merchant` and `diner`, the
source-of-truth database `db` (PostgreSQL, x2) and `loader`, the job that
streams the ETL's rows. Add the search cluster (Elasticsearch: shards with
`capacity { search shards 3 }` are yours to choose), the API in front of it,
the API that saves edits, the change stream, the indexers and the four use
cases.

## What this model leaves out

- **Freshness.** The point of the pipeline is that an edit shows up in search
  as quickly as possible; this exercise takes "within seconds" as its goal
  (DoorDash's post gives no figure). The simulation measures
  request latency, not how old the index is, so freshness is encoded as a
  test (edits are indexed from the stream) rather than as a number.
- **How Elasticsearch spends its nodes.** A real query visits one copy of
  every shard, and every copy applies every write. The simulation spreads
  both over all the nodes, so it is a little optimistic about large clusters;
  the shard and replica arithmetic is in the lesson.
- **Lost events.** Publishing after the commit leaves a small gap: a crash
  between the two loses the event, and the index stays stale until the store
  changes again or the next full reindex. An outbox or log-based change
  capture closes it; the simulation has no crashes in the middle of a request.
- **Two Flink jobs in one.** DoorDash runs an Assembler that builds the
  document by calling the backend services, then a second Kafka topic and an
  Elasticsearch sink. Here one `indexer` does both and reads `db` directly.

## Based on

- Satish Saley, Danial Asif and Siddharth Kumar,
  [Building Faster Indexing with Apache Kafka and Elasticsearch](https://careersatdoordash.com/blog/open-source-search-indexing/),
  DoorDash Engineering blog, July 14, 2021: the legacy indexing, where
  reindexing all of the changes could take up to a week, a full reindex job
  typically took a month, and mismatches with the source of truth were fixed
  by hand; a platform built on Kafka, Flink and Elasticsearch, fed from
  Postgres and a Snowflake warehouse; change events published by save hooks
  in the applications ("application level CDC") and carrying only the
  changed entities' ids, because Debezium change data capture showed too
  much overhead in performance tests; a Flink Assembler that dedupes events
  over a short window and fetches the full data in bulk from the services'
  REST APIs, and a Flink sink that writes Elasticsearch in bulk with rate
  limiting, a dead-letter queue and one consumer group per index; nightly
  ETL data streamed into Kafka in batches sized so downstream is not
  overwhelmed, with the goal of ingesting it within 24 hours; and the
  results: a store backfill from one week to 6.5 hours, an item backfill
  from two weeks to 6.5 hours, and a reindex of existing stores and items
  from one week to two hours.
