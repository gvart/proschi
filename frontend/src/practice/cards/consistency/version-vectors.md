---
type: flip
difficulty: hard
tags: [replication]
related: [shopping-cart, distributed-kv]
---

## Front

What can version vectors (vector clocks) tell you that timestamps cannot?

## Back

Whether two versions are **concurrent** (neither write had seen the other)
or one **happened after** the other. If one follows the other, keep the newer;
if they are concurrent, keep both as siblings and merge them, instead of
silently dropping one as last-write-wins does.
