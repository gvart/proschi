---
type: choice
difficulty: medium
tags: [databases]
---

## Question

Which query gets much more expensive if you partition by a **hash** of the
key instead of by **key range**?

## Options

- [ ] Fetch the row for one key
- [x] Scan all keys between two values, such as events between 10:00 and 11:00
- [ ] Insert a new row
- [ ] Count the rows on one shard

## Why

Hashing scatters neighbouring keys across all shards, so a range scan must ask
every shard. Range partitioning keeps them together, but risks hot spots when
writes cluster at one end of the range.
