---
name: Hot-key replication
rarity: uncommon
topic: caching
learn: [hot-key-replicas, heavy-hitters-structure]
effect: hot-key
value: 0.5
---

## Text

Hot keys hurt half as much.

## Why

One viral key sends all its traffic to the one cache shard that owns it. Copying the hottest keys to several shards (or into a small in-process cache in front) spreads that load again.
