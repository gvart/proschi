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

5xx errors like 503 (and 429) are usually temporary, so retrying with backoff
can succeed. A 4xx error means the request itself is wrong, and sending it
again gets the same answer.
