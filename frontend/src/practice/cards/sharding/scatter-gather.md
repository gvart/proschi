---
type: cloze
difficulty: medium
---

## Text

A query that cannot be routed by the partition key is sent to every shard and
the results merged. This is a {{scatter-gather|scatter gather|fan-out}} query,
and its latency is set by the {{slowest}} shard.

## Why

With 100 shards, even a 1% chance of a slow shard per request makes most
scatter-gather queries slow. Choose keys so the frequent queries hit one
shard.
