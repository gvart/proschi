---
name: Long TTLs
icon: hourglass
rarity: common
topic: caching
learn: [choosing-a-ttl]
effect: cache-hit
value: 0.1
downside: trust
downside-value: -10
---

## Text

Every cache hit ratio is 10 points higher. But users see stale pages: 10 less Trust, and a lower cap.

## Why

A longer time to live keeps entries in the cache longer, so more reads hit it. Every entry is also older on average, and an edit can take that long to show up. Pick the TTL per kind of data: how long can this be wrong?
