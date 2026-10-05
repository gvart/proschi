---
type: flip
difficulty: medium
decks: [sample]
tags: [availability]
---

## Front

What do you trade when you lower a DNS record's TTL from an hour to 30 seconds?

## Back

**Faster failover** (clients move to a new address within about 30 s) for
**more DNS queries** and a little more latency on cache misses. Some resolvers
also ignore very short TTLs, so failover is never instant.
