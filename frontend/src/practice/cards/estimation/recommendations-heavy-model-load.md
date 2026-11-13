---
type: estimate
difficulty: medium
related: [recommendations]
answer: 100
unit: machines
tolerance: 1.5
---

## Question

1,000 feed requests a second each have 500 candidates. One machine running
the deep ranking model scores 5,000 items a second. How many machines does
scoring every candidate with it take, before any headroom?

## Solution

1,000 × 500 = 500,000 items a second; ÷ 5,000 = **100 machines**. If cheaper
passes leave it only the best 50 per request, it scores 50,000 a second:
10 machines, about 15 with headroom for a lost one.

Numbers: [Numbers to know](../docs/numbers/#servers-and-data-stores).
