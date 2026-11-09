# Search indexing: a fresh index without slow queries

```tldr
Keep the **read path** (diners querying a search cluster) and the **write path** (merchants editing a database) apart, joined only by a **change stream**. An edit commits and publishes an event; **indexers** consume it, rebuild the document from the source of truth and write it in **bulk**. Size the search cluster with **shards for the data and replicas for the queries**.
```

## What you'll learn

- Why a search index is a separate copy of the data, and why queries should never fall back to the source of truth.
- How a **change stream** (Kafka) keeps that copy fresh within seconds, without making the writer wait.
- Why change events that carry **only an id** are easier to get right than events that carry the data.
- Why **bulk writes** are what lets one cluster take heavy indexing and fast queries at once.
- The difference between **shards** and **replicas** in a search cluster, and how to count nodes for both.

## The problem, explained

A food delivery app's search box answers "tacos near me, open now". The answer comes from stores, menus and items that merchants and operators edit all day, plus ranking scores and tags that a nightly job computes for every item. A relational database is the right home for those edits, with transactions and constraints, and the wrong tool for ranked text and location search over every menu. So the data lives twice: in the database as the **source of truth**, and in a search engine as an **index** built from it.

The hard part is keeping the copy in step. DoorDash's first indexing system did it slowly and unreliably: an edit took a long time to appear in search, the index and the database disagreed often enough that engineers fixed stores by hand, and rebuilding the whole index took about a week. Their rebuild, on Kafka, Flink and Elasticsearch, made the index follow changes continuously and cut a full reindex to two hours.

The problem has four use cases:

- **Search**: a diner queries the search cluster.
- **Edit menu**: a merchant's change is saved in `db` and published as a change event.
- **Index change**: an indexer consumes the event, reads the store from `db`, and either buffers the document (`"Buffered"`) or flushes a bulk request (`"Flush"`).
- **Backfill**: the nightly ETL's rows enter the same stream through the given `loader` and reach the index in bulk too.

The tests check that searches never touch `db`, that an edit publishes to a broker and never calls the search cluster, that both indexing use cases come from the stream, that only flushes write the index, and that every shard has a replica.

## Back-of-the-envelope

```numbers
10k / s | searches
12k / s | changes and ETL rows to index
120 / s | bulk requests, at 100 documents each
9 nodes | 3 shards × 3 copies
$7,300 | a month for the reference design
```

The numbers are assumptions for the exercise; DoorDash did not publish its rates.

| Flow | Rate | Where it lands |
|---|---|---|
| Search | 10k/s | Search API, then the search cluster |
| Edit menu | 2k/s | Edit API, `db` (writes), Kafka |
| Index change | 2k/s | indexers, `db` (reads); 20 bulk requests/s to the cluster |
| Backfill | 10k/s | Kafka, indexers; 100 bulk requests/s to the cluster |

**The search cluster.** At about 3k requests a second per node, the queries alone need 10k ÷ 3k ≈ 3.3 nodes. If every change were its own write, the cluster would take another 12k a second: 22k in total, more than seven nodes' worth before any headroom. With bulk requests the writes fall to about 120 a second, almost nothing.

**Shards and copies.** Three shards with three copies each is nine nodes. Each shard serves a third of the queries, 3.3k a second over three copies: about 37% busy, and about 56% after losing one copy. Nine Elasticsearch nodes at $400 is $3,600, the largest line of the budget.

**The rest.** The Search API at 2k a second per instance needs 10k ÷ 2k = 5 instances; 8 keep it near 62% and 71% after a loss. The indexers handle 12k messages a second: 10 instances at 60%. The database sees 2k writes and 2k reads a second, well within one primary.

## Concepts

### Separate read and write paths

The writers (merchants) and the readers (diners) want different things from the data. Writers need transactions and a single source of truth; readers need ranked text and geographic search, fast, at ten times the rate. Serving both from one store forces one of them to lose: text search on the primary competes with edits for CPU and locks, and a relational index cannot rank "tacos" by relevance and distance anyway.

So keep two stores, each built for its side, and connect them only through a stream. This is the idea behind **CQRS** (command query responsibility segregation): the database takes commands, the index answers queries, and an asynchronous process turns one into the other.

