---
type: estimate
difficulty: medium
tags: [estimation, storage]
answer: 91
unit: TB
tolerance: 1.5
---

## Question

A Kafka cluster takes 50 MB/s, keeps data for 7 days, and stores 3 replicas.
How much disk does that need?

## Solution

50 MB/s × 86,400 s = 4,320,000 MB ≈ 4.32 TB a day. × 7 days ≈ 30.2 TB.
× 3 replicas ≈ **91 TB**, before compression and free-space headroom.

Numbers: [Numbers to know](../docs/numbers/#seconds-in-a-day-month-and-year).
