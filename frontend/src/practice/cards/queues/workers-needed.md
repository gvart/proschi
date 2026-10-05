---
type: estimate
difficulty: easy
tags: [estimation]
related: [notification-fanout]
answer: 150
unit: workers
tolerance: 1.5
---

## Question

3,000 messages arrive per second, and each takes a worker 50 ms to process,
one at a time. How many workers keep up?

## Solution

One worker handles 1 ÷ 0.05 s = 20 messages/s. 3,000 ÷ 20 = **150
workers**, or 3,000 × 0.05 = 150 by Little's law. Add headroom for peaks and
slow calls.
