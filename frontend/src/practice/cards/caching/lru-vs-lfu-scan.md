---
type: choice
difficulty: hard
---

## Question

Every night a batch job reads each of millions of keys once, and the next
morning the cache hit rate has collapsed. Which eviction policy would have
resisted that?

## Options

- [ ] LRU: evict the least recently used key
- [x] LFU: evict the least frequently used key
- [ ] FIFO: evict the oldest inserted key
- [ ] No eviction; reject new keys when full

## Why

Under LRU the scan makes every one-off key "recently used", pushing out the
keys real users ask for all day. LFU keeps the keys with many hits, so keys
touched once are evicted first.
