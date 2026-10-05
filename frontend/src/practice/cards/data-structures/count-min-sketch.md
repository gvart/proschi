---
type: flip
difficulty: medium
tags: [streaming]
related: [trending-topics]
---

## Front

What does a **count-min sketch** estimate, and in which direction is it
wrong?

## Back

How often each item has appeared in a stream, in fixed memory: each item
increments one counter in each of several hashed rows, and its estimate is the
**minimum** of those counters. Collisions only add, so it can **overestimate
but never underestimate**.
