---
type: estimate
difficulty: hard
tags: [resilience]
answer: 1000
unit: requests in flight
tolerance: 1.5
---

## Question

A service receives 5,000 requests/s, and each request takes 200 ms to answer.
On average, how many requests are in progress at any moment?

## Solution

Little's law: in flight = arrival rate × time in the system. 5,000/s × 0.2 s =
**1,000 requests** in flight. If each holds a thread or a database connection,
that is the pool size you need, and it doubles if latency doubles.
