---
type: flip
difficulty: hard
tags: [replication, availability]
related: [shopping-cart, distributed-kv]
distinct-from: [quorum-read-size]
---

## Front

What is a **sloppy quorum** with hinted handoff, and what does it cost?

## Back

When some of a key's home replicas are unreachable, the write goes to other
healthy nodes, which hold it with a "hint" and hand it back when the home
replicas return. Writes stay available, but **R + W > N no longer guarantees**
that a read sees the latest write until the handoff completes.
