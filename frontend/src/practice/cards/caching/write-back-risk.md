---
type: choice
difficulty: medium
decks: [sample]
tags: [databases]
---

## Question

Which cache write policy can **lose acknowledged writes** if the cache node
crashes?

## Options

- [ ] Write-through: write the cache and the database before acknowledging
- [x] Write-back: acknowledge after writing the cache, flush to the database later
- [ ] Write-around: write only the database and let reads fill the cache
- [ ] Cache-aside with a TTL

## Why

Write-back acknowledges before the data reaches durable storage, so anything
not yet flushed dies with the node. It buys the lowest write latency at that
price.
