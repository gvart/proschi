---
type: flip
difficulty: hard
related: [notion-sharding]
---

## Front

Why create many more logical shards than machines, such as 480 logical shards
on 32 databases?

## Back

Keys map to logical shards once and never change. Growing the fleet means
**moving whole logical shards** to new machines and updating a small routing
table, with no rehashing of keys. With one shard per machine, adding a
machine would mean splitting data by hand.
