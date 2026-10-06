---
type: estimate
difficulty: hard
tags: [estimation, resilience]
answer: 63
unit: percent of page loads
tolerance: 1.3
---

## Question

A page calls 100 backend servers in parallel and waits for all of them. Each
server answers in over 1 second for 1% of its requests (its p99 is 1 s). What
share of page loads take over 1 second?

## Solution

A page is fast only if all 100 calls are: 0.99^100 ≈ 0.37. So 1 − 0.37 ≈
**63% of page loads** are slow. A backend's p99 becomes the page's typical
case, which is why tail percentiles, not averages, matter for services that
fan out.

Numbers: [Numbers to know](../docs/numbers/#how-to-estimate).
