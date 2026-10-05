---
type: flip
difficulty: hard
tags: [replication]
---

## Front

What is a **hedged request**, and what does it trade?

## Back

If a read has not returned by about the p95 latency, send the same request to
**a second replica** and use whichever answers first. It cuts tail latency
sharply for roughly 5% more load. Only safe for idempotent reads, and the
extra load must be capped so it does not make an overload worse.
