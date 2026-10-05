---
type: estimate
difficulty: easy
tags: [estimation]
answer: 53
unit: minutes per year
tolerance: 1.5
distinct-from: [three-nines-downtime]
---

## Question

A service promises 99.99% availability. How much downtime does that allow in
a year?

## Solution

A year has 365 × 24 × 60 = 525,600 minutes. 0.01% of that is 525,600 ×
0.0001 ≈ **53 minutes a year**, or about 4.3 minutes a month. Each extra nine
divides the allowed downtime by ten.
