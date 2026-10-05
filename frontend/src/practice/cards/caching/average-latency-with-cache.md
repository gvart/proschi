---
type: estimate
difficulty: medium
tags: [estimation]
related: [url-shortener]
answer: 2.9
unit: ms
tolerance: 1.5
---

## Question

A cache hit takes 1 ms. A miss takes 20 ms (cache check plus database read).
With a 90% hit rate, what is the average read latency?

## Solution

0.9 × 1 ms + 0.1 × 20 ms = 0.9 + 2.0 = **2.9 ms**. The 10% of misses make
up two thirds of the average, and they set the p99, so improving the miss
path often matters more than speeding up hits.

Numbers: [Numbers to know](../docs/numbers/#latency).
