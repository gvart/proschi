---
type: cloze
difficulty: easy
tags: [resilience]
related: [rate-limiter]
---

## Text

A client over its rate limit should get HTTP status
{{429|429 Too Many Requests|Too Many Requests}}, ideally with a
{{Retry-After}} header saying when to try again.

## Why

Many APIs also send the limit, the remaining count and the reset time in
headers (such as `RateLimit-Limit` and `RateLimit-Remaining`), so
well-behaved clients slow down before they are rejected.
