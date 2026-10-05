---
type: estimate
difficulty: hard
related: [rate-limiter]
answer: 83
unit: requests
tolerance: 1.2
distinct-from: [fixed-window-boundary]
---

## Question

A sliding window counter limits a client to 100 requests a minute. The
previous minute had 80 requests; 20 seconds into the current minute there have
been 30. What count does the limiter estimate for the last 60 seconds?

## Solution

The sliding minute covers the last 40 s of the previous window, 40/60 ≈ 0.67
of it. Estimate = 30 + 80 × 0.67 ≈ 30 + 53 = **83 requests**, so the next
request is allowed (83 < 100). It assumes the previous minute's requests were
spread evenly.

Numbers: [Numbers to know](../docs/numbers/#how-to-estimate).
