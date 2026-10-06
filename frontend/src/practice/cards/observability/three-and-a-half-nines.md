---
type: estimate
difficulty: medium
tags: [availability, estimation]
answer: 22
unit: minutes per month
tolerance: 1.5
distinct-from: [three-nines-downtime, four-nines-per-year]
---

## Question

An SLO of 99.95% availability over a 30-day window: how many minutes of
total outage does its error budget hold?

## Solution

30 × 24 × 60 = 43,200 minutes. The budget is 0.05% of that: 43,200 × 0.0005
= **21.6 minutes**. Half of 99.9%'s 43 minutes, and five times 99.99%'s
4.3 minutes. One slow rollback can spend all of it.

Numbers: [Numbers to know](../docs/numbers/#availability-nines).
