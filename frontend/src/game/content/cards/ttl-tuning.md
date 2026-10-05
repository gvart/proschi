---
name: TTL tuning
rarity: common
topic: caching
learn: [choosing-a-ttl, negative-caching]
effect: cache-hit
value: 0.04
---

## Text

Caches answer 4 more requests in every 100.

## Why

A longer TTL keeps entries alive longer, so more reads hit; caching "not found" answers stops repeat misses for keys that do not exist. The price is staleness: pick the longest TTL the data can tolerate.
