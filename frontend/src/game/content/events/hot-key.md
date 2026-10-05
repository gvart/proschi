---
title: Hot key
category: incident
topic: caching
learn: [hot-key-replicas, hot-partition-key, heavy-hitters-structure]
effect: hot-key
value: 0.3
duration: 3
telegraph: One link is about to be on every phone in the country.
counters: [hot-key-replication]
min-wave: 5
---

## What happened

One key took 30% of all reads. Caches and databases lost 30% of their read capacity: the shard that owns the key was saturated while the others idled.

## Why

Sharding and caching spread load by key, so they assume keys are roughly equally popular. A single viral key all lands on one shard, and adding shards does not help.

## What a senior engineer would do

Detect heavy hitters, replicate the hottest keys across shards or into a small local cache in front, and serve what you can from a CDN.
