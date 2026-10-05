---
type: flip
difficulty: medium
tags: [resilience]
---

## Front

Why can restarting a whole cache cluster take down the database behind it,
and how do you avoid that?

## Back

An empty cache misses on every read, so the database suddenly gets the full
read load instead of a few percent of it. Restart nodes **one at a time**,
**warm** the cache with the hottest keys first, or admit traffic gradually,
and have the database shed load rather than fall over.
