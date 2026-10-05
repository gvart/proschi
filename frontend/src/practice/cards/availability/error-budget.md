---
type: estimate
difficulty: medium
tags: [estimation]
answer: 15000
unit: failed requests
tolerance: 1.5
---

## Question

A service has a 99.95% success-rate SLO over 30 days and serves 1 million
requests a day. How many failed requests can it afford in that period?

## Solution

30 days × 1,000,000 = 30,000,000 requests. The budget is 0.05% of them:
30,000,000 × 0.0005 = **15,000 failed requests**. When the budget is spent,
teams slow down risky changes until it recovers.
