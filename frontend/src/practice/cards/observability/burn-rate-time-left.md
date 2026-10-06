---
type: estimate
difficulty: hard
tags: [availability, estimation]
answer: 50
unit: hours
tolerance: 1.5
distinct-from: [burn-rate-alerts, error-budget]
---

## Question

A service has a 99.9% SLO over 30 days. A bad deploy makes 1.44% of
requests fail and stays out. If nothing changes, how long until the whole
month's error budget is gone?

## Solution

The budget is 0.1% failures. 1.44% ÷ 0.1% = a burn rate of 14.4. The budget
lasts 30 days ÷ 14.4 ≈ 2.1 days ≈ **50 hours**. That is why 14.4× is the
classic paging threshold: one hour of it spends 2% of the month's budget.

Numbers: [Numbers to know](../docs/numbers/#availability-nines).
