---
type: estimate
difficulty: easy
tags: [estimation, databases]
related: [url-shortener]
answer: 5000
unit: database reads/s
tolerance: 1.5
---

## Question

A service gets 100,000 reads/s, and its cache hit rate is 95%. How many reads
per second reach the database?

## Solution

Misses are 100% − 95% = 5%. 100,000 × 0.05 = **5,000 reads/s**. If the hit
rate drops to 90%, misses double to 10,000/s: the database is sized by the
miss rate, so a small drop in hit rate can overload it.

Numbers: [Numbers to know](../docs/numbers/#servers-and-data-stores).
