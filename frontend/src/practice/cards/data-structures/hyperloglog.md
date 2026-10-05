---
type: flip
difficulty: medium
decks: [sample]
tags: [streaming]
related: [view-counting]
---

## Front

You need the number of **unique** visitors per page, for billions of visits.
What data structure fits, and what does it trade?

## Back

**HyperLogLog**: it estimates the count of distinct items in about 12 KB per
counter with roughly 1% error, instead of storing every visitor id. Counters
can also be merged, e.g. hourly into daily.
