---
name: Request coalescing
rarity: uncommon
topic: caching
learn: [cache-stampede, early-recomputation]
effect: coalesce
value: 0
---

## Text

Cold caches and stampedes do nothing: misses for the same key wait for one database read.

## Why

When a hot key expires or a cache restarts, thousands of requests miss at once and every one of them queries the database. Coalescing (a lock per key, or a single-flight group) lets one request fetch while the rest wait for its answer.
