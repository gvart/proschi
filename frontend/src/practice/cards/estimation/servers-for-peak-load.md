---
type: estimate
difficulty: easy
answer: 50
unit: servers
tolerance: 1.5
---

## Question

Peak load is 60,000 requests/s. One server handles 2,000 requests/s at most,
and you want each to run at no more than 60% of that. How many servers?

## Solution

Usable capacity per server: 2,000 × 0.6 = 1,200 requests/s. 60,000 ÷ 1,200 =
**50 servers**. Add a few more so that losing a machine (or a whole zone)
still leaves enough.

## Why

Running servers near 100% makes queues, and so latency, grow sharply; a
target utilization of 50–70% leaves room for spikes and failures.

Numbers: [Numbers to know](../docs/numbers/#servers-and-data-stores).
