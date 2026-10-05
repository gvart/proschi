---
type: cloze
difficulty: medium
related: [rate-limiter]
distinct-from: [token-bucket]
---

## Text

A {{leaky bucket}} rate limiter puts requests in a queue of fixed size and
lets them out at a constant rate; when the queue is full, new requests are
rejected.

## Why

It produces a perfectly smooth output, which protects a downstream system
that cannot take bursts, at the cost of added delay for queued requests.
