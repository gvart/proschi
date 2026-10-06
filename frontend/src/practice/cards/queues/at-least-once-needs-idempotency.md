---
type: flip
difficulty: medium
decks: [sample]
tags: [resilience]
related: [job-queue, payments, web-crawler]
---

## Front

Your queue delivers **at least once**. What must every consumer do?

## Back

Be **idempotent**: processing the same message twice must have the same effect
as once. Typically, store the message id (or an idempotency key) with the
result in the same transaction, and skip ids already seen.

## Why

Redelivery happens whenever a consumer crashes after doing the work but before
acknowledging the message. Exactly-once delivery across a network is not
achievable; exactly-once *effect* is, through idempotency.
