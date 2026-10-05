---
type: flip
difficulty: hard
tags: [consistency]
related: [social-graph-cache]
distinct-from: [delete-on-write]
---

## Front

Even with delete-on-write, cache-aside can end up caching a stale value. How,
and what bounds the damage?

## Back

A reader misses and reads the **old** value from the database; a writer then
updates the database and deletes the key; finally the reader writes its old
value into the cache. It stays stale until the TTL. Fixes: a short TTL as a
bound, or **leases** (as in Facebook's memcache) that reject a set after the
key was deleted.
