---
type: estimate
difficulty: medium
tags: [estimation]
distinct-from: [littles-law-concurrency]
answer: 10
unit: connections
tolerance: 1.5
---

## Question

A service runs 2,000 queries/s, and each query holds a database connection
for 5 ms. On average, how many connections are busy?

## Solution

Little's law: busy = rate × time held. 2,000/s × 0.005 s = **10
connections**. A pool a few times that absorbs bursts; a pool of 500 adds
nothing but load on the database.
