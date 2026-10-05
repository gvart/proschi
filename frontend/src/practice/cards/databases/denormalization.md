---
type: flip
difficulty: medium
tags: [sharding]
---

## Front

When would you denormalize a schema, and what do you take on?

## Back

When reads dominate and joins are too slow or impossible (for example across
shards), copy the data each read needs into one row or document. You take on
**keeping the copies in sync**: every change must update all of them, and a
missed update leaves the data inconsistent. Storage also grows.
