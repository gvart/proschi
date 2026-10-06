---
type: estimate
difficulty: hard
tags: [estimation, resilience]
related: [rate-limiter]
answer: 6000000
unit: login attempts per hour
tolerance: 1.5
distinct-from: [login-brute-force-time]
---

## Question

A login endpoint limits each IP address to 10 attempts a minute. A botnet
with 10,000 IP addresses runs a credential-stuffing attack. How many attempts
an hour can it make?

## Solution

10,000 IPs × 10 a minute = 100,000 a minute; × 60 = **6,000,000 attempts an
hour**. Per-IP limits alone barely slow a botnet. Add limits per account,
watch for global spikes in failed logins, check passwords against breached
lists and require a second factor.

Numbers: [Numbers to know](../docs/numbers/#per-day-to-per-second).
