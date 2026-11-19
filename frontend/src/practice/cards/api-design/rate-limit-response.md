---
type: cloze
difficulty: easy
tags: [resilience]
related: [rate-limiter]
---

## Text

A client over its rate limit should get HTTP status
{{429|429 Too Many Requests|Too Many Requests|HTTP 429}}, ideally with a
{{Retry-After|RetryAfter}} header saying when to try again.

## Why

Many APIs also send the limit, the remaining count and the reset time in
headers (such as `RateLimit-Limit` and `RateLimit-Remaining`), so
well-behaved clients slow down before they are rejected.
