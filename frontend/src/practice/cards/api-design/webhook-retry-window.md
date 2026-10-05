---
type: estimate
difficulty: medium
tags: [resilience]
answer: 17
unit: hours
tolerance: 1.5
---

## Question

A webhook sender retries failed deliveries up to 10 times, waiting 1 minute
before the first retry and doubling the wait each time. How long after the
first attempt does it give up?

## Solution

Waits: 1 + 2 + 4 + 8 + 16 + 32 + 64 + 128 + 256 + 512 minutes = 1,023
minutes (2¹⁰ − 1). 1,023 ÷ 60 ≈ **17 hours**. Exponential backoff covers a
long outage with few attempts.
