---
type: choice
difficulty: hard
tags: [consistency]
distinct-from: [multi-leader-conflicts]
---

## Question

Replicas resolve conflicts with **last write wins** by timestamp. What can go
wrong?

## Options

- [x] One of two concurrent writes is silently lost, and clock skew can make the older one win
- [ ] Reads become slower than writes
- [ ] Replicas never converge
- [ ] Every conflict needs a human to resolve it

## Why

LWW does converge, but by throwing writes away. It suits data where losing a
concurrent update is fine (a "last seen" time), not a shopping cart, where
both adds should survive.
