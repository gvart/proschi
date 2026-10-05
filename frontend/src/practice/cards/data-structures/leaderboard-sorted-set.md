---
type: choice
difficulty: easy
tags: [caching]
---

## Question

A game needs a live leaderboard for 10 million players: the top 100 and any
player's rank, updated on every score. What fits best?

## Options

- [x] A Redis sorted set, with O(log n) updates and rank queries
- [ ] An SQL `ORDER BY score` query on every page view
- [ ] A HyperLogLog of scores
- [ ] A Bloom filter of top players

## Why

A sorted set keeps members ordered by score as they change, so `ZADD`,
`ZREVRANK` and `ZRANGE key 0 99 REV` stay fast. Sorting 10 million rows on each request
does not scale.
