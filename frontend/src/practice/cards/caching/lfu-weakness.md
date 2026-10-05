---
type: flip
difficulty: hard
distinct-from: [lru-vs-lfu-scan]
---

## Front

What is the weakness of plain LFU eviction, and how do real caches handle it?

## Back

Counts only grow, so a key that was hugely popular last week can stay forever
while new popular keys are evicted before they collect hits. Real
implementations **decay the counts over time** (Redis LFU does) or combine
recency with frequency (as W-TinyLFU in Caffeine does).
