---
type: estimate
difficulty: easy
tags: [estimation]
related: [notion-sharding, ticket-booking]
answer: 15
unit: shards
tolerance: 1.5
---

## Question

Peak load is 120,000 writes/s. One primary can safely take 8,000 writes/s.
How many shards do you need?

## Solution

120,000 ÷ 8,000 = **15 shards**. Round up and add headroom for growth and
uneven keys; with logical shards, later growth is a matter of moving shards.
