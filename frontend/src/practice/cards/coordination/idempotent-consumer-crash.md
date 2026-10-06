---
type: choice
difficulty: hard
tags: [queues]
related: [payments, job-queue]
distinct-from: [at-least-once-needs-idempotency]
---

## Question

A consumer calls the payment provider to charge a card, then writes the
message id to a "processed" table, then acknowledges. It crashes after the
charge. What happens, and what fixes it?

## Options

- [ ] Nothing: the message is lost, so nothing is charged twice
- [ ] The broker detects the crash and skips the message
- [x] The message is redelivered and charged again; pass the message id as the provider's idempotency key
- [ ] The charge is rolled back automatically

## Why

A side effect outside your database cannot share a transaction with the
"processed" record. Either the external system deduplicates (an idempotency
key derived from the message id), or you record the intent first and check
the provider's status before charging again.
