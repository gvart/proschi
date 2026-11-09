---
type: choice
difficulty: medium
tags: [replication]
related: [search-indexing]
---

## Question

A search index is split into 3 shards with no replicas, and queries are
growing past what the cluster can serve. Its size is fine. What should you
add?

## Options

- [ ] More shards, so each query searches less data
- [x] Replicas of each shard, so queries spread over more copies
- [ ] A bigger refresh interval, so writes are cheaper
- [ ] A second index with the same data and no shards

## Why

A query has to visit one copy of every shard, so more shards add work per
query rather than capacity. Replicas are full copies that can each answer
for their shard: they add query throughput and survive the loss of a node.
They cost writes, since every copy indexes every document. Shards are for
size and indexing spread; replicas are for reads and availability.
