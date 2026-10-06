---
type: estimate
difficulty: medium
tags: [estimation, resilience]
related: [rate-limiter]
answer: 140
unit: days
tolerance: 1.5
---

## Question

Logins are limited to 5 attempts a minute per account. How long would one
attacker need to try 1 million passwords against a single account?

## Solution

1,000,000 ÷ 5 = 200,000 minutes. ÷ 60 ≈ 3,300 hours; ÷ 24 ≈ **140 days**.
Without the limit, at 100 attempts a second it would take under 3 hours. The
per-account limit makes guessing one account hopeless, but not trying one
common password against many accounts.

Numbers: [Numbers to know](../docs/numbers/#time-and-conversions).
