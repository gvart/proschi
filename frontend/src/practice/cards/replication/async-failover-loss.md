---
type: estimate
difficulty: medium
tags: [availability, estimation]
answer: 10000
unit: writes
tolerance: 1.5
---

## Question

A primary takes 5,000 writes/s and replicates asynchronously, with the
follower about 2 seconds behind. The primary's disk dies and the follower is
promoted. Roughly how many acknowledged writes are lost?

## Solution

Everything inside the replication lag is gone: 5,000 writes/s × 2 s =
**10,000 writes**. Synchronous (or semi-synchronous) replication would lose
none, at the cost of slower writes.

Numbers: [Numbers to know](../docs/numbers/#how-to-estimate).
