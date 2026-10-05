---
type: choice
difficulty: medium
tags: [caching]
related: [news-feed]
---

## Question

Feeds are built by fan-out on write. A celebrity with 50 million followers
posts. What do large feed systems do?

## Options

- [ ] Write the post into all 50 million feeds as fast as possible
- [x] Skip fan-out for celebrities and merge their recent posts into each feed when it is read
- [ ] Shard the celebrity's followers across more queues
- [ ] Rate-limit how often celebrities may post

## Why

This hybrid keeps fan-out on write for ordinary accounts (fast reads) and
fan-out on read for the few huge ones, which would otherwise create tens of
millions of writes per post.
