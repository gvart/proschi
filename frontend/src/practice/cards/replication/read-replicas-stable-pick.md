---
type: choice
difficulty: hard
tags: [consistency]
related: [read-replicas]
distinct-from: [monotonic-reads]
---

## Question

Related reads share an id, and `hash(id) % N` over the replicas picks the
same replica for all of them. One replica goes down. How should the pick
change so that other ids keep their replica?

## Options

- [x] Index into the full list as before; only if that replica is down, pick again among the others
- [ ] Index into the list of replicas that are up, so N becomes N − 1
- [ ] Send every read to the primary until the replica is back
- [ ] Pick a random replica for every query while one is down

## Why

Taking the modulo over only the live replicas changes N, which moves almost
every id to a different, possibly further-behind replica, breaking monotonic
reads for ids that had nothing to do with the failure. Hashing over the
full configured list and re-picking only for the ids whose replica is down
moves those ids alone. Shopify fixed exactly this in its ProxySQL fork.
