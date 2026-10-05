---
type: choice
difficulty: hard
tags: [consistency]
related: [social-graph-cache]
---

## Question

After updating a row in the database, why do most cache-aside systems
**delete** the cache key rather than write the new value into it?

## Options

- [x] Two concurrent writers can set the cache in the wrong order and leave the older value there; a delete cannot
- [ ] Deleting a key is faster than writing one
- [ ] Caches cannot overwrite an existing key
- [ ] Deleting keeps the hit rate higher

## Why

If writer A updates the database then writer B does, but B's cache write
lands first and A's second, the cache keeps A's old value until the TTL ends.
After a delete, the next read loads whatever the database holds now.
