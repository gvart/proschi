---
type: choice
difficulty: easy
tags: [resilience]
---

## Question

Which response should a client retry automatically, after a delay?

## Options

- [ ] 400 Bad Request
- [ ] 403 Forbidden
- [ ] 404 Not Found
- [x] 503 Service Unavailable

## Why

503 (like 502, 504 and 429 Too Many Requests) usually means a temporary
condition, so retrying with backoff and jitter, honouring `Retry-After`, can
succeed. Most other 4xx errors mean the request itself is wrong, and sending
it again gets the same answer.
