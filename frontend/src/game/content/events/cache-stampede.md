---
title: Cache stampede
icon: snowflake
category: incident
topic: caching
learn: [cache-stampede, cold-cache-restart, early-recomputation]
effect: cache-cold
target: cache
values: ["0", "0.5"]
duration: 2
telegraph: The cache cluster restarts for a version upgrade.
counters: [request-coalescing]
requires: [cache]
min-wave: 4
---

## What happened

The cache came back empty: the first tick nothing hit, the next only half as often. Every miss went to the database.

## Why

A cache with a 95% hit ratio hides 95% of the read load from the database. When it is cold, the database sees 20 times its usual reads at once, and it was never sized for that.

## What a senior engineer would do

Give the database headroom for a cold cache, warm caches before taking traffic, and coalesce misses for the same key so one request fetches while the rest wait.
