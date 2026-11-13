---
type: estimate
difficulty: hard
tags: [estimation]
related: [nearby-search]
answer: 6000
unit: searches/s
tolerance: 1.5
---

## Question

A dating app's user index is split into 7 shards by hash of user id and
takes 6,000 nearby searches a second. How many searches a second does each
shard serve?

## Solution

Neighbours are scattered over every shard, so each search asks all 7 and
merges: 6,000 × 7 = 42,000 shard searches, ÷ 7 shards = **6,000 a second
per shard**, whatever the shard count. Sharded by location, a search reads
about 3 of the 7: 6,000 × 3 ÷ 7 ≈ 2,600 per shard.

Numbers: [Numbers to know](../docs/numbers/#throughput-and-capacity).

## Why

With scatter-gather, more shards add work per search, not capacity; only
more copies of each shard help. Sharding by the field the query filters on
(here, location) is what makes shards add capacity.