What it costs is **staleness**. The index is always a little behind, here by seconds. For search that is fine: an old price in the result list is harmless, because the order itself is placed against the database.

```callout takeaway
The search path never reads the source of truth, and the edit path never writes the index. The change stream is the only link between them.
```

```quiz
oltp-vs-olap
inverted-index
```

### Indexing from a change stream

An edit commits to the database, then a change event goes to Kafka, and the merchant gets the answer. Indexers consume the stream and update the index a moment later. The merchant never waits for the search cluster, and a slow or failing cluster only makes the index a little older; it never fails an edit.

DoorDash publishes these events from **save hooks** in the applications: code that runs whenever a store, menu or item is saved. They looked at the usual alternative, log-based change data capture with the Debezium connector for PostgreSQL, and found it too costly for their needs. Both approaches have the same shape: the database commits first, and an event follows.

Two details make the stream robust:

- **Events carry ids, not data.** An event says "store 812 changed". The indexer then reads the store's current state (DoorDash's Assembler calls the backend services; here it reads `db`). Events can be duplicated, reordered or replayed, and the indexer still writes the latest version. An event that carried the new price could arrive after a newer one and overwrite it with an old value.
- **The index can always be rebuilt.** Because the index is derived, replaying the stream or streaming every row through it again repairs any drift. That is what the backfill does.

The gap to know about: publishing after the commit is a dual write. If the process dies between the two, the event is lost and the index stays stale until the store changes again. A **transactional outbox** (write the event in the same transaction, relay it afterwards) or log-based change capture closes the gap.

```deepdive Why not write to Elasticsearch in the request?
Writing the database and then the index in the same request looks simpler. It couples the edit's latency and availability to the search cluster: a cluster under a heavy reindex slows every edit, and a cluster that is down fails them. Worse, the two writes are not atomic. An edit that commits and then fails to index leaves the index wrong with nobody to retry it, which is the drift DoorDash's engineers were fixing by hand. A stream makes the retry someone's job: the consumer keeps its offset until the index has the document.
```

```quiz
change-data-capture
transactional-outbox
```

### Bulk writes

Every request to a search cluster has a fixed cost: a round trip, a thread, a write to the transaction log, and work to make new documents searchable. A `_bulk` request pays that once for hundreds of documents. So the indexer **buffers**: each change adds its document to an in-memory batch, and the batch is sent when it reaches a size (here about 100 documents) or a time limit (a second), whichever comes first.

That is what the two scenarios model. In `"Buffered"` the indexer only adds to the buffer and the cluster sees nothing. In `"Flush"`, 1% of the time, one request writes the whole batch. The cluster takes 120 requests a second instead of 12k, and queries keep the nodes to themselves.

The time limit matters as much as the size: without it, a quiet hour would leave a half-full buffer waiting. DoorDash's sink also **rate-limits** its writes, so that a burst of changes cannot crowd out queries on the cluster. The backfill gets the same protection one step earlier: the ETL's daily rows are streamed in batches spread over 24 hours, never all at once.

```callout tip
Batching trades a second of delay for a hundredfold cut in write requests. For a search index, where a second of staleness is invisible, that trade is almost free.
```

```quiz
search-indexing-bulk-requests
queue-load-levelling
```

### Shards and replicas

A search index is split into **shards**, each a self-contained piece of the index holding a subset of the documents. Shards let an index be bigger than one node and spread indexing work. Each shard then has **replicas**: full copies that can answer queries for it and take over when its node dies.

They scale different things. A query must visit one copy of **every** shard and merge the results, so more shards do not add query throughput; they add work per query. More replicas do: each copy can serve a share of the queries. But every copy must apply every write, so replicas multiply indexing work, which is one more reason to keep writes in bulk.

Count nodes as **shards × copies**. Three shards with one primary and two replicas each is nine nodes, and losing any one leaves every shard two copies. Nine shards with no replicas is also nine nodes, with the same total capacity in the simulation, and losing one node loses a ninth of the stores from every search.

```quiz
search-indexing-shards-vs-replicas
three-replicas-parallel
```

## Designing it step by step

