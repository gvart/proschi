---
type: estimate
difficulty: medium
decks: [sample]
related: [news-feed]
answer: 55
unit: TB
---

## Question

Users write 100 million posts a day, 300 bytes each (text and metadata, no
media). How much storage do five years of posts need, before replication?

## Solution

100M × 300 B = 30 GB a day. × 365 ≈ 11 TB a year. × 5 ≈ **55 TB**. With three
replicas that is about 165 TB, which still fits a modest cluster.
