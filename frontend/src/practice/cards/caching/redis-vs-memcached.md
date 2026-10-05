---
type: flip
difficulty: medium
---

## Front

When would you choose Redis over Memcached as a cache?

## Back

When you need more than get and set: **data structures** (sorted sets for
leaderboards, counters, lists), **atomic operations**, optional
**persistence** and built-in **replication**. Memcached is a simpler,
multithreaded key-value cache, a fine fit when strings with a TTL are all you
need.