1. **The read path.** Add the search cluster and an API in front of it. The diner calls the API, the API queries the cluster, and nothing on this path connects to `db`.
2. **The edit.** Add an API for merchants that writes `db` and then publishes a change event, the store's id, to a Kafka topic. Answer the merchant after the commit; the publish can be asynchronous.
3. **The indexers.** Add a pool of indexers that consume the topic. For each event, read the store's current rows from `db` and build the document. Split the use case into `"Buffered"` (add to the buffer, answer the stream) and `"Flush"` (one bulk write, then commit the offsets).
4. **The backfill.** Send the `loader`'s rows into the same topic. The indexers handle them like changes, without reading `db`, since the rows carry their values.
5. **Size the cluster.** Choose shards and copies: with `capacity { search shards 3 }` and `x3`, nine nodes. Check that each shard's copies stay well under 70% busy with one copy gone.
6. **Size the rest.** The Search API and the indexers near 60% busy, at least two of everything, and a look at the budget: the search cluster is about half of it.
7. **Explain the trade-offs** in `decision` blocks: why the index is fed from a stream, why events carry ids, why bulk, why replicas.

## Common mistakes

- **Indexing inside the edit.** The edit API writes the database, then the search cluster, then answers. Edits now wait for the cluster and fail with it, and an edit that saved but did not index leaves them out of step. It fails *An edit is saved, then indexed in the background*. Publish an event and index from the stream.
- **Searching the database.** The Search API runs `ILIKE` queries on PostgreSQL. It cannot rank by relevance and distance, and it competes with every edit on the source of truth. It fails *Searches never touch the source of truth*.
- **One write per change.** The indexers send each document as its own request: 12k writes a second on the nodes that answer queries. Search p99 climbs past the limit, and losing a node saturates a shard. It fails *Documents are written to the index in bulk*. Buffer and flush.
- **Shards without replicas.** Nine shards with one copy each have enough capacity, but each shard lives on one node. Losing it breaks every search. It fails *Every shard of the index has a replica* and *survive any node failure*.

```callout pitfall
"Use Elasticsearch" is not the answer to a search question. The interviewer wants to hear how the index stays fresh, what happens when indexing is heavy, and what a node failure does.
```

## In the interview

- **Start from the two sides.** Writers and readers, their rates and their needs, then the stream between them. Saying "the read model is eventually consistent, the database decides" early frames everything that follows.
- **Expect "how fresh?"** Seconds: the edit commits, the event is consumed within a second or two, and the bulk flush timer bounds the rest. Mention the refresh interval of the search engine as the last step.
- **Expect "what if an event is lost?"** Ids-only events and a full reindex make the index self-healing; an outbox or log-based capture closes the publish gap.
- **Expect "how do you reindex everything?"** Stream every row through the same pipeline at a throttled rate, or build a new index alongside and switch an alias once it has caught up. DoorDash's rebuild brought a full reindex from a week to two hours.
- **Expect "shards or replicas?"** Shards for size and indexing spread, replicas for query throughput and failures; count nodes as shards × copies.

## Further reading

- Satish Saley, Danial Asif and Siddharth Kumar, [Building Faster Indexing with Apache Kafka and Elasticsearch](https://careersatdoordash.com/blog/open-source-search-indexing/), DoorDash Engineering blog, 2021: the system this problem is based on.
- Elastic, [Bulk API](https://www.elastic.co/guide/en/elasticsearch/reference/current/docs-bulk.html) and [Tune for indexing speed](https://www.elastic.co/guide/en/elasticsearch/reference/current/tune-for-indexing-speed.html): why bulk requests and refresh intervals matter.
- Elastic, [Scalability and resilience: clusters, nodes and shards](https://www.elastic.co/guide/en/elasticsearch/reference/current/scalability.html): primaries, replicas and how a query uses them.
- Apache Flink, [Elasticsearch connector](https://nightlies.apache.org/flink/flink-docs-stable/docs/connectors/datastream/elasticsearch/): bulk flushing by size and interval.
- Chris Richardson, [Pattern: Transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html): closing the gap between a commit and its event.
- Martin Kleppmann, *Designing Data-Intensive Applications*, chapter 11, "Stream Processing" (the section on keeping systems in sync and change data capture).