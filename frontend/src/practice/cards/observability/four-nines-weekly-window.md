---
type: estimate
difficulty: medium
tags: [availability, estimation]
answer: 1
unit: minutes
tolerance: 1.5
distinct-from: [three-nines-downtime, four-nines-per-year, three-and-a-half-nines]
---

## Question

A team measures its 99.99% SLO over a rolling 7-day window. How much total
outage fits in one window?

## Solution

7 × 24 × 60 = 10,080 minutes. 0.01% of that is 10,080 × 0.0001 ≈ **1
minute**. A single failover that takes longer breaks the SLO, so four nines
needs automatic recovery, not a person paged to fix it.

Numbers: [Numbers to know](../docs/numbers/#availability-nines).
