---
type: estimate
difficulty: hard
tags: [replication]
answer: 5.4
unit: minutes per month
tolerance: 1.5
distinct-from: [availability-in-series]
---

## Question

Three independent replicas are each 95% available, and the service is up
while any one of them is. How many minutes a month (30 days) is it down?

## Solution

All three must be down at once: 0.05³ = 0.000125, so availability is
99.9875%. A month has 43,200 minutes: 43,200 × 0.000125 ≈ **5.4 minutes**.
Three mediocre replicas beat one excellent server, as long as their failures
really are independent.

Numbers: [Numbers to know](../docs/numbers/#availability-nines).
