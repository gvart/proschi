---
type: flip
difficulty: easy
---

## Front

What do you trade when you choose a cache TTL?

## Back

A **short TTL** keeps data fresh but causes more misses and database load. A
**long TTL** gives a high hit rate but serves stale data for longer after a
change. Pick it from how stale each kind of data may be, and add random
jitter so keys written together do not all expire together.
