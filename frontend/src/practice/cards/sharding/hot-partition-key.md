---
type: choice
difficulty: hard
decks: [sample]
tags: [streaming]
related: [view-counting]
---

## Question

You shard view counts by `video_id`. One viral video now gets 200,000 writes
a second, far more than one shard can take. What is the usual fix?

## Options

- [ ] Shard by `user_id` instead
- [ ] Add more shards; the hash spreads the load
- [x] Split the hot key: write to `video_id#0` … `video_id#N` and sum them on read
- [ ] Put the counter in a bigger database

## Why

More shards do not help: one key always hashes to one shard. Salting the key
spreads its writes over N shards, and reads add up N small counters (or a
cache holds the total).
