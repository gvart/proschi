---
type: estimate
difficulty: medium
tags: [estimation, availability]
related: [read-replicas]
answer: 5
unit: replicas
tolerance: 1.3
---

## Question

Reads peak at 60,000/s and one MySQL replica serves 20,000 reads/s. Keeping
each replica at or under 75% even while one replica is down, how many
replicas do you need?

## Solution

At 75%, a replica carries 0.75 × 20,000 = 15,000 reads/s, so the reads need
60,000 ÷ 15,000 = 4 replicas **still running**. Add one for the replica that
may fail: **5 replicas**. Four would sit at 75% on a good day, but losing one
leaves three at 100%.

Numbers: [Numbers to know](../docs/numbers/#servers-and-data-stores).
